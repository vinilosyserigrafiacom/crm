"use client";

import { useActionState } from "react";
import { signInAction, type LoginState } from "./actions";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(
    signInAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />

      <ErrorBanner message={state.error} />

      <Field label="Correo electrónico" htmlFor="email" required>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          className="input"
          placeholder="tu@vinilosyserigrafia.com"
          // React resetea el formulario al terminar la acción, así que tras una
          // contraseña fallida el correo volvería a quedar vacío. Se repinta con
          // lo que se escribió para no tener que teclearlo otra vez.
          defaultValue={state.email ?? ""}
        />
      </Field>

      <Field label="Contraseña" htmlFor="password" required>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </Field>

      <SubmitButton className="btn-primary w-full" pendingLabel="Entrando…">
        Entrar
      </SubmitButton>
    </form>
  );
}
