"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, requireRole, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { companySettingsSchema, USER_ROLES } from "@/lib/validation";
import { int, parseForm, text, type FormState } from "@/lib/form";

export async function saveCompanySettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const parsed = parseForm(companySettingsSchema, {
    legalName: text(formData, "legalName"),
    tradeName: text(formData, "tradeName"),
    taxId: text(formData, "taxId"),
    addressLine1: text(formData, "addressLine1"),
    addressLine2: text(formData, "addressLine2"),
    postalCode: text(formData, "postalCode"),
    city: text(formData, "city"),
    province: text(formData, "province"),
    countryCode: text(formData, "countryCode") || "ES",
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    website: text(formData, "website"),
    iban: text(formData, "iban").replace(/\s/g, "").toUpperCase(),
    defaultVatRate: int(formData, "defaultVatRate", 2100),
    quoteValidDays: int(formData, "quoteValidDays", 30),
    quoteTerms: text(formData, "quoteTerms"),
  });
  if (!parsed.ok) return parsed.state;

  await prisma.$transaction(async (tx) => {
    await tx.companySettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...parsed.data },
      update: parsed.data,
    });
    await recordAudit(tx, {
      userId: user.id,
      entity: "CompanySettings",
      entityId: "default",
      action: "UPDATE",
      summary: "Datos del emisor actualizados",
    });
  });

  revalidatePath("/ajustes");
  return { message: "Datos guardados." };
}

const newUserSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio"),
  email: z.string().trim().toLowerCase().email("El correo no es válido"),
  role: z.enum(USER_ROLES),
  // 10 caracteres como mínimo: con bcrypt y sin límite de intentos, la longitud
  // es lo que de verdad protege la cuenta.
  password: z.string().min(10, "La contraseña debe tener al menos 10 caracteres"),
});

export async function createUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const parsed = parseForm(newUserSchema, {
    name: text(formData, "name"),
    email: text(formData, "email"),
    role: text(formData, "role") || "STAFF",
    password: text(formData, "password"),
  });
  if (!parsed.ok) return parsed.state;

  try {
    const created = await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        role: parsed.data.role,
        passwordHash: await hashPassword(parsed.data.password),
      },
    });
    await recordAudit(prisma, {
      userId: user.id,
      entity: "User",
      entityId: created.id,
      action: "CREATE",
      summary: `Alta de usuario ${created.email} (${created.role})`,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Ya hay una cuenta con ese correo.", errors: { email: "Correo repetido" } };
    }
    throw error;
  }

  revalidatePath("/ajustes");
  return { message: "Usuario creado." };
}

/**
 * Activa o desactiva una cuenta.
 *
 * No se permite desactivarse a uno mismo: dejaría el taller sin nadie dentro si
 * es la única cuenta de administración.
 */
export async function toggleUserActiveAction(formData: FormData): Promise<void> {
  const current = await requireRole("OWNER", "ADMIN");
  const userId = text(formData, "userId");
  if (!userId || userId === current.id) return;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, email: true },
  });
  if (!target) return;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { active: !target.active } });
    await recordAudit(tx, {
      userId: current.id,
      entity: "User",
      entityId: userId,
      action: "UPDATE",
      summary: `${target.active ? "Desactivada" : "Reactivada"} la cuenta ${target.email}`,
    });
  });

  revalidatePath("/ajustes");
}

/** Cambia la contraseña de la propia cuenta. */
export async function changeOwnPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const password = text(formData, "password");
  const repeat = text(formData, "passwordRepeat");

  if (password.length < 10) {
    return { errors: { password: "Debe tener al menos 10 caracteres" }, error: "Revisa la contraseña." };
  }
  if (password !== repeat) {
    return { errors: { passwordRepeat: "Las dos contraseñas no coinciden" }, error: "Revisa la contraseña." };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password) },
  });
  await recordAudit(prisma, {
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "UPDATE",
    summary: `${user.name} ha cambiado su contraseña`,
  });

  return { message: "Contraseña actualizada." };
}
