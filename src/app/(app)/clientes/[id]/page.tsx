import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatCents, formatRate } from "@/lib/money";
import { formatDate, formatDateTime, parseTags } from "@/lib/format";
import { CUSTOMER_KIND_LABELS, type CustomerKind } from "@/lib/validation";
import { OrderStatusPill, QuoteStatusPill } from "@/components/status-pill";
import { checkTaxId } from "@/lib/tax-id";
import { ContactsCard } from "./contacts-card";
import { AddressesCard } from "./addresses-card";
import {
  deleteAddressAction,
  deleteContactAction,
  saveAddressAction,
  saveContactAction,
  toggleCustomerActiveAction,
} from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: { legalName: true },
  });
  return { title: customer?.legalName ?? "Cliente" };
}

/** Estados de presupuesto que cuentan como trabajo cerrado. */
const WON_QUOTE_STATUSES = ["ACCEPTED"];

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      addresses: { orderBy: [{ kind: "asc" }, { isDefault: "desc" }] },
      quotes: {
        orderBy: { issueDate: "desc" },
        take: 10,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          issueDate: true,
          total: true,
        },
      },
      orders: {
        orderBy: { orderDate: "desc" },
        take: 10,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          orderDate: true,
          dueDate: true,
          total: true,
        },
      },
    },
  });
  if (!customer) notFound();

  const [quoteStats, orderStats, history] = await Promise.all([
    prisma.quote.aggregate({
      where: { customerId: id, status: { in: WON_QUOTE_STATUSES } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.order.aggregate({
      where: { customerId: id, status: { notIn: ["CANCELLED"] } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { entity: "Customer", entityId: id },
          { entity: "Contact", dataJson: { contains: id } },
          { entity: "Address", dataJson: { contains: id } },
        ],
      },
      orderBy: { id: "desc" },
      take: 8,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const taxCheck = customer.taxId ? checkTaxId(customer.taxId) : null;
  const tags = parseTags(customer.tags);

  const archiveAction = toggleCustomerActiveAction.bind(null, customer.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-slate-500">{customer.code}</p>
          <h1 className="page-title">{customer.legalName}</h1>
          <p className="page-subtitle flex flex-wrap items-center gap-2">
            {customer.tradeName && <span>{customer.tradeName}</span>}
            <span className="text-slate-400">
              {CUSTOMER_KIND_LABELS[customer.kind as CustomerKind] ?? customer.kind}
            </span>
            {!customer.active && <span className="pill-slate">Archivado</span>}
            {tags.map((tag) => (
              <span key={tag} className="pill-blue">
                {tag}
              </span>
            ))}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/presupuestos/nuevo?cliente=${customer.id}`} className="btn-primary">
            Nuevo presupuesto
          </Link>
          <Link href={`/clientes/${customer.id}/editar`} className="btn-secondary">
            Editar
          </Link>
          <form action={archiveAction}>
            <button type="submit" className={customer.active ? "btn-danger" : "btn-secondary"}>
              {customer.active ? "Archivar" : "Reactivar"}
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Presupuestos aceptados
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {formatCents(quoteStats._sum.total ?? 0)}
          </p>
          <p className="text-xs text-slate-500">{quoteStats._count} presupuestos</p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Pedidos (sin anulados)
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {formatCents(orderStats._sum.total ?? 0)}
          </p>
          <p className="text-xs text-slate-500">{orderStats._count} pedidos</p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Condiciones
          </p>
          <p className="mt-1 text-sm text-slate-700">
            {customer.paymentTermsDays === 0
              ? "Pago al contado"
              : `Vencimiento a ${customer.paymentTermsDays} días`}
          </p>
          <p className="text-xs text-slate-500">
            IVA {formatRate(customer.defaultVatRate)}
            {customer.withholdingRate > 0 &&
              ` · retención ${formatRate(customer.withholdingRate)}`}
            {customer.vatExempt && " · exento"}
          </p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          <ContactsCard
            contacts={customer.contacts}
            save={saveContactAction.bind(null, customer.id)}
            remove={deleteContactAction.bind(null, customer.id)}
          />

          <AddressesCard
            addresses={customer.addresses}
            save={saveAddressAction.bind(null, customer.id)}
            remove={deleteAddressAction.bind(null, customer.id)}
          />

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Presupuestos</h2>
              <Link
                href={`/presupuestos?cliente=${customer.id}`}
                className="text-xs font-medium text-ink-700 hover:underline"
              >
                Ver todos
              </Link>
            </div>
            {customer.quotes.length === 0 ? (
              <p className="empty">Este cliente todavía no tiene presupuestos.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Trabajo</th>
                      <th>Fecha</th>
                      <th>Estado</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.quotes.map((quote) => (
                      <tr key={quote.id}>
                        <td>
                          <Link
                            href={`/presupuestos/${quote.id}`}
                            className="font-mono text-xs font-medium text-ink-700 hover:underline"
                          >
                            {quote.number ?? "Borrador"}
                          </Link>
                        </td>
                        <td className="text-sm">{quote.title ?? "—"}</td>
                        <td className="text-xs whitespace-nowrap">{formatDate(quote.issueDate)}</td>
                        <td>
                          <QuoteStatusPill status={quote.status} />
                        </td>
                        <td className="num">{formatCents(quote.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Pedidos</h2>
              <Link
                href={`/pedidos?cliente=${customer.id}`}
                className="text-xs font-medium text-ink-700 hover:underline"
              >
                Ver todos
              </Link>
            </div>
            {customer.orders.length === 0 ? (
              <p className="empty">Este cliente todavía no tiene pedidos.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Número</th>
                      <th>Trabajo</th>
                      <th>Entrega</th>
                      <th>Estado</th>
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.orders.map((order) => (
                      <tr key={order.id}>
                        <td>
                          <Link
                            href={`/pedidos/${order.id}`}
                            className="font-mono text-xs font-medium text-ink-700 hover:underline"
                          >
                            {order.number ?? "Borrador"}
                          </Link>
                        </td>
                        <td className="text-sm">{order.title ?? "—"}</td>
                        <td className="text-xs whitespace-nowrap">{formatDate(order.dueDate)}</td>
                        <td>
                          <OrderStatusPill status={order.status} />
                        </td>
                        <td className="num">{formatCents(order.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Datos fiscales</h2>
            </div>
            <dl className="card-body space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">NIF / CIF</dt>
                <dd className="font-mono">
                  {customer.taxId ?? "—"}
                  {taxCheck && !taxCheck.valid && (
                    <span className="mt-1 block font-sans text-xs text-amber-700">
                      El dígito de control no cuadra. Compruébalo antes de facturar.
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">País</dt>
                <dd>{customer.countryCode}</dd>
              </div>
              {customer.vatExempt && (
                <div>
                  <dt className="text-xs text-slate-500">Exención de IVA</dt>
                  <dd>{customer.vatExemptReason ?? "Sin causa indicada"}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-slate-500">Contacto</dt>
                <dd className="space-y-0.5">
                  {customer.email ? (
                    <a href={`mailto:${customer.email}`} className="block hover:underline">
                      {customer.email}
                    </a>
                  ) : null}
                  {customer.phone ? (
                    <a href={`tel:${customer.phone}`} className="block hover:underline">
                      {customer.phone}
                    </a>
                  ) : null}
                  {customer.website ? (
                    <a
                      href={customer.website}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="block break-all hover:underline"
                    >
                      {customer.website}
                    </a>
                  ) : null}
                  {!customer.email && !customer.phone && !customer.website && "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Alta</dt>
                <dd>{formatDate(customer.createdAt)}</dd>
              </div>
            </dl>
          </section>

          {customer.notes && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Notas internas</h2>
              </div>
              <div className="card-body">
                <p className="text-sm whitespace-pre-wrap text-slate-700">{customer.notes}</p>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Historial</h2>
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
    </div>
  );
}
