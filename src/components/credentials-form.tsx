"use client";

import { useActionState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import { prefill, type FormState } from "@/lib/form";

/**
 * Credenciales de una integración, escritas desde la pantalla.
 *
 * Los campos secretos salen siempre vacíos: lo guardado no vuelve nunca al
 * navegador. Cuando ya hay algo guardado, dejarlos en blanco significa «no lo
 * cambies», de modo que se puede corregir la dirección sin ir a generar una
 * clave nueva.
 */

export interface CredentialField {
  name: string;
  label: string;
  placeholder?: string;
  hint?: string;
  /** No se devuelve al navegador y se puede dejar en blanco si ya hay valor. */
  secret?: boolean;
  value?: string;
  /** Final de la clave guardada, para saber cuál está puesta sin enseñarla. */
  masked?: string;
  /** Ocupa las dos columnas; para direcciones, que son largas. */
  wide?: boolean;
}

export function CredentialsForm({
  action,
  clearAction,
  fields,
  saved,
  savedLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clearAction?: () => Promise<void>;
  fields: CredentialField[];
  /** Hay credenciales escritas desde esta pantalla. */
  saved: boolean;
  /** «Guardadas el … por …», para saber de cuándo son. */
  savedLabel?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const errors = state.errors ?? {};

  return (
    <div className="space-y-3">
      <form
        action={formAction}
        className="space-y-3 rounded-lg bg-slate-50 p-3"
      >
        <ErrorBanner message={state.error} />
        {state.message && (
          <p
            role="status"
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
          >
            {state.message}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => {
            // Un secreto solo es obligatorio si no hay ninguno puesto todavía;
            // con uno guardado, dejarlo en blanco significa «no lo cambies», y
            // así se puede corregir la dirección sin tener que generar una
            // clave nueva en la tienda.
            const yaHay = field.masked !== undefined || saved;
            const obligatorio = !field.secret || !yaHay;

            return (
              <Field
                key={field.name}
                label={field.label}
                htmlFor={`cred-${field.name}`}
                error={errors[field.name]}
                hint={
                  field.secret && field.masked
                    ? `Puesta ahora mismo (${field.masked}). Déjalo en blanco para no cambiarla.`
                    : field.hint
                }
                required={obligatorio}
                className={field.wide ? "sm:col-span-2" : ""}
              >
                <input
                  id={`cred-${field.name}`}
                  name={field.name}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={field.placeholder}
                  className={`input font-mono text-xs ${errors[field.name] ? "input-error" : ""}`}
                  defaultValue={
                    field.secret
                      ? ""
                      : prefill(state, field.name, field.value ?? "")
                  }
                  required={obligatorio}
                />
              </Field>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className="btn-primary">
            Guardar credenciales
          </SubmitButton>
          <p className="text-xs text-slate-500">
            Se guardan cifradas con la clave de sesión del servidor: una copia
            de la base de datos no sirve sin el{" "}
            <code className="font-mono">.env</code>.
          </p>
        </div>
      </form>

      {saved && clearAction && (
        <form
          action={clearAction}
          className="flex flex-wrap items-center gap-2"
        >
          <button
            type="submit"
            className="btn-ghost btn-sm text-red-700 hover:bg-red-50"
          >
            Borrar las credenciales guardadas
          </button>
          {savedLabel && (
            <span className="text-xs text-slate-500">{savedLabel}</span>
          )}
        </form>
      )}
    </div>
  );
}
