"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ErrorBanner, SubmitButton } from "@/components/ui";
import type { FormState } from "@/lib/form";

export interface CustomerOption {
  id: string;
  code: string;
  legalName: string;
}

export interface MemberRow {
  id: string;
  code: string;
  legalName: string;
  email: string | null;
  contactCount: number;
}

/**
 * Miembros de un grupo de lista fija.
 *
 * El selector filtra en el navegador sobre la lista completa de clientes. Con
 * los volúmenes de un taller eso es instantáneo y evita montar un buscador
 * contra el servidor para algo que se usa de vez en cuando.
 */
export function MembersCard({
  members,
  candidates,
  add,
  remove,
}: {
  members: MemberRow[];
  candidates: CustomerOption[];
  add: (state: FormState, formData: FormData) => Promise<FormState>;
  remove: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(add, {});
  const [busqueda, setBusqueda] = useState("");
  const [seleccion, setSeleccion] = useState<string[]>([]);

  const yaEstan = new Set(members.map((m) => m.id));
  const disponibles = candidates
    .filter((c) => !yaEstan.has(c.id))
    .filter((c) =>
      busqueda.trim() === ""
        ? true
        : `${c.legalName} ${c.code}`.toLowerCase().includes(busqueda.trim().toLowerCase()),
    );

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Clientes del grupo ({members.length})</h2>
      </div>

      <div className="card-body space-y-3">
        <ErrorBanner message={state.error} />
        {state.message && (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {state.message}
          </p>
        )}

        <form action={formAction} className="space-y-2 rounded-lg bg-slate-50 p-3">
          <label className="label" htmlFor="buscar-cliente">
            Añadir clientes
          </label>
          <input
            id="buscar-cliente"
            type="search"
            className="input"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Filtrar por nombre o código…"
          />

          <select
            multiple
            name="customerIds"
            size={6}
            className="input"
            value={seleccion}
            onChange={(e) =>
              setSeleccion([...e.target.selectedOptions].map((o) => o.value))
            }
            aria-label="Clientes a añadir"
          >
            {disponibles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName} ({c.code})
              </option>
            ))}
          </select>
          <p className="hint">
            {disponibles.length === 0
              ? "No queda ningún cliente por añadir con ese filtro."
              : "Puedes elegir varios con Ctrl (o Cmd) pulsado."}
          </p>

          <SubmitButton className="btn-primary btn-sm">Añadir al grupo</SubmitButton>
        </form>

        {members.length === 0 ? (
          <p className="text-sm text-slate-500">
            El grupo está vacío. Añade clientes con el selector de arriba.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {members.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/clientes/${member.id}`}
                    className="text-sm font-medium text-ink-700 hover:underline"
                  >
                    {member.legalName}
                  </Link>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono">{member.code}</span>
                    {member.email && ` · ${member.email}`}
                    {member.contactCount > 0 &&
                      ` · ${member.contactCount} contacto${member.contactCount === 1 ? "" : "s"}`}
                  </p>
                </div>
                <form action={remove}>
                  <input type="hidden" name="customerId" value={member.id} />
                  <button type="submit" className="btn-ghost btn-sm text-red-600 hover:bg-red-50">
                    Quitar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
