"use server";

import { redirect } from "next/navigation";
import { login } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

export interface LoginState {
  error?: string;
  /** Correo que se había escrito, para no obligar a teclearlo otra vez. */
  email?: string;
}

export async function signInAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const escrito = String(formData.get("email") ?? "");

  if (!parsed.success) {
    return {
      error:
        parsed.error.issues[0]?.message ?? "Revisa los datos introducidos.",
      email: escrito,
    };
  }

  const result = await login(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return { error: result.error, email: escrito };
  }

  // Solo se acepta un destino interno: un "next" con una URL absoluta
  // permitiría usar el login para redirigir a un sitio ajeno.
  const next = String(formData.get("next") ?? "");
  const destination =
    next.startsWith("/") && !next.startsWith("//") ? next : "/";

  redirect(destination);
}
