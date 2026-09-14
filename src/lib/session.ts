import { SignJWT, jwtVerify } from "jose";

/**
 * Sesión en cookie firmada.
 *
 * Este módulo no toca la base de datos a propósito: lo usa también el
 * middleware, que corre en el runtime edge de Next.js, donde Prisma no
 * funciona. La comprobación contra la base de datos (usuario activo, rol
 * actual) la hace src/lib/auth.ts en el servidor.
 */

export const SESSION_COOKIE = "vys_session";
/** 8 horas: una jornada de taller, sin dejar la sesión abierta para siempre. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: string;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "Falta SESSION_SECRET o es demasiado corto. Genera una clave con: openssl rand -base64 48",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (
      typeof payload.userId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string"
    ) {
      return null;
    }
    return {
      userId: payload.userId,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
  } catch {
    // Token caducado, manipulado o firmado con otra clave: no hay sesión.
    return null;
  }
}
