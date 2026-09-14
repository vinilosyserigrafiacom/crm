/**
 * Validación de NIF, NIE y CIF españoles.
 *
 * Se valida pero no se bloquea: el taller factura también a clientes
 * extranjeros y a veces solo se tiene un identificador parcial. La validación
 * sirve para avisar de errores de tecleo, que es de donde vienen casi todas
 * las facturas rechazadas.
 */

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const NIE_PREFIX: Record<string, string> = { X: "0", Y: "1", Z: "2" };
const CIF_CONTROL_LETTERS = "JABCDEFGHI";

export type TaxIdKind = "NIF" | "NIE" | "CIF" | "UNKNOWN";

export interface TaxIdCheck {
  kind: TaxIdKind;
  valid: boolean;
  /** Identificador normalizado: sin espacios ni guiones, en mayúsculas. */
  normalized: string;
}

export function normalizeTaxId(raw: string): string {
  return raw.replace(/[\s.-]/g, "").toUpperCase();
}

function dniLetter(number: string): string {
  return DNI_LETTERS[Number(number) % 23];
}

/** Dígito de control de un CIF: suma con los impares duplicados. */
function cifControl(digits: string): { digit: string; letter: string } {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const n = Number(digits[i]);
    if (i % 2 === 0) {
      // Posiciones impares (1ª, 3ª...): se duplican y se suman sus cifras.
      const doubled = n * 2;
      sum += Math.floor(doubled / 10) + (doubled % 10);
    } else {
      sum += n;
    }
  }
  const control = (10 - (sum % 10)) % 10;
  return { digit: String(control), letter: CIF_CONTROL_LETTERS[control] };
}

export function checkTaxId(raw: string): TaxIdCheck {
  const normalized = normalizeTaxId(raw);

  // NIF de persona física: 8 dígitos + letra de control.
  const nif = /^(\d{8})([A-Z])$/.exec(normalized);
  if (nif) {
    return { kind: "NIF", valid: nif[2] === dniLetter(nif[1]), normalized };
  }

  // NIE: X, Y o Z + 7 dígitos + letra de control.
  const nie = /^([XYZ])(\d{7})([A-Z])$/.exec(normalized);
  if (nie) {
    const asNumber = NIE_PREFIX[nie[1]] + nie[2];
    return { kind: "NIE", valid: nie[3] === dniLetter(asNumber), normalized };
  }

  // CIF de entidad: letra de tipo + 7 dígitos + dígito o letra de control.
  const cif = /^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/.exec(normalized);
  if (cif) {
    const { digit, letter } = cifControl(cif[2]);
    // Algunos tipos solo admiten letra, otros solo dígito; aceptamos el que
    // corresponda sin discriminar por tipo, que es suficiente para detectar
    // errores de tecleo sin dar falsos negativos.
    return { kind: "CIF", valid: cif[3] === digit || cif[3] === letter, normalized };
  }

  return { kind: "UNKNOWN", valid: false, normalized };
}

/** Mensaje de aviso para mostrar en el formulario, o null si todo cuadra. */
export function taxIdWarning(raw: string, countryCode = "ES"): string | null {
  const value = raw.trim();
  if (value === "") return null;
  if (countryCode !== "ES") return null;

  const check = checkTaxId(value);
  if (check.kind === "UNKNOWN") {
    return "No parece un NIF, NIE ni CIF español. Revísalo o cambia el país del cliente.";
  }
  if (!check.valid) {
    return `El dígito de control del ${check.kind} no cuadra. Comprueba que esté bien escrito.`;
  }
  return null;
}
