import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Pagination, readPage } from "@/components/pagination";
import { OrderStatusPill } from "@/components/status-pill";
import { formatCents } from "@/lib/money";
import { daysUntil, formatDate, truncate } from "@/lib/format";
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from "@/lib/validation";

export const metadata: Metadata = { title: "Pedidos" };

const PAGE_SIZE = 25;

/** Estados en los que el trabajo sigue vivo en el taller. */
const OPEN_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY"];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; cliente?: string; pagina?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const estado = ORDER_STATUSES.includes(params.estado as OrderStatus)
    ? (params.estado as OrderStatus)
    : undefined;
  const clienteId = (params.cliente ?? "").trim() || undefined;
  const page = readPage(params.pagina);

  const where: Prisma.OrderWhereInput = {
    ...(estado ? { status: estado } : {}),
    ...(clienteId ? { customerId: clienteId } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q } },
            { title: { contains: q } },
            { customerRef: { contains: q } },
            { customer: { legalName: { contains: q } } },
            { customer: { tradeName: { contains: q } } },
          ],
        }
      : {}),
  };

  const [orders, total, open, customer] = await Promise.all([
    prisma.order.findMany({
      where,
      // Los pedidos abiertos se ordenan por entrega: lo que hay que sacar antes
      // va primero, que es como se mira esta pantalla en el taller.
      orderBy: [{ dueDate: "asc" }, { orderDate: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        orderDate: true,
        dueDate: true,
        total: true,
        customer: { select: { id: true, legalName: true } },
        quote: { select: { id: true, number: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.aggregate({
      where: { status: { in: OPEN_STATUSES } },
      _sum: { total: true },
      _count: true,
    }),
    clienteId
      ? prisma.customer.findUnique({ where: { id: clienteId }, select: { legalName: true } })
      : null,
  ]);

  const filterHref = (nextEstado?: OrderStatus) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (clienteId) search.set("cliente", clienteId);
    if (nextEstado) search.set("estado", nextEstado);
    const query = search.toString();
    return query ? `/pedidos?${query}` : "/pedidos";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Pedidos</h1>
          <p className="page-subtitle">
            {open._count} en curso por {formatCents(open._sum.total ?? 0)}.
            {customer && ` Filtrando por ${customer.legalName}.`}
          </p>
        </div>
        <Link href="/pedidos/nuevo" className="btn-primary">
          Nuevo pedido
        </Link>
      </div>

      <div className="card">
        <div className="card-header">
          <form className="flex w-full max-w-md items-center gap-2" role="search">
            {estado && <input type="hidden" name="estado" value={estado} />}
            {clienteId && <input type="hidden" name="cliente" value={clienteId} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por número, trabajo o cliente…"
              className="input"
              aria-label="Buscar pedidos"
            />
            <button type="submit" className="btn-secondary">
              Buscar
            </button>
          </form>

          <nav className="flex flex-wrap items-center gap-1" aria-label="Filtrar por estado">
            <Link
              href={filterHref()}
              aria-current={estado ? undefined : "page"}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                estado ? "text-slate-500 hover:bg-slate-100" : "bg-ink-50 text-ink-700"
              }`}
            >
              Todos
            </Link>
            {ORDER_STATUSES.map((status) => (
              <Link
                key={status}
                href={filterHref(status)}
                aria-current={estado === status ? "page" : undefined}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                  estado === status
                    ? "bg-ink-50 text-ink-700"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                {ORDER_STATUS_LABELS[status]}
              </Link>
            ))}
          </nav>
        </div>

        {orders.length === 0 ? (
          <p className="empty">
            {q || estado
              ? "Ningún pedido coincide con el filtro."
              : "Todavía no hay pedidos. Se crean aceptando un presupuesto o directamente aquí."}
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Número</th>
                    <th>Cliente</th>
                    <th>Trabajo</th>
                    <th>Entrega</th>
                    <th>Estado</th>
                    <th>Presupuesto</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    const remaining = daysUntil(order.dueDate);
                    const isOpen = OPEN_STATUSES.includes(order.status as OrderStatus);
                    const late = isOpen && remaining !== null && remaining < 0;
                    const soon = isOpen && remaining !== null && remaining >= 0 && remaining <= 2;

                    return (
                      <tr key={order.id}>
                        <td>
                          <Link
                            href={`/pedidos/${order.id}`}
                            className="font-mono text-xs font-medium text-ink-700 hover:underline"
                          >
                            {order.number ?? "Borrador"}
                          </Link>
                        </td>
                        <td>
                          <Link
                            href={`/clientes/${order.customer.id}`}
                            className="text-sm hover:underline"
                          >
                            {truncate(order.customer.legalName, 34)}
                          </Link>
                        </td>
                        <td className="text-sm text-slate-600">
                          {order.title ? truncate(order.title, 40) : "—"}
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          <span
                            className={
                              late
                                ? "font-medium text-red-700"
                                : soon
                                  ? "font-medium text-amber-700"
                                  : ""
                            }
                          >
                            {formatDate(order.dueDate)}
                          </span>
                          {late && <span className="pill-red ml-1">Retrasado</span>}
                        </td>
                        <td>
                          <OrderStatusPill status={order.status} />
                        </td>
                        <td>
                          {order.quote ? (
                            <Link
                              href={`/presupuestos/${order.quote.id}`}
                              className="font-mono text-xs hover:underline"
                            >
                              {order.quote.number ?? "Borrador"}
                            </Link>
                          ) : (
                            <span className="text-xs text-slate-400">Directo</span>
                          )}
                        </td>
                        <td className="num font-medium">{formatCents(order.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={total}
              baseParams={{ q, estado, cliente: clienteId }}
            />
          </>
        )}
      </div>
    </div>
  );
}
