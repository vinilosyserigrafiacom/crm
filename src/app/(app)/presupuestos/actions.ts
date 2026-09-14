"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { reserveDocumentNumber } from "@/lib/numbering";
import { getCompanySettings } from "@/lib/company";
import { loadCustomerForDocument, snapshotFor } from "@/lib/document-server";
import { prepareDocument, totalsData } from "@/lib/documents";
import { formatCents } from "@/lib/money";
import {
  QUOTE_STATUS_LABELS,
  QUOTE_TRANSITIONS,
  type QuoteStatus,
} from "@/lib/validation";
import { text, type FormState } from "@/lib/form";

export async function createQuoteAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const customerId = text(formData, "customerId").trim();
  const customer = customerId ? await loadCustomerForDocument(customerId) : null;
  if (!customer) {
    return { error: "Selecciona un cliente.", errors: { customerId: "Obligatorio" } };
  }

  const prepared = prepareDocument(formData, { withholdingRate: customer.withholdingRate });
  if (!prepared.ok) return prepared.state;
  const doc = prepared.data;

  const company = await getCompanySettings();
  const validUntil =
    doc.secondaryDate ??
    new Date(doc.primaryDate.getTime() + company.quoteValidDays * 86_400_000);

  const quoteId = await prisma.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        // El número se deja vacío a propósito: se asigna al emitir, para que un
        // borrador descartado no deje un hueco en la serie.
        series: "A",
        year: doc.primaryDate.getFullYear(),
        customerId: customer.id,
        createdById: user.id,
        status: "DRAFT",
        issueDate: doc.primaryDate,
        validUntil,
        title: doc.title,
        customerRef: doc.customerRef,
        notes: doc.notes,
        internalNotes: doc.internalNotes,
        terms: doc.terms ?? company.quoteTerms,
        ...totalsData(doc),
        lines: { create: doc.lines },
      },
    });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Quote",
      entityId: quote.id,
      action: "CREATE",
      summary: `Presupuesto creado para ${customer.legalName} por ${formatCents(quote.total)}`,
      data: { total: quote.total, lineas: doc.lines.length },
    });

    return quote.id;
  });

  revalidatePath("/presupuestos");
  redirect(`/presupuestos/${quoteId}`);
}

export async function updateQuoteAction(
  quoteId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const existing = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { id: true, status: true, total: true, number: true },
  });
  if (!existing) return { error: "El presupuesto ya no existe." };
  if (existing.status === "CANCELLED") {
    return { error: "Un presupuesto anulado no se puede modificar." };
  }

  const customerId = text(formData, "customerId").trim();
  const customer = customerId ? await loadCustomerForDocument(customerId) : null;
  if (!customer) {
    return { error: "Selecciona un cliente.", errors: { customerId: "Obligatorio" } };
  }

  const prepared = prepareDocument(formData, { withholdingRate: customer.withholdingRate });
  if (!prepared.ok) return prepared.state;
  const doc = prepared.data;

  await prisma.$transaction(async (tx) => {
    // Las líneas se reemplazan enteras en lugar de ir casando altas, bajas y
    // cambios: es más simple y el documento queda exactamente como se ve en
    // pantalla, sin restos de ediciones anteriores.
    await tx.quoteLine.deleteMany({ where: { quoteId } });

    const quote = await tx.quote.update({
      where: { id: quoteId },
      data: {
        customerId: customer.id,
        issueDate: doc.primaryDate,
        validUntil: doc.secondaryDate,
        title: doc.title,
        customerRef: doc.customerRef,
        notes: doc.notes,
        internalNotes: doc.internalNotes,
        terms: doc.terms,
        ...totalsData(doc),
        lines: { create: doc.lines },
      },
    });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Quote",
      entityId: quoteId,
      action: "UPDATE",
      summary: `Presupuesto ${quote.number ?? "(borrador)"} modificado: ${formatCents(existing.total)} → ${formatCents(quote.total)}`,
      data: { totalAnterior: existing.total, totalNuevo: quote.total },
    });
  });

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${quoteId}`);
  redirect(`/presupuestos/${quoteId}`);
}

/**
 * Cambia el estado del presupuesto.
 *
 * Al salir de borrador se le asigna número y se congela la copia de los datos
 * de facturación: a partir de ahí el documento es el que se ha enseñado al
 * cliente y no debe cambiar por tocar su ficha.
 */
export async function changeQuoteStatusAction(
  quoteId: string,
  formData: FormData,
): Promise<void> {
  const user = await requireUser();
  const target = text(formData, "status") as QuoteStatus;

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { id: true, status: true, number: true, series: true, year: true, customerId: true },
  });
  if (!quote) return;

  const allowed = QUOTE_TRANSITIONS[quote.status as QuoteStatus] ?? [];
  if (!allowed.includes(target)) return;

  const customer = await loadCustomerForDocument(quote.customerId);
  const snapshot = quote.number || !customer ? null : await snapshotFor(customer);

  await prisma.$transaction(async (tx) => {
    const data: Prisma.QuoteUpdateInput = { status: target };

    if (!quote.number && target !== "CANCELLED") {
      const reserved = await reserveDocumentNumber(tx, "QUOTE", quote.series, quote.year);
      data.number = reserved.number;
      if (snapshot) data.billingSnapshot = snapshot;
    }
    if (target === "SENT") data.sentAt = new Date();
    if (target === "ACCEPTED" || target === "REJECTED") data.decidedAt = new Date();

    const updated = await tx.quote.update({ where: { id: quoteId }, data });

    await recordAudit(tx, {
      userId: user.id,
      entity: "Quote",
      entityId: quoteId,
      action: data.number ? "ISSUE" : "STATUS_CHANGE",
      summary: `Presupuesto ${updated.number ?? "(borrador)"}: ${QUOTE_STATUS_LABELS[quote.status as QuoteStatus]} → ${QUOTE_STATUS_LABELS[target]}`,
      data: { de: quote.status, a: target, numero: updated.number },
    });
  });

  revalidatePath("/presupuestos");
  revalidatePath(`/presupuestos/${quoteId}`);
}

/**
 * Borra un presupuesto que sigue en borrador.
 *
 * Un presupuesto ya numerado no se borra nunca: se anula. Borrar documentos
 * numerados dejaría huecos en la serie.
 */
export async function deleteQuoteDraftAction(quoteId: string): Promise<void> {
  const user = await requireUser();

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { status: true, number: true, customerId: true, total: true },
  });
  if (!quote) return;
  if (quote.number || quote.status !== "DRAFT") return;

  await prisma.$transaction(async (tx) => {
    await tx.quote.delete({ where: { id: quoteId } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Quote",
      entityId: quoteId,
      action: "DELETE",
      summary: `Borrador de presupuesto eliminado (${formatCents(quote.total)})`,
      data: { customerId: quote.customerId },
    });
  });

  revalidatePath("/presupuestos");
  redirect("/presupuestos");
}

/**
 * Convierte el presupuesto en pedido copiando cabecera, líneas e importes.
 *
 * Se copia en lugar de referenciar porque el pedido es un documento propio: a
 * partir de aquí puede cambiar (una cantidad, una fecha) sin que eso reescriba
 * lo que el cliente aceptó.
 */
export async function convertQuoteToOrderAction(quoteId: string): Promise<void> {
  const user = await requireUser();

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!quote) return;
  if (quote.status === "CANCELLED") return;

  const existing = await prisma.order.findFirst({
    where: { quoteId },
    select: { id: true },
  });
  // Si ya se convirtió, se va al pedido existente en lugar de duplicarlo.
  if (existing) redirect(`/pedidos/${existing.id}`);

  const orderId = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        series: quote.series,
        year: new Date().getFullYear(),
        customerId: quote.customerId,
        quoteId: quote.id,
        createdById: user.id,
        status: "DRAFT",
        orderDate: new Date(),
        title: quote.title,
        customerRef: quote.customerRef,
        notes: quote.notes,
        internalNotes: quote.internalNotes,
        billingSnapshot: quote.billingSnapshot,
        globalDiscountRate: quote.globalDiscountRate,
        linesSubtotal: quote.linesSubtotal,
        discountTotal: quote.discountTotal,
        taxableBase: quote.taxableBase,
        vatTotal: quote.vatTotal,
        withholdingTotal: quote.withholdingTotal,
        total: quote.total,
        vatBreakdown: quote.vatBreakdown,
        currency: quote.currency,
        lines: {
          create: quote.lines.map((line) => ({
            position: line.position,
            itemId: line.itemId,
            sku: line.sku,
            description: line.description,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            discountRate: line.discountRate,
            vatRate: line.vatRate,
            grossAmount: line.grossAmount,
            discountAmount: line.discountAmount,
            netAmount: line.netAmount,
            notes: line.notes,
          })),
        },
      },
    });

    // Un presupuesto que se convierte en pedido queda aceptado: es lo que ha
    // pasado en la realidad, y así no hay que marcarlo a mano.
    if (quote.status !== "ACCEPTED") {
      await tx.quote.update({
        where: { id: quote.id },
        data: { status: "ACCEPTED", decidedAt: new Date() },
      });
    }

    await recordAudit(tx, {
      userId: user.id,
      entity: "Order",
      entityId: order.id,
      action: "CONVERT",
      summary: `Pedido creado desde el presupuesto ${quote.number ?? "(borrador)"}`,
      data: { quoteId: quote.id, total: order.total },
    });

    return order.id;
  });

  revalidatePath("/presupuestos");
  revalidatePath("/pedidos");
  redirect(`/pedidos/${orderId}`);
}
