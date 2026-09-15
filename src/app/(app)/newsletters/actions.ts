"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseAmountToCents } from "@/lib/money";
import { segmentRulesSchema, type SegmentRules } from "@/lib/segments";
import { segmentSchema } from "@/lib/validation";
import { bool, int, parseForm, snapshotValues, text, type FormState } from "@/lib/form";

/** Convierte "vinilo, textil" en ["vinilo", "textil"]. */
function listaDeTexto(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Lee del formulario las reglas del segmento dinámico. */
function readRules(formData: FormData): SegmentRules {
  const meses = int(formData, "orderedSinceMonths", 0);
  const gasto = parseAmountToCents(text(formData, "minSpent"));

  // Dos casillas con nombre propio en vez de una lista con el mismo nombre:
  // el repintado tras un error guarda un valor por campo, y una casilla
  // repetida perdería todas menos la última.
  const kinds: string[] = [];
  if (bool(formData, "kindCompany")) kinds.push("COMPANY");
  if (bool(formData, "kindIndividual")) kinds.push("INDIVIDUAL");

  return segmentRulesSchema.parse({
    kinds,
    tagsAny: listaDeTexto(text(formData, "tagsAny")),
    provinces: listaDeTexto(text(formData, "provinces")),
    onlyActive: bool(formData, "onlyActive"),
    orderedSinceMonths: meses > 0 ? meses : null,
    minSpentCents: gasto !== null && gasto > 0 ? gasto : null,
  });
}

export async function createSegmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = parseForm(
    segmentSchema,
    {
      name: text(formData, "name"),
      description: text(formData, "description"),
      kind: text(formData, "kind") || "STATIC",
      onlyWithConsent: bool(formData, "onlyWithConsent"),
      includeAllContacts: bool(formData, "includeAllContacts"),
      active: bool(formData, "active"),
    },
    formData,
  );
  if (!parsed.ok) return parsed.state;

  let segmentId: string;
  try {
    const segment = await prisma.segment.create({
      data: {
        ...parsed.data,
        rulesJson: JSON.stringify(readRules(formData)),
        createdById: user.id,
      },
    });
    segmentId = segment.id;
    await recordAudit(prisma, {
      userId: user.id,
      entity: "Segment",
      entityId: segment.id,
      action: "CREATE",
      summary: `Alta del grupo de newsletter «${segment.name}»`,
      data: { kind: segment.kind },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        error: "Ya hay un grupo con ese nombre.",
        errors: { name: "Nombre repetido" },
        values: snapshotValues(formData),
      };
    }
    throw error;
  }

  revalidatePath("/newsletters");
  redirect(`/newsletters/${segmentId}`);
}

export async function updateSegmentAction(
  segmentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = parseForm(
    segmentSchema,
    {
      name: text(formData, "name"),
      description: text(formData, "description"),
      kind: text(formData, "kind") || "STATIC",
      onlyWithConsent: bool(formData, "onlyWithConsent"),
      includeAllContacts: bool(formData, "includeAllContacts"),
      active: bool(formData, "active"),
    },
    formData,
  );
  if (!parsed.ok) return parsed.state;

  try {
    const segment = await prisma.segment.update({
      where: { id: segmentId },
      data: { ...parsed.data, rulesJson: JSON.stringify(readRules(formData)) },
    });
    await recordAudit(prisma, {
      userId: user.id,
      entity: "Segment",
      entityId: segmentId,
      action: "UPDATE",
      summary: `Modificación del grupo «${segment.name}»`,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        error: "Ya hay un grupo con ese nombre.",
        errors: { name: "Nombre repetido" },
        values: snapshotValues(formData),
      };
    }
    throw error;
  }

  revalidatePath("/newsletters");
  revalidatePath(`/newsletters/${segmentId}`);
  redirect(`/newsletters/${segmentId}`);
}

/**
 * Borra un grupo.
 *
 * Aquí sí se borra de verdad, a diferencia de clientes o artículos: un grupo de
 * envío no tiene valor contable ni lo referencia ningún documento. Lo único que
 * se pierde son sus miembros, y quedan en el registro de auditoría.
 */
export async function deleteSegmentAction(segmentId: string): Promise<void> {
  const user = await requireUser();

  const segment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { name: true, kind: true, _count: { select: { members: true } } },
  });
  if (!segment) return;

  await prisma.$transaction(async (tx) => {
    await tx.segment.delete({ where: { id: segmentId } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Segment",
      entityId: segmentId,
      action: "DELETE",
      summary: `Eliminado el grupo «${segment.name}»`,
      data: { miembros: segment._count.members },
    });
  });

  revalidatePath("/newsletters");
  redirect("/newsletters");
}

/** Añade clientes a un grupo de lista fija. */
export async function addMembersAction(
  segmentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerIds = formData
    .getAll("customerIds")
    .filter((v): v is string => typeof v === "string" && v !== "");
  if (customerIds.length === 0) {
    return { error: "Selecciona al menos un cliente." };
  }

  const segment = await prisma.segment.findUnique({
    where: { id: segmentId },
    select: { kind: true, name: true },
  });
  if (!segment) return { error: "El grupo ya no existe." };
  if (segment.kind !== "STATIC") {
    return { error: "Un grupo por reglas no lleva miembros a mano." };
  }

  // Solo se aceptan ids de clientes que existan: el formulario los ofrece en un
  // desplegable, pero la petición puede traer cualquier cosa.
  const existentes = await prisma.customer.findMany({
    where: { id: { in: customerIds } },
    select: { id: true },
  });

  // SQLite no admite skipDuplicates en createMany, así que los que ya estaban
  // se descartan antes. Añadir a alguien que ya está en el grupo no es un
  // error: el formulario deja seleccionarlo y lo razonable es no hacer nada.
  const añadidos = await prisma.$transaction(async (tx) => {
    const yaEstaban = await tx.segmentMember.findMany({
      where: { segmentId, customerId: { in: existentes.map((c) => c.id) } },
      select: { customerId: true },
    });
    const conocidos = new Set(yaEstaban.map((m) => m.customerId));
    const nuevos = existentes.filter((c) => !conocidos.has(c.id));

    if (nuevos.length === 0) return 0;

    await tx.segmentMember.createMany({
      data: nuevos.map((c) => ({ segmentId, customerId: c.id })),
    });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Segment",
      entityId: segmentId,
      action: "UPDATE",
      summary: `${nuevos.length} cliente(s) añadidos al grupo «${segment.name}»`,
    });
    return nuevos.length;
  });

  revalidatePath(`/newsletters/${segmentId}`);
  return {
    message:
      añadidos === 0
        ? "Esos clientes ya estaban en el grupo."
        : `${añadidos} cliente(s) añadidos.`,
  };
}

export async function removeMemberAction(
  segmentId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const customerId = text(formData, "customerId");
  if (!customerId) return;

  await prisma.$transaction(async (tx) => {
    const borrados = await tx.segmentMember.deleteMany({ where: { segmentId, customerId } });
    if (borrados.count === 0) return;
    await recordAudit(tx, {
      userId: user.id,
      entity: "Segment",
      entityId: segmentId,
      action: "UPDATE",
      summary: "Cliente retirado del grupo",
      data: { customerId },
    });
  });

  revalidatePath(`/newsletters/${segmentId}`);
}

/**
 * Da de baja a un destinatario desde la vista previa del grupo.
 *
 * La baja es del cliente o del contacto, no del grupo: quien pide no recibir
 * comunicaciones lo pide para todas, no solo para el envío que se esté
 * preparando en ese momento.
 */
export async function optOutRecipientAction(
  segmentId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const customerId = text(formData, "customerId");
  const email = text(formData, "email").trim().toLowerCase();
  if (!customerId || !email) return;

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      legalName: true,
      email: true,
      contacts: { select: { id: true, email: true } },
    },
  });
  if (!customer) return;

  const contacto = customer.contacts.find((c) => c.email?.trim().toLowerCase() === email);
  const esCorreoDelCliente = customer.email?.trim().toLowerCase() === email;
  if (!contacto && !esCorreoDelCliente) return;

  await prisma.$transaction(async (tx) => {
    if (contacto) {
      await tx.contact.update({ where: { id: contacto.id }, data: { marketingOptOut: true } });
    } else {
      await tx.customer.update({ where: { id: customerId }, data: { marketingOptOut: true } });
    }
    await recordAudit(tx, {
      userId: user.id,
      entity: contacto ? "Contact" : "Customer",
      entityId: contacto ? contacto.id : customerId,
      action: "UPDATE",
      summary: `Baja de comunicaciones comerciales: ${email} (${customer.legalName})`,
      data: { customerId },
    });
  });

  revalidatePath(`/newsletters/${segmentId}`);
  revalidatePath(`/clientes/${customerId}`);
}
