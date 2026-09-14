import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getCompanySettings } from "@/lib/company";
import { DocumentSheet } from "@/components/document-sheet";
import { OrderStatusPill, QuoteStatusPill } from "@/components/status-pill";
import { formatDate, formatDateTime, describeDueDate } from "@/lib/format";
import { formatAddressLine } from "@/lib/documents";
import { companyToSheetParty, quoteToSheet } from "@/lib/sheet";
import { QUOTE_STATUS_LABELS, QUOTE_TRANSITIONS, type QuoteStatus } from "@/lib/validation";
import {
  changeQuoteStatusAction,
  convertQuoteToOrderAction,
  deleteQuoteDraftAction,
} from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const quote = await prisma.quote.findUnique({ where: { id }, select: { number: true } });
  return { title: quote?.number ?? "Presupuesto" };
}

/** Texto del botón de cada transición: un verbo, no el nombre del estado. */
const ACTION_LABELS: Partial<Record<QuoteStatus, string>> = {
  SENT: "Marcar como enviado",
  ACCEPTED: "Marcar como aceptado",
  REJECTED: "Marcar como rechazado",
  EXPIRED: "Marcar como caducado",
  CANCELLED: "Anular",
};

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } },
      createdBy: { select: { name: true } },
      customer: {
        select: {
          id: true,
          code: true,
          legalName: true,
          taxId: true,
          addresses: {
            where: { kind: "BILLING" },
            orderBy: { isDefault: "desc" },
            take: 1,
          },
        },
      },
      orders: {
        select: { id: true, number: true, status: true, dueDate: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!quote) notFound();

  const [company, history] = await Promise.all([
    getCompanySettings(),
    prisma.auditLog.findMany({
      where: { entity: "Quote", entityId: id },
      orderBy: { id: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const status = quote.status as QuoteStatus;
  const transitions = QUOTE_TRANSITIONS[status] ?? [];
  const changeStatus = changeQuoteStatusAction.bind(null, quote.id);
  const convert = convertQuoteToOrderAction.bind(null, quote.id);
  const deleteDraft = deleteQuoteDraftAction.bind(null, quote.id);

  const convertible = status === "SENT" || status === "ACCEPTED" || status === "DRAFT";
  const alreadyConverted = quote.orders.length > 0;

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 font-mono text-xs text-slate-500">
            {quote.number ?? "Sin numerar"}
            <QuoteStatusPill status={quote.status} />
          </p>
          <h1 className="page-title">{quote.title ?? "Presupuesto"}</h1>
          <p className="page-subtitle">
            <Link href={`/clientes/${quote.customer.id}`} className="hover:underline">
              {quote.customer.legalName}
            </Link>
            {" · "}
            {formatDate(quote.issueDate)}
            {quote.validUntil && status === "SENT" && (
              <> · válido {describeDueDate(quote.validUntil).toLowerCase()}</>
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/presupuestos/${quote.id}/imprimir`} className="btn-secondary">
            Imprimir / PDF
          </Link>
          {status !== "CANCELLED" && (
            <Link href={`/presupuestos/${quote.id}/editar`} className="btn-secondary">
              Editar
            </Link>
          )}
          {convertible && !alreadyConverted && (
            <form action={convert}>
              <button type="submit" className="btn-primary">
                Convertir en pedido
              </button>
            </form>
          )}
        </div>
      </div>

      {alreadyConverted && (
        <div className="no-print card card-body flex flex-wrap items-center gap-3 text-sm">
          <span className="text-slate-600">Este presupuesto ya tiene pedido:</span>
          {quote.orders.map((order) => (
            <Link
              key={order.id}
              href={`/pedidos/${order.id}`}
              className="flex items-center gap-2 font-mono text-xs font-medium text-ink-700 hover:underline"
            >
              {order.number ?? "Borrador"}
              <OrderStatusPill status={order.status} />
            </Link>
          ))}
        </div>
      )}

      {transitions.length > 0 && (
        <div className="no-print card card-body flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Estado
          </span>
          {transitions.map((target) => (
            <form key={target} action={changeStatus}>
              <input type="hidden" name="status" value={target} />
              <button
                type="submit"
                className={target === "CANCELLED" ? "btn-danger btn-sm" : "btn-secondary btn-sm"}
              >
                {ACTION_LABELS[target] ?? QUOTE_STATUS_LABELS[target]}
              </button>
            </form>
          ))}
          {!quote.number && status === "DRAFT" && (
            <form action={deleteDraft} className="ml-auto">
              <button type="submit" className="btn-ghost btn-sm text-red-600 hover:bg-red-50">
                Borrar borrador
              </button>
            </form>
          )}
        </div>
      )}

      <DocumentSheet
        document={quoteToSheet(quote)}
        company={companyToSheetParty(company)}
        customer={{
          legalName: quote.customer.legalName,
          taxId: quote.customer.taxId,
          address: formatAddressLine(quote.customer.addresses[0] ?? null),
          code: quote.customer.code,
        }}
      />

      <div className="no-print grid gap-5 lg:grid-cols-2">
        {quote.internalNotes && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Notas internas</h2>
            </div>
            <div className="card-body">
              <p className="text-sm whitespace-pre-wrap text-slate-700">{quote.internalNotes}</p>
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Historial</h2>
            {quote.createdBy && (
              <p className="text-xs text-slate-500">Creado por {quote.createdBy.name}</p>
            )}
          </div>
          {history.length === 0 ? (
            <p className="empty">Sin movimientos registrados.</p>
          ) : (
            <ul className="card-body space-y-3">
              {history.map((entry) => (
                <li key={entry.id} className="text-xs">
                  <p className="text-slate-700">{entry.summary}</p>
                  <p className="text-slate-400">
                    {formatDateTime(entry.at)}
                    {entry.user && ` · ${entry.user.name}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
