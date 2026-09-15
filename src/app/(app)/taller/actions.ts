"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { fromDateInput, formatDate } from "@/lib/format";
import {
  applyStatusChange,
  prepareSnapshotIfNeeded,
  repositionCard,
} from "@/lib/orders-server";
import { ORDER_STATUSES } from "@/lib/validation";

/**
 * Acciones del tablero y del calendario.
 *
 * A diferencia del resto de la aplicación, estas no reciben un FormData sino un
 * objeto, porque las llama el código que gestiona el arrastre y no un
 * formulario. Eso no las hace menos públicas: cualquiera puede invocarlas con
 * lo que quiera, así que la entrada se valida igual que la de un formulario.
 */

export interface CardActionResult {
  ok: boolean;
  error?: string;
}

const moveSchema = z.object({
  orderId: z.string().min(1),
  toStatus: z.enum(ORDER_STATUSES),
  /** Tarjeta ante la que se suelta; null para dejarla al final de la columna. */
  beforeId: z.string().min(1).nullable(),
});

/** Mueve una tarjeta de columna y/o la recoloca dentro de la suya. */
export async function moveCardAction(input: unknown): Promise<CardActionResult> {
  const user = await requireUser();

  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Movimiento no válido." };
  const { orderId, toStatus, beforeId } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      number: true,
      series: true,
      year: true,
      customerId: true,
    },
  });
  if (!order) return { ok: false, error: "El pedido ya no existe." };

  const cambiaDeColumna = order.status !== toStatus;
  const snapshot = cambiaDeColumna ? await prepareSnapshotIfNeeded(order, toStatus) : null;

  const resultado = await prisma.$transaction(async (tx) => {
    if (cambiaDeColumna) {
      const cambio = await applyStatusChange(tx, {
        order,
        target: toStatus,
        userId: user.id,
        snapshot,
      });
      if (!cambio.ok) return cambio;
    }

    await repositionCard(tx, { orderId, status: toStatus, beforeId });
    return { ok: true as const };
  });

  if (!resultado.ok) return { ok: false, error: resultado.error };

  revalidatePath("/taller");
  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: true };
}

const dueDateSchema = z.object({
  orderId: z.string().min(1),
  /** Fecha en formato yyyy-mm-dd, o null para dejar el pedido sin fecha. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida")
    .nullable(),
});

/** Fija la fecha de entrega al soltar una tarjeta en un día del calendario. */
export async function setDueDateAction(input: unknown): Promise<CardActionResult> {
  const user = await requireUser();

  const parsed = dueDateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Fecha no válida." };
  const { orderId, date } = parsed.data;

  const dueDate = date === null ? null : fromDateInput(date);
  if (date !== null && dueDate === null) return { ok: false, error: "Fecha no válida." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { number: true, dueDate: true, status: true },
  });
  if (!order) return { ok: false, error: "El pedido ya no existe." };

  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    return {
      ok: false,
      error: "Un pedido entregado o anulado ya no cambia de fecha de entrega.",
    };
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { dueDate } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: orderId,
      action: "UPDATE",
      summary: `Entrega del pedido ${order.number ?? "(borrador)"}: ${
        order.dueDate ? formatDate(order.dueDate) : "sin fecha"
      } → ${dueDate ? formatDate(dueDate) : "sin fecha"}`,
      data: { antes: order.dueDate, despues: dueDate },
    });
  });

  revalidatePath("/taller");
  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: true };
}
