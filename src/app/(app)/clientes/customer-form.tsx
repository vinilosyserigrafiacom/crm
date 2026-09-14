"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import { taxIdWarning } from "@/lib/tax-id";
import { VAT_RATES, VAT_RATE_LABELS, formatRate } from "@/lib/money";
import { CUSTOMER_KIND_LABELS, CUSTOMER_KINDS, TAX_ID_TYPES } from "@/lib/validation";
import type { FormState } from "@/lib/form";

/** Valores iniciales del formulario; en el alta se usan los de por defecto. */
export interface CustomerFormValues {
  kind: string;
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  taxIdType: string;
  countryCode: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  paymentTermsDays: number;
  defaultVatRate: number;
  vatExempt: boolean;
  vatExemptReason: string | null;
  withholdingRate: number;
  notes: string | null;
  tags: string | null;
  active: boolean;
}

export const EMPTY_CUSTOMER: CustomerFormValues = {
  kind: "COMPANY",
  legalName: "",
  tradeName: null,
  taxId: null,
  taxIdType: "NIF",
  countryCode: "ES",
  email: null,
  phone: null,
  website: null,
  paymentTermsDays: 0,
  defaultVatRate: 2100,
  vatExempt: false,
  vatExemptReason: null,
  withholdingRate: 0,
  notes: null,
  tags: null,
  active: true,
};

const TAX_ID_TYPE_LABELS: Record<string, string> = {
  NIF: "NIF / CIF (España)",
  VAT_EU: "VAT intracomunitario",
  PASSPORT: "Pasaporte",
  OTHER: "Otro",
};

export function CustomerForm({
  action,
  values,
  cancelHref,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: CustomerFormValues;
  cancelHref: string;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};

  // El tipo de cliente y el país cambian qué campos tienen sentido, así que se
  // controlan en el cliente para ir adaptando el formulario mientras se rellena.
  const [kind, setKind] = useState(values.kind);
  const [countryCode, setCountryCode] = useState(values.countryCode);
  const [taxId, setTaxId] = useState(values.taxId ?? "");
  const [vatExempt, setVatExempt] = useState(values.vatExempt);

  const warning = taxIdWarning(taxId, countryCode);

  return (
    <form action={formAction} className="space-y-5">
      <ErrorBanner message={state.error} />

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Identificación</h2>
        </div>
        <div className="card-body grid gap-4 sm:grid-cols-2">
          <Field label="Tipo de cliente" htmlFor="kind">
            <select
              id="kind"
              name="kind"
              className="input"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {CUSTOMER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {CUSTOMER_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={kind === "COMPANY" ? "Razón social" : "Nombre y apellidos"}
            htmlFor="legalName"
            error={errors.legalName}
            required
            hint="El nombre que debe figurar en presupuestos y facturas."
            className="sm:col-span-1"
          >
            <input
              id="legalName"
              name="legalName"
              className={`input ${errors.legalName ? "input-error" : ""}`}
              defaultValue={values.legalName}
              required
              maxLength={200}
            />
          </Field>

          <Field
            label="Nombre comercial"
            htmlFor="tradeName"
            hint="Como se le conoce en el taller, si no coincide."
          >
            <input
              id="tradeName"
              name="tradeName"
              className="input"
              defaultValue={values.tradeName ?? ""}
            />
          </Field>

          <Field label="País" htmlFor="countryCode" error={errors.countryCode}>
            <select
              id="countryCode"
              name="countryCode"
              className="input"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value)}
            >
              <option value="ES">España</option>
              <option value="PT">Portugal</option>
              <option value="FR">Francia</option>
              <option value="IT">Italia</option>
              <option value="DE">Alemania</option>
              <option value="AD">Andorra</option>
              <option value="GB">Reino Unido</option>
              <option value="US">Estados Unidos</option>
            </select>
          </Field>

          <Field label="Tipo de identificador" htmlFor="taxIdType">
            <select
              id="taxIdType"
              name="taxIdType"
              className="input"
              defaultValue={values.taxIdType}
            >
              {TAX_ID_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TAX_ID_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="NIF / CIF / VAT"
            htmlFor="taxId"
            error={errors.taxId}
            hint={warning ?? "Se comprueba el dígito de control, pero no es obligatorio."}
          >
            <input
              id="taxId"
              name="taxId"
              className={`input uppercase ${warning ? "input-error" : ""}`}
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="B12345678"
              maxLength={20}
            />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Contacto</h2>
        </div>
        <div className="card-body grid gap-4 sm:grid-cols-3">
          <Field label="Correo electrónico" htmlFor="email" error={errors.email}>
            <input
              id="email"
              name="email"
              type="email"
              className={`input ${errors.email ? "input-error" : ""}`}
              defaultValue={values.email ?? ""}
            />
          </Field>
          <Field label="Teléfono" htmlFor="phone">
            <input id="phone" name="phone" className="input" defaultValue={values.phone ?? ""} />
          </Field>
          <Field label="Web" htmlFor="website">
            <input
              id="website"
              name="website"
              className="input"
              defaultValue={values.website ?? ""}
              placeholder="https://"
            />
          </Field>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Condiciones comerciales y fiscales</h2>
        </div>
        <div className="card-body space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              label="Vencimiento (días)"
              htmlFor="paymentTermsDays"
              error={errors.paymentTermsDays}
              hint="0 = al contado."
            >
              <input
                id="paymentTermsDays"
                name="paymentTermsDays"
                type="number"
                min={0}
                max={365}
                className={`input-number ${errors.paymentTermsDays ? "input-error" : ""}`}
                defaultValue={values.paymentTermsDays}
              />
            </Field>

            <Field label="IVA habitual" htmlFor="defaultVatRate">
              <select
                id="defaultVatRate"
                name="defaultVatRate"
                className="input"
                defaultValue={values.defaultVatRate}
              >
                {VAT_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {VAT_RATE_LABELS[rate]}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="Retención IRPF"
              htmlFor="withholdingRate"
              hint="Déjalo en 0 si no aplica."
            >
              <input
                id="withholdingRate"
                name="withholdingRate"
                className="input-number"
                defaultValue={
                  values.withholdingRate === 0 ? "0" : formatRate(values.withholdingRate).replace("%", "")
                }
                placeholder="0"
              />
            </Field>
          </div>

          <div className="space-y-3 rounded-lg bg-slate-50 p-3">
            <label className="flex items-start gap-2.5 text-sm text-slate-700">
              <input
                type="checkbox"
                name="vatExempt"
                className="mt-0.5 h-4 w-4 rounded border-slate-300"
                checked={vatExempt}
                onChange={(e) => setVatExempt(e.target.checked)}
              />
              <span>
                Operaciones exentas de IVA
                <span className="block text-xs text-slate-500">
                  Exportación, entrega intracomunitaria, inversión del sujeto pasivo…
                </span>
              </span>
            </label>

            {vatExempt && (
              <Field
                label="Causa de la exención"
                htmlFor="vatExemptReason"
                hint="Hay que declararla en la factura y en el registro de Verifactu."
              >
                <input
                  id="vatExemptReason"
                  name="vatExemptReason"
                  className="input"
                  defaultValue={values.vatExemptReason ?? ""}
                  placeholder="Art. 25 Ley 37/1992 — entrega intracomunitaria"
                />
              </Field>
            )}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Notas internas</h2>
        </div>
        <div className="card-body grid gap-4">
          <Field
            label="Etiquetas"
            htmlFor="tags"
            hint="Separadas por comas: rotulación, textil, recurrente…"
          >
            <input id="tags" name="tags" className="input" defaultValue={values.tags ?? ""} />
          </Field>
          <Field label="Notas" htmlFor="notes" hint="No se imprimen en los documentos.">
            <textarea
              id="notes"
              name="notes"
              rows={4}
              className="input"
              defaultValue={values.notes ?? ""}
            />
          </Field>
          <label className="flex items-center gap-2.5 text-sm text-slate-700">
            <input
              type="checkbox"
              name="active"
              className="h-4 w-4 rounded border-slate-300"
              defaultChecked={values.active}
            />
            Cliente activo
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
