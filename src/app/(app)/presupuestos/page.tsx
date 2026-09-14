import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Pagination, readPage } from "@/components/pagination";
import { QuoteStatusPill } from "@/components/status-pill";
import { formatCents } from "@/lib/money";
import { daysUntil, formatDate, truncate } from "@/lib/format";
import { QUOTE_STATUS_LABELS, QUOTE_STATUSES, type QuoteStatus } from "@/lib/validation";

export const metadata: Metadata = { title: "Presupuestos" };

const PAGE_SIZE = 25;

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; cliente?: string; pagina?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const estado = QUOTE_STATUSES.includes(params.estado as QuoteStatus)
    ? (params.estado as QuoteStatus)
    : undefined;
  const clienteId = (params.cliente ?? "").trim() || undefined;
  const page = readPage(params.pagina);

  const where: Prisma.QuoteWhereInput = {
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

  const [quotes, total, pending, customer] = await Promise.all([
    prisma.quote.findMany({
      where,
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        issueDate: true,
        validUntil: true,
        total: true,
        customer: { select: { id: true, legalName: true } },
        _count: { select: { orders: true } },
      },
    }),
    prisma.quote.count({ where }),
    prisma.quote.aggregate({
      where: { status: { in: ["DRAFT", "SENT"] } },
      _sum: { total: true },
      _count: true,
    }),
    clienteId
      ? prisma.customer.findUnique({
          where: { id: clienteId },
          select: { legalName: true },
        })
      : null,
  ]);

  const baseParams = { q, estado, cliente: clienteId };

  const filterHref = (nextEstado?: QuoteStatus) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (clienteId) search.set("cliente", clienteId);
    if (nextEstado) search.set("estado", nextEstado);
    const query = search.toString();
    return query ? `/presupuestos?${query}` : "/presupuestos";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Presupuestos</h1>
          <p className="page-subtitle">
            {pending._count} sin cerrar por {formatCents(pending._sum.total ?? 0)}.
            {customer && ` Filtrando por ${customer.legalName}.`}
          </p>
        </div>
        <Link href="/presupuestos/nuevo" className="btn-primary">
          Nuevo presupuesto
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
              aria-label="Buscar presupuestos"
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
            {QUOTE_STATUSES.map((status) => (
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
                {QUOTE_STATUS_LABELS[status]}
              </Link>
            ))}
          </nav>
        </div>

        {quotes.length === 0 ? (
          <p className="empty">
            {q || estado
              ? "Ningún presupuesto coincide con el filtro."
              : "Todavía no hay presupuestos. Crea el primero desde la ficha de un cliente o aquí."}
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
                    <th>Fecha</th>
                    <th>Validez</th>
                    <th>Estado</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => {
                    const remaining = daysUntil(quote.validUntil);
                    const expiring =
                      quote.status === "SENT" && remaining !== null && remaining <= 3;
                    return (
                      <tr key={quote.id}>
                        <td>
                          <Link
                            href={`/presupuestos/${quote.id}`}
                            className="font-mono text-xs font-medium text-ink-700 hover:underline"
                          >
                            {quote.number ?? "Borrador"}
                          </Link>
                          {quote._count.orders > 0 && (
                            <span className="pill-green mt-1">Con pedido</span>
                          )}
                        </td>
                        <td>
                          <Link
                            href={`/clientes/${quote.customer.id}`}
                            className="text-sm hover:underline"
                          >
                            {truncate(quote.customer.legalName, 34)}
                          </Link>
                        </td>
                        <td className="text-sm text-slate-600">
                          {quote.title ? truncate(quote.title, 40) : "—"}
                        </td>
                        <td className="text-xs whitespace-nowrap">{formatDate(quote.issueDate)}</td>
                        <td className="text-xs whitespace-nowrap">
                          <span className={expiring ? "font-medium text-amber-700" : ""}>
                            {formatDate(quote.validUntil)}
                          </span>
                        </td>
                        <td>
                          <QuoteStatusPill status={quote.status} />
                        </td>
                        <td className="num font-medium">{formatCents(quote.total)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={total} baseParams={baseParams} />
          </>
        )}
      </div>
    </div>
  );
}
