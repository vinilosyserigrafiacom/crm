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
  /**
   * Lo que el usuario había escrito, devuelto tal cual para repintarlo.
   *
   * React 19 resetea el formulario en cuanto termina una acción, así que cada
   * campo vuelve a su defaultValue. Sin esto, un error de validación borra todo
   * lo tecleado en un alta, y en una edición revierte a los valores guardados
   * sin avisar, que es peor: parece que el cambio se ha guardado.
   */
  values?: Record<string, string>;
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
 * Copia los campos del formulario para poder repintarlos tras un error.
 *
 * Las contraseñas se quedan fuera a propósito: devolverlas las metería en el
 * HTML de la respuesta, donde acaban en la caché del navegador y en cualquier
 * intermediario que registre el tráfico. Quien se equivoque de contraseña la
 * vuelve a escribir, que son dos segundos.
 */
export function snapshotValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value !== "string") continue;
    if (/password|contrase/i.test(key)) continue;
    values[key] = value;
  }
  return values;
}

/**
 * Envuelve el parseo con Zod para que las acciones no repitan el mismo
 * `if (!parsed.success)` en cada una.
 *
 * Pásale siempre el `formData` original: es lo que permite devolver al
 * formulario lo que el usuario había escrito.
 */
export function parseForm<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown,
  formData?: FormData,
): { ok: true; data: z.infer<T> } | { ok: false; state: FormState } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    state: {
      error: "Revisa los campos marcados.",
      errors: fieldErrors(parsed.error),
      values: formData ? snapshotValues(formData) : undefined,
    },
  };
}

/**
 * Valor con el que pintar un campo: lo que el usuario escribió si venimos de un
 * error, y si no el valor de partida.
 */
export function prefill(
  state: FormState,
  name: string,
  fallback?: string | number | null,
): string {
  const echoed = state.values?.[name];
  if (echoed !== undefined) return echoed;
  return fallback === null || fallback === undefined ? "" : String(fallback);
}

/**
 * Lo mismo para casillas de verificación. Una casilla sin marcar no viaja en el
 * formulario, así que si venimos de un error y no está en los valores es que el
 * usuario la había desmarcado.
 */
export function prefillChecked(
  state: FormState,
  name: string,
  fallback: boolean,
): boolean {
  if (!state.values) return fallback;
  const echoed = state.values[name];
  return echoed === "on" || echoed === "true";
}
