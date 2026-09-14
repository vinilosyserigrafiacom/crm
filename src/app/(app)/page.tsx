import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import { describeDueDate, formatDate, formatDateTime, truncate } from "@/lib/format";
import { OrderStatusPill } from "@/components/status-pill";
import type { OrderStatus } from "@/lib/validation";

/** Estados en los que el pedido sigue vivo en el taller. */
const OPEN_ORDER_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY"];

function Kpi({
  label,
  value,
  detail,
  href,
  tone = "normal",
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
  tone?: "normal" | "warn";
}) {
  return (
    <Link href={href} className="card card-body transition-colors hover:border-ink-300">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === "warn" ? "text-amber-700" : "text-slate-900"
        }`}
      >
        {value}
      </p>
      <p className="text-xs text-slate-500">{detail}</p>
    </Link>
  );
}

export default async function DashboardPage() {
  const user = await requireUser();

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const in7Days = new Date(startOfToday.getTime() + 7 * 86_400_000);
  const ninetyDaysAgo = new Date(startOfToday.getTime() - 90 * 86_400_000);

  const [
    openQuotes,
    openOrders,
    lateOrders,
    weekDeliveries,
    decided,
    accepted,
    upcoming,
    quotesToChase,
    recent,
  ] = await Promise.all([
    prisma.quote.aggregate({
      where: { status: { in: ["DRAFT", "SENT"] } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.order.aggregate({
      where: { status: { in: OPEN_ORDER_STATUSES } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.order.count({
      where: {
        status: { in: ["CONFIRMED", "IN_PRODUCTION", "READY"] },
        dueDate: { lt: startOfToday },
      },
    }),
    prisma.order.count({
      where: {
        status: { in: OPEN_ORDER_STATUSES },
        dueDate: { gte: startOfToday, lt: in7Days },
      },
    }),
    // Tasa de aceptación de los últimos 90 días: solo cuentan los presupuestos
    // que ya tienen respuesta, no los que siguen en la calle.
    prisma.quote.count({
      where: { status: { in: ["ACCEPTED", "REJECTED"] }, decidedAt: { gte: ninetyDaysAgo } },
    }),
    prisma.quote.count({
      where: { status: "ACCEPTED", decidedAt: { gte: ninetyDaysAgo } },
    }),
    prisma.order.findMany({
      where: { status: { in: OPEN_ORDER_STATUSES } },
      orderBy: [{ dueDate: "asc" }],
      take: 8,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        dueDate: true,
        total: true,
        customer: { select: { legalName: true } },
      },
    }),
    prisma.quote.findMany({
      where: { status: "SENT" },
      orderBy: [{ validUntil: "asc" }],
      take: 6,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        validUntil: true,
        total: true,
        customer: { select: { legalName: true } },
      },
    }),
    prisma.auditLog.findMany({
      orderBy: { id: "desc" },
      take: 10,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const acceptanceRate = decided === 0 ? null : Math.round((accepted / decided) * 100);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Hola, {user.name.split(" ")[0]}</h1>
        <p className="page-subtitle">Esto es lo que hay abierto ahora mismo en el taller.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Presupuestos abiertos"
          value={String(openQuotes._count)}
          detail={`${formatCents(openQuotes._sum.total ?? 0)} pendientes de respuesta`}
          href="/presupuestos?estado=SENT"
        />
        <Kpi
          label="Pedidos en curso"
          value={String(openOrders._count)}
          detail={`${formatCents(openOrders._sum.total ?? 0)} en producción`}
          href="/pedidos"
        />
        <Kpi
          label="Entregas esta semana"
          value={String(weekDeliveries)}
          detail={lateOrders > 0 ? `${lateOrders} ya con retraso` : "Ninguna con retraso"}
          href="/pedidos"
          tone={lateOrders > 0 ? "warn" : "normal"}
        />
        <Kpi
          label="Aceptación (90 días)"
          value={acceptanceRate === null ? "—" : `${acceptanceRate}%`}
          detail={
            decided === 0
              ? "Sin presupuestos cerrados todavía"
              : `${accepted} de ${decided} presupuestos aceptados`
          }
          href="/presupuestos?estado=ACCEPTED"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Próximas entregas</h2>
            <Link href="/pedidos" className="text-xs font-medium text-ink-700 hover:underline">
              Ver pedidos
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="empty">No hay pedidos abiertos.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Pedido</th>
                    <th>Cliente</th>
                    <th>Entrega</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((order) => (
                    <tr key={order.id}>
                      <td>
                        <Link
                          href={`/pedidos/${order.id}`}
                          className="font-mono text-xs font-medium text-ink-700 hover:underline"
                        >
                          {order.number ?? "Borrador"}
                        </Link>
                        {order.title && (
                          <span className="block text-xs text-slate-500">
                            {truncate(order.title, 32)}
                          </span>
                        )}
                      </td>
                      <td className="text-sm">{truncate(order.customer.legalName, 26)}</td>
                      <td className="text-xs whitespace-nowrap">
                        {formatDate(order.dueDate)}
                        <span className="block text-slate-400">
                          {describeDueDate(order.dueDate)}
                        </span>
                      </td>
                      <td>
                        <OrderStatusPill status={order.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Presupuestos por cerrar</h2>
            <Link
              href="/presupuestos?estado=SENT"
              className="text-xs font-medium text-ink-700 hover:underline"
            >
              Ver enviados
            </Link>
          </div>
          {quotesToChase.length === 0 ? (
            <p className="empty">No hay presupuestos enviados esperando respuesta.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Presupuesto</th>
                    <th>Cliente</th>
                    <th>Validez</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotesToChase.map((quote) => (
                    <tr key={quote.id}>
                      <td>
                        <Link
                          href={`/presupuestos/${quote.id}`}
                          className="font-mono text-xs font-medium text-ink-700 hover:underline"
                        >
                          {quote.number ?? "Borrador"}
                        </Link>
                        {quote.title && (
                          <span className="block text-xs text-slate-500">
                            {truncate(quote.title, 32)}
                          </span>
                        )}
                      </td>
                      <td className="text-sm">{truncate(quote.customer.legalName, 24)}</td>
                      <td className="text-xs whitespace-nowrap">
                        {describeDueDate(quote.validUntil)}
                      </td>
                      <td className="num">{formatCents(quote.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Últimos movimientos</h2>
        </div>
        {recent.length === 0 ? (
          <p className="empty">
            Todavía no hay actividad. Empieza dando de alta un cliente y su primer presupuesto.
          </p>
        ) : (
          <ul className="card-body space-y-2.5">
            {recent.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="text-slate-700">{entry.summary}</span>
                <span className="text-xs text-slate-400">
                  {formatDateTime(entry.at)}
                  {entry.user && ` · ${entry.user.name}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
