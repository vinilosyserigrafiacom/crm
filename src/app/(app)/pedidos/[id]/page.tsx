import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getCompanySettings } from "@/lib/company";
import { DocumentSheet } from "@/components/document-sheet";
import { OrderStatusPill } from "@/components/status-pill";
import { describeDueDate, documentNumber, formatDate, formatDateTime, toDateInput } from "@/lib/format";
import { formatAddressLine } from "@/lib/documents";
import { companyToSheetParty, orderToSheet } from "@/lib/sheet";
import { ORDER_STATUS_LABELS, ORDER_TRANSITIONS, type OrderStatus } from "@/lib/validation";
import {
  changeOrderStatusAction,
  deleteOrderDraftAction,
  updateOrderDueDateAction,
  updateOrderInternalNotesAction,
} from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, select: { number: true } });
  return { title: order?.number ?? "Pedido" };
}

/** Texto del botón de cada transición: lo que se hace, no el estado destino. */
const ACTION_LABELS: Partial<Record<OrderStatus, string>> = {
  CONFIRMED: "Confirmar pedido",
  IN_PRODUCTION: "Pasar a producción",
  READY: "Marcar como listo",
  DELIVERED: "Marcar como entregado",
  CANCELLED: "Anular",
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } },
      createdBy: { select: { name: true } },
      quote: { select: { id: true, number: true, status: true } },
      customer: {
        select: {
          id: true,
          code: true,
          legalName: true,
          taxId: true,
          phone: true,
          email: true,
          addresses: {
            where: { kind: "BILLING" },
            orderBy: { isDefault: "desc" },
            take: 1,
          },
          contacts: {
            where: { isPrimary: true },
            take: 1,
            select: { name: true, phone: true, email: true },
          },
        },
      },
    },
  });
  if (!order) notFound();

  const [company, history] = await Promise.all([
    getCompanySettings(),
    prisma.auditLog.findMany({
      where: { entity: "Order", entityId: id },
      orderBy: { id: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const status = order.status as OrderStatus;
  const transitions = ORDER_TRANSITIONS[status] ?? [];
  const changeStatus = changeOrderStatusAction.bind(null, order.id);
  const setDueDate = updateOrderDueDateAction.bind(null, order.id);
  const deleteDraft = deleteOrderDraftAction.bind(null, order.id);

  // Las líneas de un pedido de la tienda las manda WooCommerce y la siguiente
  // sincronización las reescribe, así que aquí no se editan.
  const fromStore = order.source === "WOOCOMMERCE";
  const editable = status !== "CANCELLED" && status !== "DELIVERED" && !fromStore;
  const contact = order.customer.contacts[0] ?? null;
  /** La entrega y las notas se tocan aunque el pedido venga de la tienda. */
  const schedulable = status !== "CANCELLED" && status !== "DELIVERED";
  /** Sin editor, las notas de un pedido de la tienda se escriben aquí mismo. */
  const notesHere = fromStore && schedulable;
  const setInternalNotes = updateOrderInternalNotesAction.bind(null, order.id);

  return (
    <div className="space-y-5">
      <div className="no-print flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-500">
            {documentNumber(order)}
            <OrderStatusPill status={order.status} />
            {order.source === "WOOCOMMERCE" && (
              <span className="pill-violet">Importado de la tienda</span>
            )}
          </p>
          <h1 className="page-title">{order.title ?? "Pedido"}</h1>
          <p className="page-subtitle">
            <Link href={`/clientes/${order.customer.id}`} className="hover:underline">
              {order.customer.legalName}
            </Link>
            {" · pedido del "}
            {formatDate(order.orderDate)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/pedidos/${order.id}/imprimir`} className="btn-secondary">
            Imprimir / PDF
          </Link>
          {editable && (
            <Link href={`/pedidos/${order.id}/editar`} className="btn-secondary">
              Editar
            </Link>
          )}
          {fromStore && (
            <p className="max-w-xs text-xs text-slate-500">
              Las líneas y los importes los manda la tienda. Aquí se cambian el estado, la
              entrega y las notas internas.
            </p>
          )}
        </div>
      </div>

      <div className="no-print grid gap-4 sm:grid-cols-3">
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Entrega</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {formatDate(order.dueDate)}
          </p>
          <p className="text-xs text-slate-500">
            {order.deliveredAt
              ? `Entregado el ${formatDate(order.deliveredAt)}`
              : describeDueDate(order.dueDate)}
          </p>
          {schedulable && (
            <form action={setDueDate} className="mt-2 flex items-center gap-2">
              <input
                type="date"
                name="dueDate"
                defaultValue={toDateInput(order.dueDate)}
                className="input text-xs"
                aria-label="Nueva fecha de entrega"
              />
              <button type="submit" className="btn-secondary btn-sm">
                Fijar
              </button>
            </form>
          )}
        </div>

        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Contacto</p>
          {contact ? (
            <>
              <p className="mt-1 text-sm font-medium text-slate-900">{contact.name}</p>
              <p className="text-xs text-slate-600">
                {[contact.phone, contact.email].filter(Boolean).join(" · ") || "Sin datos"}
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-600">
              {[order.customer.phone, order.customer.email].filter(Boolean).join(" · ") ||
                "Sin contacto registrado"}
            </p>
          )}
        </div>

        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">Origen</p>
          {order.quote ? (
            <Link
              href={`/presupuestos/${order.quote.id}`}
              className="mt-1 block font-mono text-sm font-medium text-ink-700 hover:underline"
            >
              {order.quote.number ?? "Borrador"}
            </Link>
          ) : (
            <p className="mt-1 text-sm text-slate-700">Pedido directo, sin presupuesto</p>
          )}
          {order.customerRef && (
            <p className="text-xs text-slate-500">Su referencia: {order.customerRef}</p>
          )}
        </div>
      </div>

      {transitions.length > 0 && (
        <div className="no-print card card-body flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-medium tracking-wide text-slate-500 uppercase">
            Taller
          </span>
          {transitions.map((target) => (
            <form key={target} action={changeStatus}>
              <input type="hidden" name="status" value={target} />
              <button
                type="submit"
                className={
                  target === "CANCELLED"
                    ? "btn-danger btn-sm"
                    : target === "DELIVERED"
                      ? "btn-primary btn-sm"
                      : "btn-secondary btn-sm"
                }
              >
                {ACTION_LABELS[target] ?? ORDER_STATUS_LABELS[target]}
              </button>
            </form>
          ))}
          {!order.number && status === "DRAFT" && (
            <form action={deleteDraft} className="ml-auto">
              <button type="submit" className="btn-ghost btn-sm text-red-600 hover:bg-red-50">
                Borrar borrador
              </button>
            </form>
          )}
        </div>
      )}

      <DocumentSheet
        document={orderToSheet(order)}
        company={companyToSheetParty(company)}
        customer={{
          legalName: order.customer.legalName,
          taxId: order.customer.taxId,
          address: formatAddressLine(order.customer.addresses[0] ?? null),
          code: order.customer.code,
        }}
      />

      <div className="no-print grid gap-5 lg:grid-cols-2">
        {(order.internalNotes || notesHere) && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Notas internas</h2>
              <p className="text-xs text-slate-500">No salen en la hoja del cliente.</p>
            </div>
            {notesHere ? (
              <form action={setInternalNotes} className="card-body space-y-2">
                <label htmlFor="internalNotes" className="sr-only">
                  Notas internas
                </label>
                <textarea
                  id="internalNotes"
                  name="internalNotes"
                  rows={4}
                  defaultValue={order.internalNotes ?? ""}
                  className="input"
                  placeholder="Lo que haga falta recordar de este pedido…"
                />
                <button type="submit" className="btn-secondary btn-sm">
                  Guardar notas
                </button>
              </form>
            ) : (
              <div className="card-body">
                <p className="text-sm whitespace-pre-wrap text-slate-700">{order.internalNotes}</p>
              </div>
            )}
          </section>
        )}

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Historial</h2>
            {order.createdBy && (
              <p className="text-xs text-slate-500">Creado por {order.createdBy.name}</p>
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
