import type { Prisma } from "@prisma/client";
import { recordAudit } from "@/lib/audit";
import { reserveDocumentNumber } from "@/lib/numbering";
import { loadCustomerForDocument, snapshotFor } from "@/lib/document-server";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type OrderStatus } from "@/lib/validation";
import { positionsFor, reorder } from "@/lib/board";

/**
 * Cambios de estado y de posición de un pedido.
 *
 * Vive aquí y no en la acción de una pantalla porque lo usan dos: la ficha del
 * pedido y el tablero de taller. Si cada una tuviera su copia, arrastrar una
 * tarjeta y pulsar un botón acabarían haciendo cosas distintas —numerar en un
 * sitio y no en el otro, por ejemplo—, que es justo el fallo que no se ve hasta
 * que falta un número en la serie.
 */

/** Campos del pedido que hacen falta para decidir el cambio. */
export interface OrderForStatusChange {
  id: string;
  status: string;
  number: string | null;
  series: string;
  year: number;
  customerId: string;
}

export type StatusChangeResult =
  | { ok: true; number: string | null }
  | { ok: false; error: string };

/**
 * Prepara la copia congelada si al pedido le toca numerarse.
 *
 * Se hace FUERA de la transacción a propósito: leer los ajustes del emisor y la
 * dirección del cliente son consultas que no necesitan estar dentro, y tenerlas
 * dentro alarga el bloqueo de escritura de SQLite sin ganar nada.
 */
export async function prepareSnapshotIfNeeded(
  order: OrderForStatusChange,
  target: OrderStatus,
): Promise<string | null> {
  if (order.number || target === "CANCELLED") return null;
  const customer = await loadCustomerForDocument(order.customerId);
  return customer ? snapshotFor(customer) : null;
}

/**
 * Aplica el cambio de estado dentro de una transacción ya abierta.
 *
 * Al salir de borrador se reserva el número y se congelan los datos de
 * facturación, igual que en un presupuesto.
 */
export async function applyStatusChange(
  tx: Prisma.TransactionClient,
  options: {
    order: OrderForStatusChange;
    target: OrderStatus;
    userId: string;
    snapshot: string | null;
  },
): Promise<StatusChangeResult> {
  const { order, target, userId, snapshot } = options;

  const permitidas = ORDER_TRANSITIONS[order.status as OrderStatus] ?? [];
  if (!permitidas.includes(target)) {
    return {
      ok: false,
      error: `Un pedido ${ORDER_STATUS_LABELS[order.status as OrderStatus]?.toLowerCase() ?? order.status} no puede pasar a ${ORDER_STATUS_LABELS[target]?.toLowerCase() ?? target}.`,
    };
  }

  const data: Prisma.OrderUpdateInput = { status: target };

  if (!order.number && target !== "CANCELLED") {
    const reservado = await reserveDocumentNumber(tx, "ORDER", order.series, order.year);
    data.number = reservado.number;
    if (snapshot) data.billingSnapshot = snapshot;
  }
  if (target === "DELIVERED") data.deliveredAt = new Date();
  // Si vuelve a producción se borra la fecha de entrega: dejarla puesta haría
  // que el pedido siguiera contando como entregado en los informes.
  if (target === "IN_PRODUCTION") data.deliveredAt = null;

  const actualizado = await tx.order.update({ where: { id: order.id }, data });

  await recordAudit(tx, {
    userId,
    entity: "Order",
    entityId: order.id,
    action: data.number ? "ISSUE" : "STATUS_CHANGE",
    summary: `Pedido ${actualizado.number ?? "(borrador)"}: ${ORDER_STATUS_LABELS[order.status as OrderStatus]} → ${ORDER_STATUS_LABELS[target]}`,
    data: { de: order.status, a: target, numero: actualizado.number },
  });

  return { ok: true, number: actualizado.number };
}

/**
 * Recoloca una tarjeta dentro de su columna y renumera las posiciones.
 *
 * Se llama después de haber cambiado el estado, ya con el pedido en la columna
 * destino, para que la lectura de la columna lo incluya.
 */
export async function repositionCard(
  tx: Prisma.TransactionClient,
  options: { orderId: string; status: OrderStatus; beforeId: string | null },
): Promise<void> {
  const columna = await tx.order.findMany({
    where: { status: options.status },
    orderBy: [{ boardPosition: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });

  const nuevoOrden = reorder(
    columna.map((o) => o.id),
    options.orderId,
    options.beforeId,
  );

  const posiciones = positionsFor(nuevoOrden);
  for (const [id, boardPosition] of posiciones) {
    await tx.order.update({ where: { id }, data: { boardPosition } });
  }
}
