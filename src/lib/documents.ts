import { z } from "zod";
import {
  computeDocumentTotals,
  computeLine,
  type DocumentTotals,
} from "@/lib/money";
import {
  documentLineSchema,
  fieldErrors,
  type DocumentLineInput,
} from "@/lib/validation";
import { fromDateInput } from "@/lib/format";
import { snapshotValues, text, type FormState } from "@/lib/form";
import { parseRateToBasisPoints } from "@/lib/money";

/**
 * Lógica compartida por presupuestos y pedidos: leer el formulario, validar las
 * líneas y calcular los importes.
 *
 * Los totales SIEMPRE se recalculan aquí a partir de cantidad, precio,
 * descuento e IVA. Lo que el navegador muestra mientras se rellena el
 * formulario es solo un avance; si se guardase lo que envía el cliente,
 * cualquiera podría alterar el importe de un documento con las herramientas de
 * desarrollo del navegador.
 */

const linesSchema = z
  .array(documentLineSchema)
  .min(1, "Añade al menos una línea con concepto.");

/** Una línea ya calculada, lista para guardar en la base de datos. */
export interface PreparedLine {
  position: number;
  itemId: string | null;
  sku: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  notes: string | null;
}

export interface PreparedDocument {
  customerId: string;
  title: string | null;
  customerRef: string | null;
  notes: string | null;
  internalNotes: string | null;
  terms: string | null;
  globalDiscountRate: number;
  primaryDate: Date;
  secondaryDate: Date | null;
  lines: PreparedLine[];
  totals: DocumentTotals;
}

/** Descarta las líneas vacías que quedan al añadir una fila y no rellenarla. */
function isBlank(line: DocumentLineInput): boolean {
  return (
    line.description.trim() === "" &&
    line.quantity === 0 &&
    line.unitPrice === 0
  );
}

export function prepareDocument(
  formData: FormData,
  options: { withholdingRate: number },
): { ok: true; data: PreparedDocument } | { ok: false; state: FormState } {
  const customerId = text(formData, "customerId").trim();
  if (customerId === "") {
    return {
      ok: false,
      state: {
        error: "Selecciona un cliente.",
        errors: { customerId: "Obligatorio" },
        values: snapshotValues(formData),
      },
    };
  }

  const primaryDate = fromDateInput(text(formData, "primaryDate"));
  if (!primaryDate) {
    return {
      ok: false,
      state: {
        error: "La fecha del documento no es válida.",
        values: snapshotValues(formData),
      },
    };
  }

  let rawLines: unknown;
  try {
    rawLines = JSON.parse(text(formData, "lines") || "[]");
  } catch {
    return {
      ok: false,
      state: {
        error: "No se han podido leer las líneas del documento.",
        values: snapshotValues(formData),
      },
    };
  }

  const parsed = linesSchema.safeParse(rawLines);
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    return {
      ok: false,
      state: {
        error:
          "Revisa las líneas: cada una necesita concepto, cantidad y precio.",
        errors: { lines: Object.values(errors)[0] ?? "Líneas no válidas" },
        values: snapshotValues(formData),
      },
    };
  }

  const usable = parsed.data.filter((line) => !isBlank(line));
  if (usable.length === 0) {
    return {
      ok: false,
      state: {
        error: "El documento necesita al menos una línea con concepto.",
        values: snapshotValues(formData),
      },
    };
  }

  const globalDiscountRate =
    parseRateToBasisPoints(text(formData, "globalDiscountRate")) ?? 0;

  const lines: PreparedLine[] = usable.map((line, index) => {
    const amounts = computeLine(line);
    return {
      position: index,
      itemId: line.itemId,
      sku: line.sku,
      description: line.description,
      unit: line.unit || "ud",
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountRate: line.discountRate,
      vatRate: line.vatRate,
      notes: line.notes,
      ...amounts,
    };
  });

  const totals = computeDocumentTotals({
    lines: usable,
    globalDiscountRate,
    withholdingRate: options.withholdingRate,
  });

  const emptyToNull = (value: string) =>
    value.trim() === "" ? null : value.trim();

  return {
    ok: true,
    data: {
      customerId,
      title: emptyToNull(text(formData, "title")),
      customerRef: emptyToNull(text(formData, "customerRef")),
      notes: emptyToNull(text(formData, "notes")),
      internalNotes: emptyToNull(text(formData, "internalNotes")),
      terms: emptyToNull(text(formData, "terms")),
      globalDiscountRate,
      primaryDate,
      secondaryDate: fromDateInput(text(formData, "secondaryDate")),
      lines,
      totals,
    },
  };
}

/** Campos de totales comunes a presupuesto y pedido. */
export function totalsData(document: PreparedDocument) {
  return {
    globalDiscountRate: document.globalDiscountRate,
    linesSubtotal: document.totals.linesSubtotal,
    discountTotal: document.totals.discountTotal,
    taxableBase: document.totals.taxableBase,
    vatTotal: document.totals.vatTotal,
    withholdingTotal: document.totals.withholdingTotal,
    total: document.totals.total,
    vatBreakdown: JSON.stringify(document.totals.vatBreakdown),
  };
}

export interface BillingSnapshotCompany {
  legalName: string;
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
}

export interface BillingSnapshotCustomer {
  code: string;
  legalName: string;
  taxId: string | null;
  taxIdType: string;
  countryCode: string;
  address: string | null;
}

/**
 * Copia congelada del emisor y del cliente en el momento de emitir.
 *
 * Sin esto, cambiar mañana la dirección de un cliente cambiaría lo que muestra
 * un documento emitido hace dos años. Verifactu exige que el registro de una
 * factura sea reproducible tal como se emitió, y un presupuesto aceptado tiene
 * el mismo problema en una reclamación.
 */
export function buildBillingSnapshot(
  company: BillingSnapshotCompany,
  customer: BillingSnapshotCustomer,
): string {
  return JSON.stringify({
    emitidoEn: new Date().toISOString(),
    company,
    customer,
  });
}

export interface BillingSnapshot {
  emitidoEn?: string;
  company?: Partial<BillingSnapshotCompany>;
  customer?: Partial<BillingSnapshotCustomer>;
}

export function parseBillingSnapshot(
  json: string | null | undefined,
): BillingSnapshot | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as BillingSnapshot)
      : null;
  } catch {
    return null;
  }
}

/** Dirección de facturación en una línea, para la cabecera del documento. */
export function formatAddressLine(
  address: {
    line1: string;
    line2: string | null;
    postalCode: string | null;
    city: string | null;
    province: string | null;
    countryCode: string;
  } | null,
): string | null {
  if (!address) return null;
  return [
    address.line1,
    address.line2,
    [address.postalCode, address.city].filter(Boolean).join(" "),
    address.province,
    address.countryCode === "ES" ? null : address.countryCode,
  ]
    .filter((part) => part && String(part).trim() !== "")
    .join(", ");
}
