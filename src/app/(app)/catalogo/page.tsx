import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ItemsTable } from "./items-table";
import { saveItemAction, toggleItemActiveAction } from "./actions";

export const metadata: Metadata = { title: "Catálogo" };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; familia?: string; inactivos?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  const q = (params.q ?? "").trim();
  const familia = (params.familia ?? "").trim();
  const showInactive = params.inactivos === "1";

  const where: Prisma.ItemWhereInput = {
    ...(showInactive ? {} : { active: true }),
    ...(familia ? { category: familia } : {}),
    ...(q
      ? {
          OR: [
            { sku: { contains: q } },
            { name: { contains: q } },
            { description: { contains: q } },
          ],
        }
      : {}),
  };

  const [items, categoryRows] = await Promise.all([
    prisma.item.findMany({
      where,
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.item.findMany({
      where: { category: { not: null } },
      distinct: ["category"],
      select: { category: true },
      orderBy: { category: "asc" },
    }),
  ]);

  const categories = categoryRows
    .map((row) => row.category)
    .filter((category): category is string => Boolean(category));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Catálogo</h1>
        <p className="page-subtitle">
          Trabajos y materiales que se repiten, con su precio y su margen.
        </p>
      </div>

      <div className="card">
        <div className="card-header">
          <form className="flex w-full max-w-xl flex-wrap items-center gap-2" role="search">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Buscar por referencia o nombre…"
              className="input max-w-56"
              aria-label="Buscar artículos"
            />
            <select name="familia" defaultValue={familia} className="input max-w-40" aria-label="Familia">
              <option value="">Todas las familias</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                name="inactivos"
                value="1"
                defaultChecked={showInactive}
                className="h-4 w-4 rounded border-slate-300"
              />
              Ver desactivados
            </label>
            <button type="submit" className="btn-secondary btn-sm">
              Filtrar
            </button>
            {(q || familia || showInactive) && (
              <Link href="/catalogo" className="btn-ghost btn-sm">
                Limpiar
              </Link>
            )}
          </form>
        </div>
      </div>

      <ItemsTable
        items={items}
        categories={categories}
        save={saveItemAction}
        toggle={toggleItemActiveAction}
      />
    </div>
  );
}
