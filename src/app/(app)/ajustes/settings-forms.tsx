"use client";

import { useActionState, useState } from "react";
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

/**
 * Administración de una cuenta ya existente: perfil y contraseña.
 *
 * Va en su propio componente por fila porque cada una tiene su propio estado de
 * formulario: si un error de una fila se pintara en todas, nadie sabría a qué
 * cuenta se refiere.
 */
export function UserAdminControls({
  userId,
  email,
  role,
  active,
  isSelf,
  manageable,
  roleAction,
  passwordAction,
  toggleAction,
}: {
  userId: string;
  email: string;
  role: string;
  active: boolean;
  isSelf: boolean;
  /** False cuando quien mira no manda sobre esa cuenta (un admin sobre el jefe). */
  manageable: boolean;
  roleAction: (state: FormState, formData: FormData) => Promise<FormState>;
  passwordAction: (state: FormState, formData: FormData) => Promise<FormState>;
  toggleAction: (formData: FormData) => Promise<void>;
}) {
  const [roleState, roleFormAction] = useActionState<FormState, FormData>(roleAction, {});
  const [passState, passFormAction] = useActionState<FormState, FormData>(passwordAction, {});
  const [abierta, setAbierta] = useState(false);

  if (isSelf) {
    return <span className="text-xs text-slate-400">Tu cuenta</span>;
  }
  if (!manageable) {
    return <span className="text-xs text-slate-400">Cuenta de propietario</span>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={roleFormAction} className="flex items-center gap-1">
          <input type="hidden" name="userId" value={userId} />
          <label htmlFor={`role-${userId}`} className="sr-only">
            Perfil de {email}
          </label>
          <select id={`role-${userId}`} name="role" defaultValue={role} className="input input-sm">
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {USER_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <SubmitButton className="btn-secondary btn-sm" pendingLabel="…">
            Cambiar
          </SubmitButton>
        </form>

        <button
          type="button"
          onClick={() => setAbierta((v) => !v)}
          aria-expanded={abierta}
          className="btn-ghost btn-sm"
        >
          Contraseña
        </button>

        <form action={toggleAction}>
          <input type="hidden" name="userId" value={userId} />
          <button type="submit" className="btn-ghost btn-sm">
            {active ? "Desactivar" : "Activar"}
          </button>
        </form>
      </div>

      {abierta && (
        <form action={passFormAction} className="flex flex-wrap items-center justify-end gap-2">
          <input type="hidden" name="userId" value={userId} />
          <label htmlFor={`pass-${userId}`} className="sr-only">
            Contraseña nueva para {email}
          </label>
          <input
            id={`pass-${userId}`}
            name="password"
            type="text"
            autoComplete="off"
            placeholder="Contraseña nueva, mínimo 10"
            className={`input input-sm w-56 ${passState.errors?.password ? "input-error" : ""}`}
          />
          <SubmitButton className="btn-secondary btn-sm" pendingLabel="…">
            Restablecer
          </SubmitButton>
        </form>
      )}

      {(roleState.error || passState.error) && (
        <p role="alert" className="text-right text-xs text-red-700">
          {roleState.error ?? passState.error}
        </p>
      )}
      {(roleState.message || passState.message) && (
        <p role="status" className="text-right text-xs text-emerald-700">
          {roleState.message ?? passState.message}
        </p>
      )}
    </div>
  );
}
