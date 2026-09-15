import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { decryptJson, encryptJson } from "@/lib/secrets";
import { readWooConfig, type WooConfig } from "@/lib/woocommerce";
import { readMailrelayConfig, type MailrelayConfig } from "@/lib/mailrelay";

/**
 * De dónde salen las credenciales de las integraciones.
 *
 * Hay dos sitios y este fichero es el único que decide entre ellos: lo que se
 * escribe en la pantalla de Ajustes, cifrado en la base de datos, y lo que haya
 * en el .env del servidor. Manda la pantalla, porque es lo último que ha tocado
 * una persona y lo que espera que surta efecto; el .env queda como respaldo,
 * útil para montar un servidor nuevo sin entrar a la aplicación.
 */

export type IntegrationId = "woocommerce" | "mailrelay";

export type ConfigSource = "FORM" | "ENV";

export type LoadedConfig<T> =
  | { ok: true; config: T; source: ConfigSource }
  | { ok: false; missing: string[] };

interface WooSecret {
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

interface MailrelaySecret {
  baseUrl: string;
  apiKey: string;
}

async function readSecret<T>(id: IntegrationId): Promise<T | null> {
  const fila = await prisma.integrationSecret.findUnique({ where: { id } });
  if (!fila) return null;
  return decryptJson<T>(fila.payload);
}

/** Credenciales de WooCommerce: primero las de la pantalla, luego el .env. */
export async function getWooConfig(): Promise<LoadedConfig<WooConfig>> {
  const guardado = await readSecret<WooSecret>("woocommerce");
  if (guardado && guardado.baseUrl && guardado.consumerKey && guardado.consumerSecret) {
    return { ok: true, config: guardado, source: "FORM" };
  }

  const delEntorno = readWooConfig();
  if (delEntorno.ok) return { ok: true, config: delEntorno.config, source: "ENV" };
  return { ok: false, missing: delEntorno.missing };
}

/** Credenciales de Mailrelay: primero las de la pantalla, luego el .env. */
export async function getMailrelayConfig(): Promise<LoadedConfig<MailrelayConfig>> {
  const guardado = await readSecret<MailrelaySecret>("mailrelay");
  if (guardado && guardado.baseUrl && guardado.apiKey) {
    return { ok: true, config: guardado, source: "FORM" };
  }

  const delEntorno = readMailrelayConfig();
  if (delEntorno.ok) return { ok: true, config: delEntorno.config, source: "ENV" };
  return { ok: false, missing: delEntorno.missing };
}

export interface StoredState {
  /** Hay credenciales escritas desde la pantalla. */
  saved: boolean;
  savedAt: Date | null;
  savedBy: string | null;
}

/** Qué hay guardado desde la pantalla, sin descifrar nada. */
export async function storedState(id: IntegrationId): Promise<StoredState> {
  const fila = await prisma.integrationSecret.findUnique({
    where: { id },
    include: { updatedBy: { select: { name: true } } },
  });
  return {
    saved: fila !== null,
    savedAt: fila?.updatedAt ?? null,
    savedBy: fila?.updatedBy?.name ?? null,
  };
}

/**
 * Guarda las credenciales cifradas.
 *
 * El resumen de auditoría nunca lleva la clave: solo que se han cambiado y
 * quién lo ha hecho.
 */
export async function saveSecret(
  id: IntegrationId,
  value: Record<string, string>,
  userId: string,
  summary: string,
): Promise<void> {
  const payload = encryptJson(value);

  await prisma.$transaction(async (tx) => {
    await tx.integrationSecret.upsert({
      where: { id },
      create: { id, payload, updatedById: userId },
      update: { payload, updatedById: userId },
    });
    await recordAudit(tx, {
      userId,
      entity: "IntegrationSecret",
      entityId: id,
      action: "UPDATE",
      summary,
    });
  });
}

/** Borra las credenciales guardadas; vuelve a mandar lo que diga el .env. */
export async function clearSecret(
  id: IntegrationId,
  userId: string,
  summary: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.integrationSecret.deleteMany({ where: { id } });
    await recordAudit(tx, {
      userId,
      entity: "IntegrationSecret",
      entityId: id,
      action: "DELETE",
      summary,
    });
  });
}
