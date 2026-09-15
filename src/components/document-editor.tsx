"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import {
  VAT_RATES,
  centsToInput,
  computeDocumentTotals,
  formatCents,
  formatRate,
  parseAmountToCents,
  parseQuantity,
  parseRateToBasisPoints,
} from "@/lib/money";
import { prefill, type FormState } from "@/lib/form";

/*
 * Editor de líneas compartido por presupuestos y pedidos.
 *
 * Los dos documentos tienen exactamente la misma estructura de líneas y de
 * totales; lo único que cambia son dos fechas y el texto de las condiciones.
 * Mantener un solo editor evita que el cálculo de un presupuesto y el de su
 * pedido acaben divergiendo, que es el error más caro que puede tener esto.
 *
 * Los importes se teclean en euros y se envían en céntimos. El servidor
 * recalcula todos los totales a partir de cantidad, precio, descuento e IVA:
 * nada de lo que calcula esta pantalla se guarda tal cual.
 */

export interface CustomerOption {
  id: string;
  code: string;
  legalName: string;
  defaultVatRate: number;
  withholdingRate: number;
  vatExempt: boolean;
}

export interface ItemOption {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  unit: string;
  unitPrice: number;
  vatRate: number;
  category: string | null;
}

export interface EditorLineValues {
  id?: string;
  itemId: string | null;
  sku: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  notes: string | null;
}

export interface DocumentEditorValues {
  customerId: string;
  title: string | null;
  customerRef: string | null;
  notes: string | null;
  internalNotes: string | null;
  globalDiscountRate: number;
  /** Fecha de emisión (presupuesto) o de pedido, en formato yyyy-mm-dd. */
  primaryDate: string;
  /** Validez (presupuesto) o entrega comprometida (pedido), en yyyy-mm-dd. */
  secondaryDate: string;
  /** Condiciones al pie; solo en presupuestos. */
  terms: string | null;
  lines: EditorLineValues[];
}

interface EditorLine extends EditorLineValues {
  /** Clave estable de React; solo existe en el navegador. */
  key: string;
  quantityInput: string;
  unitPriceInput: string;
  discountInput: string;
}

let keyCounter = 0;
function nextKey(): string {
  keyCounter += 1;
  return `l${keyCounter}`;
}

function toEditorLine(values: EditorLineValues): EditorLine {
  return {
    ...values,
    key: nextKey(),
    quantityInput: String(values.quantity).replace(".", ","),
    unitPriceInput: centsToInput(values.unitPrice),
    discountInput:
      values.discountRate === 0
        ? ""
        : formatRate(values.discountRate).replace("%", ""),
  };
}

function emptyLine(vatRate: number): EditorLine {
  return toEditorLine({
    itemId: null,
    sku: null,
    description: "",
    unit: "ud",
    quantity: 1,
    unitPrice: 0,
    discountRate: 0,
    vatRate,
    notes: null,
  });
}

/** Valores numéricos de una línea tal como se enviarán al servidor. */
function lineNumbers(line: EditorLine) {
  return {
    quantity: parseQuantity(line.quantityInput) ?? 0,
    unitPrice: parseAmountToCents(line.unitPriceInput) ?? 0,
    discountRate: parseRateToBasisPoints(line.discountInput) ?? 0,
    vatRate: line.vatRate,
  };
}

export function DocumentEditor({
  kind,
  action,
  values,
  customers,
  items,
  cancelHref,
  submitLabel,
  numberHint,
}: {
  kind: "QUOTE" | "ORDER";
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: DocumentEditorValues;
  customers: CustomerOption[];
  items: ItemOption[];
  cancelHref: string;
  submitLabel: string;
  /** Número que se asignará al emitir, solo informativo. */
  numberHint?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};

  const [customerId, setCustomerId] = useState(values.customerId);
  const [globalDiscount, setGlobalDiscount] = useState(
    values.globalDiscountRate === 0
      ? ""
      : formatRate(values.globalDiscountRate).replace("%", ""),
  );
  const [lines, setLines] = useState<EditorLine[]>(() =>
    values.lines.length > 0
      ? values.lines.map(toEditorLine)
      : [emptyLine(2100)],
  );

  const customer = customers.find((c) => c.id === customerId) ?? null;

  const totals = useMemo(
    () =>
      computeDocumentTotals({
        lines: lines.map(lineNumbers),
        globalDiscountRate: parseRateToBasisPoints(globalDiscount) ?? 0,
        withholdingRate: customer?.withholdingRate ?? 0,
      }),
    [lines, globalDiscount, customer],
  );

  const updateLine = (key: string, patch: Partial<EditorLine>) => {
    setLines((current) =>
      current.map((l) => (l.key === key ? { ...l, ...patch } : l)),
    );
  };

  const removeLine = (key: string) => {
    setLines((current) => {
      const next = current.filter((l) => l.key !== key);
      // Nunca se queda sin líneas: un documento vacío no se puede guardar y es
      // más cómodo tener siempre una fila lista para escribir.
      return next.length > 0
        ? next
        : [emptyLine(customer?.defaultVatRate ?? 2100)];
    });
  };

  /** Rellena una línea a partir de un artículo del catálogo. */
  const applyItem = (key: string, itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) {
      updateLine(key, { itemId: null });
      return;
    }
    updateLine(key, {
      itemId: item.id,
      sku: item.sku,
      description: item.description
        ? `${item.name} — ${item.description}`
        : item.name,
      unit: item.unit,
      unitPriceInput: centsToInput(item.unitPrice),
      vatRate: customer?.vatExempt ? 0 : item.vatRate,
    });
  };

  // Las líneas viajan como JSON en un campo oculto: es la forma más simple de
  // enviar una tabla de longitud variable con un formulario normal.
  const linesPayload = JSON.stringify(
    lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      sku: line.sku ?? "",
      description: line.description,
      unit: line.unit || "ud",
      notes: line.notes ?? "",
      ...lineNumbers(line),
    })),
  );

  const isQuote = kind === "QUOTE";

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="lines" value={linesPayload} />

      <ErrorBanner message={state.error ?? errors.lines} />

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Datos del documento</h2>
          {numberHint && (
            <p className="text-xs text-slate-500">
              Al emitirlo se numerará como{" "}
              <span className="font-mono">{numberHint}</span>
            </p>
          )}
        </div>
        <div className="card-body grid gap-4 sm:grid-cols-2">
          <Field
            label="Cliente"
            htmlFor="customerId"
            error={errors.customerId}
            required
          >
            <select
              id="customerId"
              name="customerId"
              className={`input ${errors.customerId ? "input-error" : ""}`}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              required
            >
              <option value="">— Selecciona un cliente —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName} ({c.code})
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Trabajo"
            htmlFor="title"
            hint="Lo que se ve de un vistazo en los listados."
          >
            <input
              id="title"
              name="title"
              className="input"
              defaultValue={prefill(state, "title", values.title ?? "")}
              placeholder="Rotulación furgoneta · vinilo impreso"
              maxLength={200}
            />
          </Field>

          <Field
            label={isQuote ? "Fecha de emisión" : "Fecha del pedido"}
            htmlFor="primaryDate"
            error={errors.issueDate ?? errors.orderDate}
            required
          >
            <input
              id="primaryDate"
              name="primaryDate"
              type="date"
              className="input"
              defaultValue={prefill(state, "primaryDate", values.primaryDate)}
              required
            />
          </Field>

          <Field
            label={isQuote ? "Válido hasta" : "Entrega comprometida"}
            htmlFor="secondaryDate"
            hint={
              isQuote
                ? "Se rellena con la validez por defecto."
                : "Aparece en el taller."
            }
          >
            <input
              id="secondaryDate"
              name="secondaryDate"
              type="date"
              className="input"
              defaultValue={prefill(
                state,
                "secondaryDate",
                values.secondaryDate,
              )}
            />
          </Field>

          <Field label="Referencia del cliente" htmlFor="customerRef">
            <input
              id="customerRef"
              name="customerRef"
              className="input"
              defaultValue={prefill(
                state,
                "customerRef",
                values.customerRef ?? "",
              )}
              placeholder="Su nº de pedido"
            />
          </Field>

          {customer?.vatExempt && (
            <p className="self-end rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200 ring-inset">
              Este cliente está marcado como exento de IVA. Pon el tipo al 0% en
              las líneas que correspondan.
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Líneas</h2>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() =>
              setLines((current) => [
                ...current,
                emptyLine(customer?.defaultVatRate ?? 2100),
              ])
            }
          >
            Añadir línea
          </button>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="w-[38%]">Concepto</th>
                <th className="w-24">Unidad</th>
                <th className="w-24 text-right">Cantidad</th>
                <th className="w-28 text-right">Precio</th>
                <th className="w-20 text-right">Dto.</th>
                <th className="w-28">IVA</th>
                <th className="w-28 text-right">Importe</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const numbers = lineNumbers(line);
                const gross = Math.round(numbers.quantity * numbers.unitPrice);
                const net =
                  gross - Math.round((gross * numbers.discountRate) / 10_000);

                return (
                  <tr key={line.key}>
                    <td>
                      <textarea
                        rows={2}
                        className="input"
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, { description: e.target.value })
                        }
                        placeholder="Descripción del trabajo o material"
                        aria-label={`Concepto de la línea ${index + 1}`}
                      />
                      {items.length > 0 && (
                        <select
                          className="input mt-1 text-xs"
                          value={line.itemId ?? ""}
                          onChange={(e) => applyItem(line.key, e.target.value)}
                          aria-label={`Traer del catálogo en la línea ${index + 1}`}
                        >
                          <option value="">Traer del catálogo…</option>
                          {items.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.sku} · {item.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        className="input"
                        value={line.unit}
                        onChange={(e) =>
                          updateLine(line.key, { unit: e.target.value })
                        }
                        aria-label={`Unidad de la línea ${index + 1}`}
                        maxLength={16}
                      />
                    </td>
                    <td>
                      <input
                        className="input-number"
                        value={line.quantityInput}
                        onChange={(e) =>
                          updateLine(line.key, {
                            quantityInput: e.target.value,
                          })
                        }
                        inputMode="decimal"
                        aria-label={`Cantidad de la línea ${index + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input-number"
                        value={line.unitPriceInput}
                        onChange={(e) =>
                          updateLine(line.key, {
                            unitPriceInput: e.target.value,
                          })
                        }
                        inputMode="decimal"
                        aria-label={`Precio de la línea ${index + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input-number"
                        value={line.discountInput}
                        onChange={(e) =>
                          updateLine(line.key, {
                            discountInput: e.target.value,
                          })
                        }
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`Descuento de la línea ${index + 1}`}
                      />
                    </td>
                    <td>
                      <select
                        className="input"
                        value={line.vatRate}
                        onChange={(e) =>
                          updateLine(line.key, {
                            vatRate: Number(e.target.value),
                          })
                        }
                        aria-label={`IVA de la línea ${index + 1}`}
                      >
                        {VAT_RATES.map((rate) => (
                          <option key={rate} value={rate}>
                            {formatRate(rate)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num pt-4 font-medium">{formatCents(net)}</td>
                    <td className="pt-3">
                      <button
                        type="button"
                        className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                        onClick={() => removeLine(line.key)}
                        aria-label={`Quitar la línea ${index + 1}`}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
          <Field
            label="Descuento global"
            htmlFor="globalDiscountRate"
            hint="Se reparte entre los tipos de IVA sin perder céntimos."
          >
            <input
              id="globalDiscountRate"
              name="globalDiscountRate"
              className="input-number sm:max-w-32"
              value={globalDiscount}
              onChange={(e) => setGlobalDiscount(e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
          </Field>

          <dl className="space-y-1.5 text-sm">
            {/* Sin descuento, la suma de líneas y la base imponible son la misma
                cifra; enseñar las dos solo añade ruido. */}
            {totals.discountTotal > 0 && (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Suma de líneas</dt>
                  <dd className="tabular-nums">
                    {formatCents(totals.linesSubtotal)}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-slate-600">Descuento global</dt>
                  <dd className="tabular-nums text-red-600">
                    −{formatCents(totals.discountTotal)}
                  </dd>
                </div>
              </>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Base imponible</dt>
              <dd className="tabular-nums">
                {formatCents(totals.taxableBase)}
              </dd>
            </div>
            {totals.vatBreakdown
              .filter((entry) => entry.base !== 0)
              .map((entry) => (
                <div key={entry.rate} className="flex justify-between gap-4">
                  <dt className="text-slate-600">
                    IVA {formatRate(entry.rate)} sobre {formatCents(entry.base)}
                  </dt>
                  <dd className="tabular-nums">{formatCents(entry.vat)}</dd>
                </div>
              ))}
            {totals.withholdingTotal > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">
                  Retención {formatRate(customer?.withholdingRate ?? 0)}
                </dt>
                <dd className="tabular-nums text-red-600">
                  −{formatCents(totals.withholdingTotal)}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-slate-200 pt-1.5 text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular-nums">{formatCents(totals.total)}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Textos</h2>
        </div>
        <div className="card-body grid gap-4">
          <Field
            label="Notas para el cliente"
            htmlFor="notes"
            hint="Se imprimen en el documento."
          >
            <textarea
              id="notes"
              name="notes"
              rows={3}
              className="input"
              defaultValue={prefill(state, "notes", values.notes ?? "")}
            />
          </Field>

          {isQuote && (
            <Field
              label="Condiciones"
              htmlFor="terms"
              hint="Plazos, forma de pago, validez…"
            >
              <textarea
                id="terms"
                name="terms"
                rows={3}
                className="input"
                defaultValue={prefill(state, "terms", values.terms ?? "")}
              />
            </Field>
          )}

          <Field
            label="Notas internas"
            htmlFor="internalNotes"
            hint="Solo para el taller: no se imprimen."
          >
            <textarea
              id="internalNotes"
              name="internalNotes"
              rows={3}
              className="input"
              defaultValue={prefill(
                state,
                "internalNotes",
                values.internalNotes ?? "",
              )}
            />
          </Field>
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
