"use client";

import { useActionState, useEffect, useState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import {
  VAT_RATES,
  centsToInput,
  formatCents,
  formatRate,
  marginBasisPoints,
} from "@/lib/money";
import { ITEM_KINDS } from "@/lib/validation";
import { prefill, prefillChecked, type FormState } from "@/lib/form";

export interface ItemRow {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  kind: string;
  unit: string;
  unitPrice: number;
  unitCost: number;
  vatRate: number;
  active: boolean;
}

const KIND_LABELS: Record<string, string> = {
  PRODUCT: "Producto",
  SERVICE: "Servicio",
};

/** Unidades habituales del taller. */
const UNITS = ["ud", "m2", "ml", "hora", "juego", "kg", "plancha"];

function ItemForm({
  item,
  save,
  onDone,
  categories,
}: {
  item: ItemRow | null;
  save: (state: FormState, formData: FormData) => Promise<FormState>;
  onDone: () => void;
  categories: string[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(save, {});
  const errors = state.errors ?? {};

  useEffect(() => {
    if (state.message) onDone();
  }, [state.message, onDone]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg bg-slate-50 p-3">
      {item && <input type="hidden" name="itemId" value={item.id} />}
      <ErrorBanner message={state.error} />

      <div className="grid gap-3 sm:grid-cols-6">
        <Field
          label="Referencia"
          htmlFor="item-sku"
          error={errors.sku}
          required
          className="sm:col-span-2"
        >
          <input
            id="item-sku"
            name="sku"
            className={`input font-mono uppercase ${errors.sku ? "input-error" : ""}`}
            defaultValue={prefill(state, "sku", item?.sku ?? "")}
            required
            maxLength={40}
            autoFocus
          />
        </Field>
        <Field
          label="Nombre"
          htmlFor="item-name"
          error={errors.name}
          required
          className="sm:col-span-4"
        >
          <input
            id="item-name"
            name="name"
            className={`input ${errors.name ? "input-error" : ""}`}
            defaultValue={prefill(state, "name", item?.name ?? "")}
            required
          />
        </Field>

        <Field
          label="Descripción"
          htmlFor="item-desc"
          className="sm:col-span-6"
        >
          <input
            id="item-desc"
            name="description"
            className="input"
            defaultValue={prefill(
              state,
              "description",
              item?.description ?? "",
            )}
            placeholder="Detalle que se arrastra a la línea del presupuesto"
          />
        </Field>

        <Field
          label="Familia"
          htmlFor="item-category"
          className="sm:col-span-2"
        >
          <input
            id="item-category"
            name="category"
            className="input"
            defaultValue={prefill(state, "category", item?.category ?? "")}
            list="item-categories"
            placeholder="Vinilo, serigrafía…"
          />
          <datalist id="item-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </Field>

        <Field label="Tipo" htmlFor="item-kind">
          <select
            id="item-kind"
            name="kind"
            className="input"
            defaultValue={prefill(state, "kind", item?.kind ?? "SERVICE")}
          >
            {ITEM_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Unidad" htmlFor="item-unit">
          <input
            id="item-unit"
            name="unit"
            className="input"
            defaultValue={prefill(state, "unit", item?.unit ?? "ud")}
            list="item-units"
            maxLength={16}
          />
          <datalist id="item-units">
            {UNITS.map((unit) => (
              <option key={unit} value={unit} />
            ))}
          </datalist>
        </Field>

        <Field label="Precio venta" htmlFor="item-price" hint="Sin IVA.">
          <input
            id="item-price"
            name="unitPrice"
            className="input-number"
            defaultValue={prefill(
              state,
              "unitPrice",
              item ? centsToInput(item.unitPrice) : "",
            )}
            inputMode="decimal"
            placeholder="0,00"
          />
        </Field>

        <Field label="Coste" htmlFor="item-cost" hint="Para ver el margen.">
          <input
            id="item-cost"
            name="unitCost"
            className="input-number"
            defaultValue={prefill(
              state,
              "unitCost",
              item ? centsToInput(item.unitCost) : "",
            )}
            inputMode="decimal"
            placeholder="0,00"
          />
        </Field>

        <Field label="IVA" htmlFor="item-vat">
          <select
            id="item-vat"
            name="vatRate"
            className="input"
            defaultValue={prefill(state, "vatRate", item?.vatRate ?? 2100)}
          >
            {VAT_RATES.map((rate) => (
              <option key={rate} value={rate}>
                {formatRate(rate)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="active"
          className="h-4 w-4 rounded border-slate-300"
          defaultChecked={prefillChecked(state, "active", item?.active ?? true)}
        />
        Disponible en el editor de presupuestos
      </label>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn-primary btn-sm">
          {item ? "Guardar artículo" : "Añadir artículo"}
        </SubmitButton>
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function ItemsTable({
  items,
  categories,
  save,
  toggle,
}: {
  items: ItemRow[];
  categories: string[];
  save: (state: FormState, formData: FormData) => Promise<FormState>;
  toggle: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="card">
      <div className="card-header">
        <h2 className="card-title">{items.length} artículos</h2>
        {editing !== "new" && (
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={() => setEditing("new")}
          >
            Nuevo artículo
          </button>
        )}
      </div>

      {editing === "new" && (
        <div className="card-body">
          <ItemForm
            item={null}
            save={save}
            onDone={() => setEditing(null)}
            categories={categories}
          />
        </div>
      )}

      {items.length === 0 ? (
        <p className="empty">
          El catálogo está vacío. Añade los trabajos que más repites para no
          teclearlos cada vez.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Artículo</th>
                <th>Familia</th>
                <th>Unidad</th>
                <th className="num">Precio</th>
                <th className="num">Coste</th>
                <th className="num">Margen</th>
                <th>IVA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                if (editing === item.id) {
                  return (
                    <tr key={item.id}>
                      <td colSpan={9}>
                        <ItemForm
                          item={item}
                          save={save}
                          onDone={() => setEditing(null)}
                          categories={categories}
                        />
                      </td>
                    </tr>
                  );
                }

                const margin = marginBasisPoints(item.unitPrice, item.unitCost);
                return (
                  <tr key={item.id} className={item.active ? "" : "opacity-60"}>
                    <td className="font-mono text-xs">{item.sku}</td>
                    <td>
                      <span className="font-medium text-slate-900">
                        {item.name}
                      </span>
                      {item.description && (
                        <span className="block text-xs text-slate-500">
                          {item.description}
                        </span>
                      )}
                      {!item.active && (
                        <span className="pill-slate mt-1">Desactivado</span>
                      )}
                    </td>
                    <td className="text-xs">{item.category ?? "—"}</td>
                    <td className="text-xs">{item.unit}</td>
                    <td className="num">{formatCents(item.unitPrice)}</td>
                    <td className="num text-slate-500">
                      {item.unitCost > 0 ? formatCents(item.unitCost) : "—"}
                    </td>
                    <td className="num text-xs">
                      {margin === null || item.unitCost === 0
                        ? "—"
                        : formatRate(margin)}
                    </td>
                    <td className="text-xs">{formatRate(item.vatRate)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => setEditing(item.id)}
                        >
                          Editar
                        </button>
                        <form action={toggle}>
                          <input type="hidden" name="itemId" value={item.id} />
                          <button type="submit" className="btn-ghost btn-sm">
                            {item.active ? "Desactivar" : "Activar"}
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
