import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
} from "@/lib/session";
import type { UserRole } from "@/lib/validation";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/** Coste de bcrypt. 12 es el equilibrio habitual entre seguridad y latencia. */
const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Lee la sesión y comprueba el usuario contra la base de datos.
 *
 * No basta con confiar en el token: si se desactiva a alguien o se le cambia
 * el rol, el cambio tiene que surtir efecto en su siguiente petición, no
 * cuando caduque su cookie.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });
  if (!user || !user.active) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
  };
}

/** Exige sesión. Redirige al login si no hay ninguna. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Exige uno de los roles indicados. */
export async function requireRole(...roles: UserRole[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) redirect("/");
  return user;
}

export type LoginResult =
  | { ok: true; user: CurrentUser }
  | { ok: false; error: string };

/** Comprueba las credenciales y, si son correctas, deja la cookie de sesión. */
export async function login(email: string, password: string): Promise<LoginResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  // Mismo mensaje para usuario inexistente y contraseña incorrecta: decir cuál
  // de las dos ha fallado permite averiguar qué correos tienen cuenta.
  const genericError = "Correo o contraseña incorrectos.";

  if (!user || !user.active) {
    // Se compara igualmente contra un hash de mentira para que el tiempo de
    // respuesta no delate si el correo existe.
    await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");
    return { ok: false, error: genericError };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    await recordAudit(prisma, {
      userId: user.id,
      entity: "User",
      entityId: user.id,
      action: "LOGIN_FAILED",
      summary: `Intento de acceso fallido de ${user.email}`,
    });
    return { ok: false, error: genericError };
  }

  const current: CurrentUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRole,
  };

  const token = await createSessionToken({
    userId: current.id,
    email: current.email,
    name: current.name,
    role: current.role,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await recordAudit(prisma, {
    userId: user.id,
    entity: "User",
    entityId: user.id,
    action: "LOGIN",
    summary: `${user.name} ha iniciado sesión`,
  });

  return { ok: true, user: current };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
