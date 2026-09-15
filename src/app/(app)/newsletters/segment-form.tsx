"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import { centsToInput } from "@/lib/money";
import { SEGMENT_KIND_LABELS, SEGMENT_KINDS } from "@/lib/validation";
import type { SegmentRules } from "@/lib/segments";
import { prefill, prefillChecked, type FormState } from "@/lib/form";

export interface SegmentFormValues {
  name: string;
  description: string | null;
  kind: string;
  onlyWithConsent: boolean;
  includeAllContacts: boolean;
  active: boolean;
  rules: SegmentRules;
}

export function SegmentForm({
  action,
  values,
  cancelHref,
  submitLabel,
  /** Etiquetas y provincias que ya existen, para sugerirlas al escribir. */
  sugerencias,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: SegmentFormValues;
  cancelHref: string;
  submitLabel: string;
  sugerencias: { tags: string[]; provinces: string[] };
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};
  const [kind, setKind] = useState(values.kind);

  return (
    <form action={formAction} className="space-y-5">
      <ErrorBanner message={state.error} />

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">El grupo</h2>
        </div>
        <div className="card-body grid gap-4 sm:grid-cols-2">
          <Field label="Nombre" htmlFor="name" error={errors.name} required>
            <input
              id="name"
              name="name"
              className={`input ${errors.name ? "input-error" : ""}`}
              defaultValue={prefill(state, "name", values.name)}
              required
              maxLength={80}
              placeholder="Clientes de textil"
            />
          </Field>

          <Field
            label="Tipo"
            htmlFor="kind"
            hint={
              kind === "STATIC"
                ? "Eliges los clientes a mano y la lista no cambia sola."
                : "La lista se recalcula sola cada vez que se mira."
            }
          >
            <select
              id="kind"
              name="kind"
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {SEGMENT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {SEGMENT_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Descripción" htmlFor="description" className="sm:col-span-2">
            <input
              id="description"
              name="description"
              className="input"
              defaultValue={prefill(state, "description", values.description ?? "")}
              placeholder="Para qué se usa este grupo"
            />
          </Field>
        </div>
      </section>

      {kind === "DYNAMIC" && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Reglas</h2>
            <p className="text-xs text-slate-500">
              Un cliente entra si cumple todas las que rellenes.
            </p>
          </div>
          <div className="card-body space-y-4">
            <fieldset>
              <legend className="label">Tipo de cliente</legend>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="kindCompany"
                    className="h-4 w-4 rounded border-slate-300"
                    defaultChecked={prefillChecked(
                      state,
                      "kindCompany",
                      values.rules.kinds.includes("COMPANY"),
                    )}
                  />
                  Empresas
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    name="kindIndividual"
                    className="h-4 w-4 rounded border-slate-300"
                    defaultChecked={prefillChecked(
                      state,
                      "kindIndividual",
                      values.rules.kinds.includes("INDIVIDUAL"),
                    )}
                  />
                  Particulares
                </label>
              </div>
              <p className="hint">Sin marcar ninguna, entran los dos.</p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Con alguna de estas etiquetas"
                htmlFor="tagsAny"
                hint={
                  sugerencias.tags.length > 0
                    ? `En uso: ${sugerencias.tags.slice(0, 8).join(", ")}`
                    : "Separadas por comas."
                }
              >
                <input
                  id="tagsAny"
                  name="tagsAny"
                  className="input"
                  defaultValue={prefill(state, "tagsAny", values.rules.tagsAny.join(", "))}
                  list="sugerencias-tags"
                  placeholder="textil, serigrafia"
                />
                <datalist id="sugerencias-tags">
                  {sugerencias.tags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </Field>

              <Field
                label="De alguna de estas provincias"
                htmlFor="provinces"
                hint="Mira la dirección del cliente. Separadas por comas."
              >
                <input
                  id="provinces"
                  name="provinces"
                  className="input"
                  defaultValue={prefill(state, "provinces", values.rules.provinces.join(", "))}
                  list="sugerencias-provincias"
                  placeholder="Valladolid, Burgos"
                />
                <datalist id="sugerencias-provincias">
                  {sugerencias.provinces.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </Field>

              <Field
                label="Con pedidos en los últimos (meses)"
                htmlFor="orderedSinceMonths"
                hint="Vacío o 0 = da igual cuándo pidieron."
              >
                <input
                  id="orderedSinceMonths"
                  name="orderedSinceMonths"
                  type="number"
                  min={0}
                  max={120}
                  className="input-number"
                  defaultValue={prefill(
                    state,
                    "orderedSinceMonths",
                    values.rules.orderedSinceMonths ?? "",
                  )}
                  placeholder="12"
                />
              </Field>

              <Field
                label="Que hayan gastado al menos"
                htmlFor="minSpent"
                hint="Suma de sus pedidos, sin contar los anulados."
              >
                <input
                  id="minSpent"
                  name="minSpent"
                  className="input-number"
                  defaultValue={prefill(
                    state,
                    "minSpent",
                    values.rules.minSpentCents === null
                      ? ""
                      : centsToInput(values.rules.minSpentCents),
                  )}
                  inputMode="decimal"
                  placeholder="1000,00"
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                name="onlyActive"
                className="h-4 w-4 rounded border-slate-300"
                defaultChecked={prefillChecked(state, "onlyActive", values.rules.onlyActive)}
              />
              Dejar fuera a los clientes archivados
            </label>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Destinatarios y consentimiento</h2>
        </div>
        <div className="card-body space-y-4">
          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="onlyWithConsent"
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
              defaultChecked={prefillChecked(
                state,
                "onlyWithConsent",
                values.onlyWithConsent,
              )}
            />
            <span>
              Solo quien haya dado su consentimiento expreso
              <span className="block text-xs text-slate-500">
                Déjalo marcado para una newsletter comercial. Desmárcalo solo si el envío se
                ampara en la relación con el cliente, que la ley permite para productos
                similares a los que ya te compró.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="includeAllContacts"
              className="mt-0.5 h-4 w-4 rounded border-slate-300"
              defaultChecked={prefillChecked(
                state,
                "includeAllContacts",
                values.includeAllContacts,
              )}
            />
            <span>
              Escribir a todos los contactos del cliente
              <span className="block text-xs text-slate-500">
                Si lo dejas sin marcar se usa solo el contacto principal, y el correo de la
                ficha del cliente cuando no haya ninguno.
              </span>
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              name="active"
              className="h-4 w-4 rounded border-slate-300"
              defaultChecked={prefillChecked(state, "active", values.active)}
            />
            Grupo activo
          </label>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn-secondary">
          Cancelar
        </Link>
      </div>
    </form>
  );
}
