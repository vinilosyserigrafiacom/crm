"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, requireRole, requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { companySettingsSchema, USER_ROLE_LABELS, USER_ROLES } from "@/lib/validation";
import {
  int,
  parseForm,
  text,
  type FormState,
  snapshotValues,
} from "@/lib/form";

export async function saveCompanySettingsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const parsed = parseForm(
    companySettingsSchema,
    {
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
    },
    formData,
  );
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
  password: z
    .string()
    .min(10, "La contraseña debe tener al menos 10 caracteres"),
});

export async function createUserAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const parsed = parseForm(
    newUserSchema,
    {
      name: text(formData, "name"),
      email: text(formData, "email"),
      role: text(formData, "role") || "STAFF",
      password: text(formData, "password"),
    },
    formData,
  );
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
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return {
        error: "Ya hay una cuenta con ese correo.",
        errors: { email: "Correo repetido" },
        values: snapshotValues(formData),
      };
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
export async function toggleUserActiveAction(
  formData: FormData,
): Promise<void> {
  const current = await requireRole("OWNER", "ADMIN");
  const userId = text(formData, "userId");
  if (!userId) return;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, active: true, email: true },
  });
  if (!target) return;
  if (puedeGestionar(current, target)) return;

  // Desactivar al último propietario dejaría el taller sin quien administre.
  if (target.active && target.role === "OWNER" && (await otrosPropietariosActivos(target.id)) === 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { active: !target.active },
    });
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

/**
 * Comprueba si se puede tocar la cuenta `target` desde la cuenta `actor`.
 *
 * Dos reglas, y las dos son de seguridad y no de cortesía: una cuenta de
 * administración no manda sobre una de propietario —si no, ascender no
 * significaría nada, le bastaría con cambiarle la contraseña al jefe— y nadie
 * se toca a sí mismo, que es como uno se deja fuera sin querer.
 */
function puedeGestionar(
  actor: { id: string; role: string },
  target: { id: string; role: string },
): string | null {
  if (actor.id === target.id) return "Sobre tu propia cuenta no puedes hacer esto.";
  if (target.role === "OWNER" && actor.role !== "OWNER") {
    return "Solo una cuenta de propietario puede tocar otra cuenta de propietario.";
  }
  return null;
}

/** Cuenta los propietarios activos que quedarían sin contar a `exceptoId`. */
async function otrosPropietariosActivos(exceptoId: string): Promise<number> {
  return prisma.user.count({
    where: { role: "OWNER", active: true, id: { not: exceptoId } },
  });
}

/**
 * Cambia el perfil de una cuenta.
 *
 * El taller crece: quien entró como taller acaba llevando los presupuestos. Sin
 * esto habría que borrar la cuenta y crearla otra vez, y se perdería a quién
 * pertenecen los documentos que ya firmó.
 */
export async function updateUserRoleAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const current = await requireRole("OWNER", "ADMIN");

  const userId = text(formData, "userId");
  const parsedRole = z.enum(USER_ROLES).safeParse(text(formData, "role"));
  if (!userId || !parsedRole.success) return { error: "Perfil no válido." };
  const role = parsedRole.data;

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true, active: true },
  });
  if (!target) return { error: "Esa cuenta ya no existe." };

  const veto = puedeGestionar(current, target);
  if (veto) return { error: veto };

  if (role === "OWNER" && current.role !== "OWNER") {
    return { error: "Solo una cuenta de propietario puede nombrar a otra." };
  }
  if (role === target.role) return { message: "Ese ya era su perfil." };

  // Quitarle el propietario al último que queda dejaría el taller sin nadie
  // que pueda volver a darlo.
  if (target.role === "OWNER" && (await otrosPropietariosActivos(target.id)) === 0) {
    return { error: "Es la única cuenta de propietario que queda activa." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role } });
    await recordAudit(tx, {
      userId: current.id,
      entity: "User",
      entityId: userId,
      action: "UPDATE",
      summary: `Perfil de ${target.email}: ${target.role} → ${role}`,
    });
  });

  revalidatePath("/ajustes");
  return { message: `${target.email} pasa a ${USER_ROLE_LABELS[role]}.` };
}

/**
 * Pone una contraseña nueva a otra cuenta.
 *
 * Alguien olvida la suya un lunes por la mañana y no hay correo de recuperación
 * montado: esto es lo que evita que se quede fuera hasta que alguien toque la
 * base de datos a mano. La contraseña se teclea aquí y se le dice de viva voz;
 * no se guarda ni se devuelve en claro.
 */
export async function resetUserPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const current = await requireRole("OWNER", "ADMIN");

  const userId = text(formData, "userId");
  const password = text(formData, "password");

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, email: true },
  });
  if (!target) return { error: "Esa cuenta ya no existe." };

  const veto = puedeGestionar(current, target);
  if (veto) return { error: veto };

  if (password.length < 10) {
    return {
      error: "Revisa la contraseña.",
      errors: { password: "Debe tener al menos 10 caracteres" },
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password) },
    });
    await recordAudit(tx, {
      userId: current.id,
      entity: "User",
      entityId: userId,
      action: "UPDATE",
      summary: `Contraseña restablecida a ${target.email}`,
    });
  });

  revalidatePath("/ajustes");
  return { message: `Contraseña nueva para ${target.email}. Díselo en persona.` };
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
    return {
      errors: { password: "Debe tener al menos 10 caracteres" },
      error: "Revisa la contraseña.",
    };
  }
  if (password !== repeat) {
    return {
      errors: { passwordRepeat: "Las dos contraseñas no coinciden" },
      error: "Revisa la contraseña.",
    };
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
