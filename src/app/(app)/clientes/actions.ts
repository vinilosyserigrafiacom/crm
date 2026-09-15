"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { reserveCustomerCode } from "@/lib/numbering";
import { normalizeTaxId } from "@/lib/tax-id";
import { parseRateToBasisPoints } from "@/lib/money";
import { addressSchema, contactSchema, customerSchema } from "@/lib/validation";
import { bool, int, parseForm, text, type FormState } from "@/lib/form";

/**
 * Lee el formulario de cliente. La retención llega escrita como porcentaje
 * ("15" o "15,5") y aquí se convierte a puntos base, que es como se guarda.
 */
function readCustomerForm(formData: FormData) {
  return {
    kind: text(formData, "kind"),
    legalName: text(formData, "legalName"),
    tradeName: text(formData, "tradeName"),
    taxId: normalizeTaxId(text(formData, "taxId")),
    taxIdType: text(formData, "taxIdType") || "NIF",
    countryCode: text(formData, "countryCode") || "ES",
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    website: text(formData, "website"),
    paymentTermsDays: int(formData, "paymentTermsDays", 0),
    defaultVatRate: int(formData, "defaultVatRate", 2100),
    vatExempt: bool(formData, "vatExempt"),
    vatExemptReason: text(formData, "vatExemptReason"),
    withholdingRate:
      parseRateToBasisPoints(text(formData, "withholdingRate")) ?? 0,
    notes: text(formData, "notes"),
    tags: text(formData, "tags"),
    active: bool(formData, "active"),
  };
}

export async function createCustomerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = parseForm(
    customerSchema,
    readCustomerForm(formData),
    formData,
  );
  if (!parsed.ok) return parsed.state;

  let customerId: string;
  try {
    customerId = await prisma.$transaction(async (tx) => {
      // El código se reserva dentro de la transacción para que dos altas
      // simultáneas no reciban el mismo C-0001.
      const code = await reserveCustomerCode(tx);
      const customer = await tx.customer.create({
        data: { ...parsed.data, code },
      });
      await recordAudit(tx, {
        userId: user.id,
        entity: "Customer",
        entityId: customer.id,
        action: "CREATE",
        summary: `Alta de cliente ${customer.code} · ${customer.legalName}`,
        data: { legalName: customer.legalName, taxId: customer.taxId },
      });
      return customer.id;
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        error: "Ya existe un cliente con ese código. Vuelve a intentarlo.",
      };
    }
    throw error;
  }

  revalidatePath("/clientes");
  redirect(`/clientes/${customerId}`);
}

export async function updateCustomerAction(
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = parseForm(
    customerSchema,
    readCustomerForm(formData),
    formData,
  );
  if (!parsed.ok) return parsed.state;

  const before = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!before) return { error: "El cliente ya no existe." };

  await prisma.$transaction(async (tx) => {
    const after = await tx.customer.update({
      where: { id: customerId },
      data: parsed.data,
    });

    // Solo se registran los campos que han cambiado: un histórico con el
    // registro completo en cada guardado es ilegible cuando hace falta.
    const changes: Record<string, { antes: unknown; despues: unknown }> = {};
    for (const key of Object.keys(
      parsed.data,
    ) as (keyof typeof parsed.data)[]) {
      if (before[key] !== after[key]) {
        changes[key] = { antes: before[key], despues: after[key] };
      }
    }

    await recordAudit(tx, {
      userId: user.id,
      entity: "Customer",
      entityId: customerId,
      action: "UPDATE",
      summary: `Modificación del cliente ${after.code} · ${after.legalName}`,
      data: changes,
    });
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
  redirect(`/clientes/${customerId}`);
}

/**
 * Archiva o reactiva un cliente.
 *
 * No hay borrado: un cliente puede tener presupuestos y pedidos con valor
 * contable, y borrarlo dejaría documentos huérfanos. Archivarlo lo saca de los
 * listados y de los desplegables sin tocar su historial.
 */
export async function toggleCustomerActiveAction(
  customerId: string,
): Promise<void> {
  const user = await requireUser();

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { active: true, code: true, legalName: true },
  });
  if (!customer) return;

  await prisma.$transaction(async (tx) => {
    await tx.customer.update({
      where: { id: customerId },
      data: { active: !customer.active },
    });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Customer",
      entityId: customerId,
      action: "UPDATE",
      summary: `${customer.active ? "Archivado" : "Reactivado"} el cliente ${customer.code} · ${customer.legalName}`,
    });
  });

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
}

// ---------------------------------------------------------------------------
// Contactos
// ---------------------------------------------------------------------------

/**
 * Crea o modifica un contacto. El id del contacto viaja en el formulario, pero
 * la consulta siempre filtra además por customerId, así que un id manipulado
 * no permite tocar el contacto de otro cliente.
 */
export async function saveContactAction(
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const contactId = text(formData, "contactId") || null;

  const parsed = parseForm(
    contactSchema,
    {
      name: text(formData, "name"),
      jobTitle: text(formData, "jobTitle"),
      email: text(formData, "email"),
      phone: text(formData, "phone"),
      notes: text(formData, "notes"),
      isPrimary: bool(formData, "isPrimary"),
    },
    formData,
  );
  if (!parsed.ok) return parsed.state;

  await prisma.$transaction(async (tx) => {
    // Solo puede haber un contacto principal por cliente.
    if (parsed.data.isPrimary) {
      await tx.contact.updateMany({
        where: { customerId },
        data: { isPrimary: false },
      });
    }

    const contact = contactId
      ? await tx.contact.update({
          where: { id: contactId, customerId },
          data: parsed.data,
        })
      : await tx.contact.create({ data: { ...parsed.data, customerId } });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Contact",
      entityId: contact.id,
      action: contactId ? "UPDATE" : "CREATE",
      summary: `${contactId ? "Modificado" : "Añadido"} el contacto ${contact.name}`,
      data: { customerId },
    });
  });

  revalidatePath(`/clientes/${customerId}`);
  return { message: contactId ? "Contacto actualizado." : "Contacto añadido." };
}

export async function deleteContactAction(
  customerId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const contactId = text(formData, "contactId");
  if (!contactId) return;

  await prisma.$transaction(async (tx) => {
    const contact = await tx.contact.delete({
      where: { id: contactId, customerId },
    });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Contact",
      entityId: contactId,
      action: "DELETE",
      summary: `Eliminado el contacto ${contact.name}`,
      data: { customerId, contact },
    });
  });

  revalidatePath(`/clientes/${customerId}`);
}

// ---------------------------------------------------------------------------
// Direcciones
// ---------------------------------------------------------------------------

export async function saveAddressAction(
  customerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const addressId = text(formData, "addressId") || null;

  const parsed = parseForm(
    addressSchema,
    {
      kind: text(formData, "kind"),
      label: text(formData, "label"),
      line1: text(formData, "line1"),
      line2: text(formData, "line2"),
      postalCode: text(formData, "postalCode"),
      city: text(formData, "city"),
      province: text(formData, "province"),
      countryCode: text(formData, "countryCode") || "ES",
      isDefault: bool(formData, "isDefault"),
    },
    formData,
  );
  if (!parsed.ok) return parsed.state;

  await prisma.$transaction(async (tx) => {
    // La dirección por defecto es única dentro de cada tipo: puede haber una
    // de facturación y otra de envío marcadas a la vez.
    if (parsed.data.isDefault) {
      await tx.address.updateMany({
        where: { customerId, kind: parsed.data.kind },
        data: { isDefault: false },
      });
    }

    const address = addressId
      ? await tx.address.update({
          where: { id: addressId, customerId },
          data: parsed.data,
        })
      : await tx.address.create({ data: { ...parsed.data, customerId } });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Address",
      entityId: address.id,
      action: addressId ? "UPDATE" : "CREATE",
      summary: `${addressId ? "Modificada" : "Añadida"} una dirección de ${address.line1}`,
      data: { customerId },
    });
  });

  revalidatePath(`/clientes/${customerId}`);
  return {
    message: addressId ? "Dirección actualizada." : "Dirección añadida.",
  };
}

export async function deleteAddressAction(
  customerId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const addressId = text(formData, "addressId");
  if (!addressId) return;

  await prisma.$transaction(async (tx) => {
    const address = await tx.address.delete({
      where: { id: addressId, customerId },
    });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Address",
      entityId: addressId,
      action: "DELETE",
      summary: `Eliminada la dirección ${address.line1}`,
      data: { customerId, address },
    });
  });

  revalidatePath(`/clientes/${customerId}`);
}
