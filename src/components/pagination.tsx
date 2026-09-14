import Link from "next/link";

/**
 * Paginación por enlaces, sin JavaScript: funciona con el navegador de
 * cualquier móvil viejo del taller y se puede compartir la URL de una página
 * concreta.
 */
export function Pagination({
  page,
  pageSize,
  total,
  baseParams,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** Parámetros que hay que conservar al cambiar de página (búsqueda, filtros). */
  baseParams: Record<string, string | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const href = (target: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(baseParams)) {
      if (value) params.set(key, value);
    }
    if (target > 1) params.set("pagina", String(target));
    const query = params.toString();
    return query ? `?${query}` : "?";
  };

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <p>
        {first}–{last} de {total}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className="btn-secondary btn-sm" rel="prev">
            Anterior
          </Link>
        ) : (
          <span className="btn-secondary btn-sm pointer-events-none opacity-40">Anterior</span>
        )}
        <span className="tabular-nums">
          {page} / {totalPages}
        </span>
        {page < totalPages ? (
          <Link href={href(page + 1)} className="btn-secondary btn-sm" rel="next">
            Siguiente
          </Link>
        ) : (
          <span className="btn-secondary btn-sm pointer-events-none opacity-40">Siguiente</span>
        )}
      </div>
    </div>
  );
}

/** Lee el número de página de la URL, tolerando basura. */
export function readPage(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 1;
}
