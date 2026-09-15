import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Cifrado de las credenciales que se guardan en la base de datos.
 *
 * Las claves de la tienda y de Mailrelay se escriben desde la pantalla de
 * Ajustes, pero no se guardan en claro: van cifradas con AES-256-GCM y una
 * clave derivada de SESSION_SECRET, que vive en el .env del servidor. De ese
 * modo la copia de seguridad de la base de datos —que es lo que acaba en un
 * correo o en un disco de red— no lleva dentro nada aprovechable sin el .env.
 *
 * No es una caja fuerte: quien tenga el servidor entero tiene las dos piezas.
 * Lo que evita es que las claves viajen en cada copia, que es el escenario
 * realista en un taller.
 */

const ALGORITMO = "aes-256-gcm";
const VERSION = "v1";

/**
 * Sal fija.
 *
 * Con una sal aleatoria por registro habría que guardarla al lado, y no aporta
 * nada aquí: lo que protege el dato es el secreto de sesión, no la sal. Fijarla
 * permite además derivar la clave una sola vez por proceso.
 */
const SAL = Buffer.from("crm-vinilos-integraciones-v1");

let cache: { secret: string; key: Buffer } | null = null;

function claveDerivada(): Buffer {
  const secret = (process.env.SESSION_SECRET ?? "").trim();
  if (secret.length < 16) {
    throw new Error(
      "SESSION_SECRET es demasiado corto para cifrar las credenciales. Pon uno largo en el .env del servidor.",
    );
  }
  if (cache && cache.secret === secret) return cache.key;

  // scrypt con los parámetros por defecto de Node: de sobra para derivar una
  // clave de un secreto que ya es largo y aleatorio.
  const key = scryptSync(secret, SAL, 32);
  cache = { secret, key };
  return key;
}

/** Cifra un objeto y devuelve una cadena guardable en una columna de texto. */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITMO, claveDerivada(), iv);
  const datos = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [VERSION, iv.toString("base64"), tag.toString("base64"), datos.toString("base64")].join(
    ".",
  );
}

/**
 * Descifra lo que devolvió `encryptJson`.
 *
 * Devuelve null si el texto está corrupto o si SESSION_SECRET ha cambiado:
 * quien llama tiene que dar por hecho que las credenciales pueden no estar, y
 * pedir que se vuelvan a escribir en vez de reventar la pantalla.
 */
export function decryptJson<T>(payload: string): T | null {
  const partes = payload.split(".");
  if (partes.length !== 4 || partes[0] !== VERSION) return null;

  try {
    const decipher = createDecipheriv(
      ALGORITMO,
      claveDerivada(),
      Buffer.from(partes[1], "base64"),
    );
    decipher.setAuthTag(Buffer.from(partes[2], "base64"));
    const claro = Buffer.concat([
      decipher.update(Buffer.from(partes[3], "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(claro) as T;
  } catch {
    return null;
  }
}

/** Deja ver el final de una clave sin enseñarla: «…a1b2c3». */
export function maskSecret(value: string): string {
  const limpio = value.trim();
  if (limpio.length <= 6) return "······";
  return `······${limpio.slice(-6)}`;
}
