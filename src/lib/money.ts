/**
 * Motor de cálculo de importes.
 *
 * Reglas del módulo, deliberadas:
 *
 *  1. Todo el dinero son enteros en céntimos. No entra ni sale un Float que
 *     represente dinero.
 *  2. Los porcentajes (IVA, descuentos, retención) son enteros en puntos base:
 *     21% -> 2100, 10% -> 1000, 0,5% -> 50.
 *  3. El IVA se calcula POR TIPO, sobre la base ya descontada de cada tipo, y
 *     se redondea una sola vez por grupo. Es como lo hace la AEAT y como lo
 *     espera Verifactu; sumar IVA línea a línea produce descuadres de
 *     céntimos en documentos largos.
 *  4. El descuento global se reparte entre los grupos de IVA de forma
 *     proporcional, y el céntimo que sobra del reparto se asigna al grupo con
 *     mayor resto. Así la suma de bases es siempre exactamente igual al
 *     subtotal menos el descuento: no se pierde ni se gana un céntimo.
 */

/** Tipos de IVA vigentes en España, en puntos base. */
export const VAT_RATES = [0, 400, 1000, 2100] as const;

export const VAT_RATE_LABELS: Record<number, string> = {
  0: "0% (exento)",
  400: "4% (superreducido)",
  1000: "10% (reducido)",
  2100: "21% (general)",
};

/** Redondeo a céntimo entero, simétrico respecto al cero. */
export function roundCents(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Aplica un porcentaje en puntos base a un importe en céntimos. */
export function applyRate(cents: number, rateBasisPoints: number): number {
  return roundCents((cents * rateBasisPoints) / 10_000);
}

export interface LineInput {
  quantity: number;
  /** Precio unitario sin IVA, en céntimos. */
  unitPrice: number;
  /** Descuento de línea en puntos base. */
  discountRate?: number;
  /** Tipo de IVA en puntos base. */
  vatRate?: number;
}

export interface LineAmounts {
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

/** Importes de una línea: bruto, descuento y neto (su base imponible). */
export function computeLine(line: LineInput): LineAmounts {
  const grossAmount = roundCents(line.quantity * line.unitPrice);
  const discountAmount = applyRate(grossAmount, line.discountRate ?? 0);
  return {
    grossAmount,
    discountAmount,
    netAmount: grossAmount - discountAmount,
  };
}

export interface VatBreakdownEntry {
  /** Tipo de IVA en puntos base. */
  rate: number;
  /** Base imponible de este tipo, en céntimos. */
  base: number;
  /** Cuota de IVA de este tipo, en céntimos. */
  vat: number;
}

export interface DocumentTotals {
  /** Suma de los netos de línea, antes del descuento global. */
  linesSubtotal: number;
  /** Importe del descuento global, en céntimos. */
  discountTotal: number;
  /** Base imponible total: linesSubtotal - discountTotal. */
  taxableBase: number;
  vatTotal: number;
  withholdingTotal: number;
  /** Importe a pagar: base + IVA - retención. */
  total: number;
  vatBreakdown: VatBreakdownEntry[];
}

export interface DocumentInput {
  lines: LineInput[];
  /** Descuento global en puntos base sobre la suma de líneas. */
  globalDiscountRate?: number;
  /** Retención de IRPF en puntos base sobre la base imponible. */
  withholdingRate?: number;
}

/**
 * Reparte `amount` entre `weights` de forma proporcional, devolviendo enteros
 * cuya suma es exactamente `amount` (método del resto mayor).
 */
function distribute(amount: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight === 0 || amount === 0) return weights.map(() => 0);

  const exact = weights.map((w) => (amount * w) / totalWeight);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = amount - floors.reduce((a, b) => a + b, 0);

  // Reparte el sobrante céntimo a céntimo, empezando por el resto más grande.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  const result = [...floors];
  let k = 0;
  while (remainder > 0 && order.length > 0) {
    result[order[k % order.length].i] += 1;
    remainder -= 1;
    k += 1;
  }
  return result;
}

/** Calcula todos los totales de un documento a partir de sus líneas. */
export function computeDocumentTotals(input: DocumentInput): DocumentTotals {
  const lineAmounts = input.lines.map((line) => ({
    vatRate: line.vatRate ?? 0,
    ...computeLine(line),
  }));

  const linesSubtotal = lineAmounts.reduce((sum, l) => sum + l.netAmount, 0);
  const discountTotal = applyRate(linesSubtotal, input.globalDiscountRate ?? 0);

  // Agrupa los netos por tipo de IVA, manteniendo el orden por tipo para que
  // el desglose impreso sea estable.
  const netByRate = new Map<number, number>();
  for (const line of lineAmounts) {
    netByRate.set(line.vatRate, (netByRate.get(line.vatRate) ?? 0) + line.netAmount);
  }
  const rates = [...netByRate.keys()].sort((a, b) => a - b);
  const nets = rates.map((r) => netByRate.get(r) ?? 0);

  // El descuento global se reparte proporcionalmente entre los grupos.
  const discounts = distribute(discountTotal, nets);

  const vatBreakdown: VatBreakdownEntry[] = rates.map((rate, i) => {
    const base = nets[i] - discounts[i];
    return { rate, base, vat: applyRate(base, rate) };
  });

  const taxableBase = vatBreakdown.reduce((sum, e) => sum + e.base, 0);
  const vatTotal = vatBreakdown.reduce((sum, e) => sum + e.vat, 0);
  const withholdingTotal = applyRate(taxableBase, input.withholdingRate ?? 0);

  return {
    linesSubtotal,
    discountTotal,
    taxableBase,
    vatTotal,
    withholdingTotal,
    total: taxableBase + vatTotal - withholdingTotal,
    vatBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Formato y lectura de importes
// ---------------------------------------------------------------------------

const eurFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 123456 -> "1.234,56 €" */
export function formatCents(cents: number): string {
  return eurFormatter.format(cents / 100);
}

/** 123456 -> "1234,56" (para rellenar un input). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Lee un importe escrito por una persona y lo convierte a céntimos.
 * Acepta "1.234,56", "1234.56", "1234,5", "1 234,56 €".
 * Devuelve null si el texto no es un número.
 */
export function parseAmountToCents(raw: string): number | null {
  const cleaned = raw.replace(/[€\s ]/g, "");
  if (cleaned === "") return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma === -1 && lastDot === -1) {
    normalized = cleaned;
  } else if (lastComma > lastDot) {
    // La coma es el separador decimal; los puntos son de millares.
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    // El punto es el separador decimal; las comas son de millares.
    normalized = cleaned.replace(/,/g, "");
  }

  if (!/^-?\d*(\.\d*)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return roundCents(value * 100);
}

/** 2100 -> "21%" ; 50 -> "0,5%" */
export function formatRate(basisPoints: number): string {
  const pct = basisPoints / 100;
  return `${pct.toString().replace(".", ",")}%`;
}

/** Lee un porcentaje escrito por una persona y lo pasa a puntos base. */
export function parseRateToBasisPoints(raw: string): number | null {
  const cleaned = raw.replace(/[%\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

/** Cantidades con hasta 3 decimales y sin ceros sobrantes: 2,5 / 12 / 0,75 */
export function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(quantity);
}

export function parseQuantity(raw: string): number | null {
  const cleaned = raw.replace(/[\s ]/g, "").replace(",", ".");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  // 3 decimales es la precisión del taller (metros cuadrados, metros lineales).
  return Math.round(value * 1000) / 1000;
}

/** Margen bruto de una línea sobre coste, en puntos base. Null si no hay coste. */
export function marginBasisPoints(netAmount: number, costAmount: number): number | null {
  if (netAmount === 0) return null;
  return Math.round(((netAmount - costAmount) / netAmount) * 10_000);
}

/** Parsea el desglose de IVA guardado como JSON en la base de datos. */
export function parseVatBreakdown(json: string | null | undefined): VatBreakdownEntry[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is VatBreakdownEntry =>
        typeof e?.rate === "number" && typeof e?.base === "number" && typeof e?.vat === "number",
    );
  } catch {
    return [];
  }
}
