import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { Pagination, readPage } from "@/components/pagination";
import { formatDate, parseTags, truncate } from "@/lib/format";
import { CUSTOMER_KIND_LABELS, type CustomerKind } from "@/lib/validation";

export const metadata: Metadata = { title: "Clientes" };

const PAGE_SIZE = 25;

type Filtro = "activos" | "archivados" | "todos";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; estado?: string; pagina?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const estado: Filtro =
    params.estado === "archivados" || params.estado === "todos"
      ? params.estado
      : "activos";
  const page = readPage(params.pagina);

  const where: Prisma.CustomerWhereInput = {
    ...(estado === "todos" ? {} : { active: estado === "activos" }),
    ...(q
      ? {
          // SQLite hace la comparación sin distinguir mayúsculas para ASCII,
          // que cubre los nombres y NIF con los que se busca en la práctica.
          OR: [
            { legalName: { contains: q } },
            { tradeName: { contains: q } },
            { taxId: { contains: q } },
            { code: { contains: q } },
            { email: { contains: q } },
            { phone: { contains: q } },
            { tags: { contains: q } },
          ],
        }
      : {}),
  };

  const [customers, total, activeCount] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { legalName: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        code: true,
        kind: true,
        legalName: true,
        tradeName: true,
        taxId: true,
        email: true,
        phone: true,
        tags: true,
        active: true,
        createdAt: true,
        _count: { select: { quotes: true, orders: true } },
      },
    }),
    prisma.customer.count({ where }),
    prisma.customer.count({ where: { active: true } }),
  ]);

  const tabs: { key: Filtro; label: string }[] = [
    { key: "activos", label: "Activos" },
    { key: "archivados", label: "Archivados" },
    { key: "todos", label: "Todos" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Clientes</h1>
          <p className="page-subtitle">{activeCount} clientes activos en la base.</p>
        </div>
        <Link href="/clientes/nuevo" className="btn-primary">
          Nuevo cliente
        </Link>
      </div>

      <div className="card">
        <div className="card-header">
          <form className="flex w-full max-w-md items-center gap-2" role="search">
            <input type="hidden" name="estado" value={estado} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por nombre, NIF, teléfono, etiqueta…"
              className="input"
              aria-label="Buscar clientes"
            />
            <button type="submit" className="btn-secondary">
              Buscar
            </button>
          </form>

          <nav className="flex items-center gap-1" aria-label="Filtrar por estado">
            {tabs.map((tab) => {
              const search = new URLSearchParams();
              if (q) search.set("q", q);
              if (tab.key !== "activos") search.set("estado", tab.key);
              const query = search.toString();
              const active = tab.key === estado;
              return (
                <Link
                  key={tab.key}
                  href={query ? `/clientes?${query}` : "/clientes"}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
                    active
                      ? "bg-ink-50 text-ink-700"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {customers.length === 0 ? (
          <p className="empty">
            {q
              ? `Ningún cliente coincide con «${q}».`
              : "Todavía no hay clientes. Crea el primero para empezar a presupuestar."}
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cliente</th>
                    <th>NIF / CIF</th>
                    <th>Contacto</th>
                    <th className="num">Presup.</th>
                    <th className="num">Pedidos</th>
                    <th>Alta</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => {
                    const tags = parseTags(customer.tags);
                    return (
                      <tr key={customer.id}>
                        <td className="font-mono text-xs text-slate-500">{customer.code}</td>
                        <td>
                          <Link
                            href={`/clientes/${customer.id}`}
                            className="font-medium text-ink-700 hover:underline"
                          >
                            {customer.legalName}
                          </Link>
                          {customer.tradeName && (
                            <span className="block text-xs text-slate-500">
                              {customer.tradeName}
                            </span>
                          )}
                          <span className="mt-1 flex flex-wrap items-center gap-1">
                            {!customer.active && <span className="pill-slate">Archivado</span>}
                            <span className="text-xs text-slate-400">
                              {CUSTOMER_KIND_LABELS[customer.kind as CustomerKind] ?? customer.kind}
                            </span>
                            {tags.map((tag) => (
                              <span key={tag} className="pill-blue">
                                {tag}
                              </span>
                            ))}
                          </span>
                        </td>
                        <td className="font-mono text-xs">{customer.taxId ?? "—"}</td>
                        <td className="text-xs">
                          {customer.email && (
                            <a href={`mailto:${customer.email}`} className="hover:underline">
                              {truncate(customer.email, 32)}
                            </a>
                          )}
                          {customer.phone && (
                            <span className="block text-slate-500">{customer.phone}</span>
                          )}
                          {!customer.email && !customer.phone && "—"}
                        </td>
                        <td className="num">{customer._count.quotes}</td>
                        <td className="num">{customer._count.orders}</td>
                        <td className="text-xs whitespace-nowrap text-slate-500">
                          {formatDate(customer.createdAt)}
                        </td>
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
              baseParams={{ q, estado: estado === "activos" ? undefined : estado }}
            />
          </>
        )}
      </div>
    </div>
  );
}
