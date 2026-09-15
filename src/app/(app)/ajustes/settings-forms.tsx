"use client";

import { useActionState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import { VAT_RATES, VAT_RATE_LABELS } from "@/lib/money";
import { USER_ROLE_LABELS, USER_ROLES } from "@/lib/validation";
import { prefill, type FormState } from "@/lib/form";

function Confirmation({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
    >
      {message}
    </p>
  );
}

export interface CompanyValues {
  legalName: string;
  tradeName: string;
  taxId: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  province: string;
  countryCode: string;
  phone: string;
  email: string;
  website: string;
  iban: string;
  defaultVatRate: number;
  quoteValidDays: number;
  quoteTerms: string;
}

export function CompanyForm({
  action,
  values,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  values: CompanyValues;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="card">
      <div className="card-header">
        <h2 className="card-title">Datos del emisor</h2>
        <p className="text-xs text-slate-500">
          Es la cabecera de presupuestos y pedidos, y la base de las futuras
          facturas.
        </p>
      </div>

      <div className="card-body space-y-4">
        <ErrorBanner message={state.error} />
        <Confirmation message={state.message} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Razón social"
            htmlFor="legalName"
            error={errors.legalName}
            required
          >
            <input
              id="legalName"
              name="legalName"
              className={`input ${errors.legalName ? "input-error" : ""}`}
              defaultValue={prefill(state, "legalName", values.legalName)}
              required
            />
          </Field>
          <Field label="Nombre comercial" htmlFor="tradeName">
            <input
              id="tradeName"
              name="tradeName"
              className="input"
              defaultValue={prefill(state, "tradeName", values.tradeName)}
            />
          </Field>
          <Field label="NIF / CIF" htmlFor="taxId">
            <input
              id="taxId"
              name="taxId"
              className="input font-mono uppercase"
              defaultValue={prefill(state, "taxId", values.taxId)}
            />
          </Field>
          <Field
            label="IBAN"
            htmlFor="iban"
            hint="Se imprime al pie para pagos por transferencia."
          >
            <input
              id="iban"
              name="iban"
              className="input font-mono uppercase"
              defaultValue={prefill(state, "iban", values.iban)}
              placeholder="ES00 0000 0000 0000 0000 0000"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dirección" htmlFor="addressLine1">
            <input
              id="addressLine1"
              name="addressLine1"
              className="input"
              defaultValue={prefill(state, "addressLine1", values.addressLine1)}
            />
          </Field>
          <Field label="Complemento" htmlFor="addressLine2">
            <input
              id="addressLine2"
              name="addressLine2"
              className="input"
              defaultValue={prefill(state, "addressLine2", values.addressLine2)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="C.P." htmlFor="postalCode">
            <input
              id="postalCode"
              name="postalCode"
              className="input"
              defaultValue={prefill(state, "postalCode", values.postalCode)}
            />
          </Field>
          <Field label="Localidad" htmlFor="city">
            <input
              id="city"
              name="city"
              className="input"
              defaultValue={prefill(state, "city", values.city)}
            />
          </Field>
          <Field label="Provincia" htmlFor="province">
            <input
              id="province"
              name="province"
              className="input"
              defaultValue={prefill(state, "province", values.province)}
            />
          </Field>
          <Field label="País" htmlFor="countryCode" error={errors.countryCode}>
            <input
              id="countryCode"
              name="countryCode"
              className="input uppercase"
              defaultValue={prefill(state, "countryCode", values.countryCode)}
              maxLength={2}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Teléfono" htmlFor="phone">
            <input
              id="phone"
              name="phone"
              className="input"
              defaultValue={prefill(state, "phone", values.phone)}
            />
          </Field>
          <Field label="Correo" htmlFor="email">
            <input
              id="email"
              name="email"
              className="input"
              defaultValue={prefill(state, "email", values.email)}
            />
          </Field>
          <Field label="Web" htmlFor="website">
            <input
              id="website"
              name="website"
              className="input"
              defaultValue={prefill(state, "website", values.website)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="IVA por defecto" htmlFor="defaultVatRate">
            <select
              id="defaultVatRate"
              name="defaultVatRate"
              className="input"
              defaultValue={prefill(
                state,
                "defaultVatRate",
                values.defaultVatRate,
              )}
            >
              {VAT_RATES.map((rate) => (
                <option key={rate} value={rate}>
                  {VAT_RATE_LABELS[rate]}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Validez de los presupuestos (días)"
            htmlFor="quoteValidDays"
            error={errors.quoteValidDays}
          >
            <input
              id="quoteValidDays"
              name="quoteValidDays"
              type="number"
              min={1}
              max={365}
              className={`input-number ${errors.quoteValidDays ? "input-error" : ""}`}
              defaultValue={prefill(
                state,
                "quoteValidDays",
                values.quoteValidDays,
              )}
            />
          </Field>
        </div>

        <Field
          label="Condiciones por defecto"
          htmlFor="quoteTerms"
          hint="Se copian en cada presupuesto nuevo y se pueden cambiar allí."
        >
          <textarea
            id="quoteTerms"
            name="quoteTerms"
            rows={4}
            className="input"
            defaultValue={prefill(state, "quoteTerms", values.quoteTerms)}
            placeholder="Forma de pago, plazos de entrega, validez de precios…"
          />
        </Field>

        <SubmitButton>Guardar datos</SubmitButton>
      </div>
    </form>
  );
}

export function NewUserForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="space-y-3 rounded-lg bg-slate-50 p-3">
      <ErrorBanner message={state.error} />
      <Confirmation message={state.message} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="user-name" error={errors.name} required>
          <input
            id="user-name"
            name="name"
            className={`input ${errors.name ? "input-error" : ""}`}
            defaultValue={prefill(state, "name")}
            required
          />
        </Field>
        <Field
          label="Correo"
          htmlFor="user-email"
          error={errors.email}
          required
        >
          <input
            id="user-email"
            name="email"
            type="email"
            className={`input ${errors.email ? "input-error" : ""}`}
            defaultValue={prefill(state, "email")}
            required
          />
        </Field>
        <Field label="Perfil" htmlFor="user-role">
          <select
            id="user-role"
            name="role"
            className="input"
            defaultValue={prefill(state, "role", "STAFF")}
          >
            {USER_ROLES.map((role) => (
              <option key={role} value={role}>
                {USER_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Contraseña"
          htmlFor="user-password"
          error={errors.password}
          hint="Mínimo 10 caracteres."
          required
        >
          <input
            id="user-password"
            name="password"
            type="password"
            autoComplete="new-password"
            className={`input ${errors.password ? "input-error" : ""}`}
            required
          />
        </Field>
      </div>

      <SubmitButton className="btn-primary btn-sm">Crear usuario</SubmitButton>
    </form>
  );
}

export function PasswordForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="card-body space-y-3">
      <ErrorBanner message={state.error} />
      <Confirmation message={state.message} />

      <Field
        label="Nueva contraseña"
        htmlFor="own-password"
        error={errors.password}
        hint="Mínimo 10 caracteres."
        required
      >
        <input
          id="own-password"
          name="password"
          type="password"
          autoComplete="new-password"
          className={`input ${errors.password ? "input-error" : ""}`}
          required
        />
      </Field>
      <Field
        label="Repetir contraseña"
        htmlFor="own-password-2"
        error={errors.passwordRepeat}
        required
      >
        <input
          id="own-password-2"
          name="passwordRepeat"
          type="password"
          autoComplete="new-password"
          className={`input ${errors.passwordRepeat ? "input-error" : ""}`}
          required
        />
      </Field>

      <SubmitButton className="btn-secondary">Cambiar contraseña</SubmitButton>
    </form>
  );
}
