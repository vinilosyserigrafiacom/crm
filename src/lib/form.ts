import { z } from "zod";
import { fieldErrors } from "@/lib/validation";

/** Estado que devuelven todas las acciones de formulario. */
export interface FormState {
  /** Mensaje general de error (fallo inesperado, conflicto...). */
  error?: string;
  /** Errores por campo, para pintarlos junto a cada input. */
  errors?: Record<string, string>;
  /** Mensaje de confirmación tras un guardado que no navega a otra página. */
  message?: string;
}

/** Lee un campo de texto del formulario. */
export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Lee una casilla de verificación. */
export function bool(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true";
}

/** Lee un entero; devuelve `fallback` si el campo está vacío o no es válido. */
export function int(formData: FormData, name: string, fallback = 0): number {
  const raw = text(formData, name).trim();
  if (raw === "") return fallback;
  const value = Number(raw.replace(",", "."));
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * Envuelve el parseo con Zod para que las acciones no repitan el mismo
 * `if (!parsed.success)` en cada una.
 */
export function parseForm<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; state: FormState } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    state: {
      error: "Revisa los campos marcados.",
      errors: fieldErrors(parsed.error),
    },
  };
}
