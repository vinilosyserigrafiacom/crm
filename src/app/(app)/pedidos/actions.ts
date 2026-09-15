"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { loadCustomerForDocument } from "@/lib/document-server";
import {
  applyStatusChange,
  prepareSnapshotIfNeeded,
  repositionCard,
} from "@/lib/orders-server";
import { prepareDocument, totalsData } from "@/lib/documents";
import { formatCents } from "@/lib/money";
import { fromDateInput } from "@/lib/format";
import type { OrderStatus } from "@/lib/validation";
import { snapshotValues, text, type FormState } from "@/lib/form";

export async function createOrderAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerId = text(formData, "customerId").trim();
  const customer = customerId
    ? await loadCustomerForDocument(customerId)
    : null;
  if (!customer) {
    return {
      error: "Selecciona un cliente.",
      errors: { customerId: "Obligatorio" },
      values: snapshotValues(formData),
    };
  }

  const prepared = prepareDocument(formData, {
    withholdingRate: customer.withholdingRate,
  });
  if (!prepared.ok) return prepared.state;
  const doc = prepared.data;

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        series: "A",
        year: doc.primaryDate.getFullYear(),
        customerId: customer.id,
        createdById: user.id,
        status: "DRAFT",
        orderDate: doc.primaryDate,
        dueDate: doc.secondaryDate,
        title: doc.title,
        customerRef: doc.customerRef,
        notes: doc.notes,
        internalNotes: doc.internalNotes,
        ...totalsData(doc),
        lines: { create: doc.lines },
      },
    });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: order.id,
      action: "CREATE",
      summary: `Pedido creado para ${customer.legalName} por ${formatCents(order.total)}`,
      data: { total: order.total, lineas: doc.lines.length },
    });

    return order.id;
  });

  revalidatePath("/pedidos");
  redirect(`/pedidos/${orderId}`);
}

export async function updateOrderAction(
  orderId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, total: true, number: true, source: true },
  });
  if (!existing) return { error: "El pedido ya no existe." };
  // Las líneas de un pedido de la tienda las reescribe la siguiente
  // sincronización: dejar editarlas aquí sería prometer un cambio que se
  // deshace solo.
  if (existing.source === "WOOCOMMERCE") {
    return {
      error:
        "Este pedido viene de la tienda y sus líneas las manda WooCommerce. " +
        "Aquí puedes cambiar el estado, la entrega y las notas internas.",
    };
  }
  if (existing.status === "CANCELLED" || existing.status === "DELIVERED") {
    return {
      error:
        existing.status === "CANCELLED"
          ? "Un pedido anulado no se puede modificar."
          : "Un pedido ya entregado no se puede modificar.",
    };
  }

  const customerId = text(formData, "customerId").trim();
  const customer = customerId
    ? await loadCustomerForDocument(customerId)
    : null;
  if (!customer) {
    return {
      error: "Selecciona un cliente.",
      errors: { customerId: "Obligatorio" },
      values: snapshotValues(formData),
    };
  }

  const prepared = prepareDocument(formData, {
    withholdingRate: customer.withholdingRate,
  });
  if (!prepared.ok) return prepared.state;
  const doc = prepared.data;

  await prisma.$transaction(async (tx) => {
    await tx.orderLine.deleteMany({ where: { orderId } });

    const order = await tx.order.update({
      where: { id: orderId },
      data: {
        customerId: customer.id,
        orderDate: doc.primaryDate,
        dueDate: doc.secondaryDate,
        title: doc.title,
        customerRef: doc.customerRef,
        notes: doc.notes,
        internalNotes: doc.internalNotes,
        ...totalsData(doc),
        lines: { create: doc.lines },
      },
    });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: orderId,
      action: "UPDATE",
      summary: `Pedido ${order.number ?? "(borrador)"} modificado: ${formatCents(existing.total)} → ${formatCents(order.total)}`,
      data: { totalAnterior: existing.total, totalNuevo: order.total },
    });
  });

  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
  redirect(`/pedidos/${orderId}`);
}

/**
 * Avanza el pedido por los estados del taller.
 *
 * Al confirmarlo se le asigna número y se congelan los datos de facturación,
 * igual que en un presupuesto: desde ese momento el pedido es un compromiso con
 * el cliente y no debe cambiar por editar su ficha.
 */
export async function changeOrderStatusAction(
  orderId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const target = text(formData, "status") as OrderStatus;

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
  if (!order) return;

  const snapshot = await prepareSnapshotIfNeeded(order, target);

  await prisma.$transaction(async (tx) => {
    const resultado = await applyStatusChange(tx, {
      order,
      target,
      userId: user.id,
      snapshot,
    });
    // Desde la ficha los botones solo ofrecen transiciones válidas, así que un
    // rechazo aquí solo puede venir de que alguien haya movido el pedido desde
    // otra pantalla mientras tanto. Se deja como estaba y la página recargada
    // mostrará el estado real.
    if (!resultado.ok) return;

    await repositionCard(tx, { orderId, status: target, beforeId: null });
  });

  revalidatePath("/pedidos");
  revalidatePath("/taller");
  revalidatePath(`/pedidos/${orderId}`);
}

/** Cambia la fecha de entrega comprometida sin tocar el resto del pedido. */
export async function updateOrderDueDateAction(
  orderId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();

  const raw = text(formData, "dueDate");
  const dueDate = fromDateInput(raw);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { number: true, dueDate: true },
  });
  if (!order) return;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { dueDate } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: orderId,
      action: "UPDATE",
      summary: `Entrega del pedido ${order.number ?? "(borrador)"} fijada al ${raw || "sin fecha"}`,
      data: { antes: order.dueDate, despues: dueDate },
    });
  });

  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${orderId}`);
}

/**
 * Cambia las notas internas sin pasar por el editor.
 *
 * Existe por los pedidos de la tienda: su editor está cerrado porque las líneas
 * las manda WooCommerce, pero el taller sigue necesitando apuntar sus cosas.
 */
export async function updateOrderInternalNotesAction(
  orderId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();

  const internalNotes = text(formData, "internalNotes").trim() || null;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { number: true, wooNumber: true, status: true },
  });
  if (!order) return;
  // Un pedido cerrado no se anota: lo que pone ya es historia.
  if (order.status === "CANCELLED" || order.status === "DELIVERED") return;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { internalNotes } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: orderId,
      action: "UPDATE",
      summary: `Notas internas del pedido ${order.number ?? `#${order.wooNumber ?? "(borrador)"}`} ${
        internalNotes ? "actualizadas" : "borradas"
      }`,
    });
  });

  revalidatePath(`/pedidos/${orderId}`);
}

/** Borra un pedido que sigue en borrador y nunca se ha numerado. */
export async function deleteOrderDraftAction(orderId: string): Promise<void> {
  const user = await requireUser();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, number: true, total: true, customerId: true },
  });
  if (!order) return;
  if (order.number || order.status !== "DRAFT") return;

  await prisma.$transaction(async (tx) => {
    await tx.order.delete({ where: { id: orderId } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: orderId,
      action: "DELETE",
      summary: `Borrador de pedido eliminado (${formatCents(order.total)})`,
      data: { customerId: order.customerId },
    });
  });

  revalidatePath("/pedidos");
  redirect("/pedidos");
}
