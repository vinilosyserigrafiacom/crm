import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Registro de auditoría encadenado por hash.
 *
 * Cada entrada incluye el hash de la anterior, así que alterar o borrar una
 * entrada intermedia rompe la cadena y `verifyAuditChain` lo detecta.
 *
 * Verifactu exige esta propiedad para los registros de facturación. Se estrena
 * aquí con clientes, presupuestos y pedidos para que cuando se añadan las
 * facturas el mecanismo ya esté rodado y probado.
 */

export type AuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "STATUS_CHANGE"
  | "ISSUE"
  | "CONVERT"
  | "LOGIN"
  | "LOGIN_FAILED";

export interface AuditEntry {
  userId?: string | null;
  entity: string;
  entityId: string;
  action: AuditAction;
  summary: string;
  data?: unknown;
}

/** Cliente Prisma o transacción: permite auditar dentro de una transacción. */
type Db = Prisma.TransactionClient | typeof prisma;

function computeHash(input: {
  at: Date;
  entity: string;
  entityId: string;
  action: string;
  summary: string;
  dataJson: string | null;
  prevHash: string | null;
}): string {
  // El orden de los campos forma parte del formato del hash: cambiarlo
  // invalidaría las cadenas ya escritas.
  const payload = [
    input.at.toISOString(),
    input.entity,
    input.entityId,
    input.action,
    input.summary,
    input.dataJson ?? "",
    input.prevHash ?? "",
  ].join("|");
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export async function recordAudit(db: Db, entry: AuditEntry): Promise<void> {
  const previous = await db.auditLog.findFirst({
    orderBy: { id: "desc" },
    select: { hash: true },
  });

  const at = new Date();
  const dataJson = entry.data === undefined ? null : JSON.stringify(entry.data);
  const prevHash = previous?.hash ?? null;

  await db.auditLog.create({
    data: {
      at,
      userId: entry.userId ?? null,
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      summary: entry.summary,
      dataJson,
      prevHash,
      hash: computeHash({
        at,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        summary: entry.summary,
        dataJson,
        prevHash,
      }),
    },
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  /** Id de la primera entrada que no cuadra, si hay alguna. */
  brokenAt: number | null;
}

/** Recorre la cadena completa y comprueba que ningún hash se ha alterado. */
export async function verifyAuditChain(): Promise<ChainVerification> {
  const logs = await prisma.auditLog.findMany({ orderBy: { id: "asc" } });

  let prevHash: string | null = null;
  for (const log of logs) {
    const expected = computeHash({
      at: log.at,
      entity: log.entity,
      entityId: log.entityId,
      action: log.action,
      summary: log.summary,
      dataJson: log.dataJson,
      prevHash,
    });
    if (log.prevHash !== prevHash || log.hash !== expected) {
      return { ok: false, checked: logs.length, brokenAt: log.id };
    }
    prevHash = log.hash;
  }

  return { ok: true, checked: logs.length, brokenAt: null };
}
