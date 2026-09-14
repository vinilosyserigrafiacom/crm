import type { SheetDocument, SheetLine, SheetParty } from "@/components/document-sheet";

/** Pasa los ajustes del emisor al formato que espera la hoja del documento. */
export function companyToSheetParty(company: {
  legalName: string;
  taxId: string;
  addressLine1: string;
  addressLine2: string;
  postalCode: string;
  city: string;
  province: string;
  phone: string;
  email: string;
  website: string;
  iban: string;
}): SheetParty {
  return {
    legalName: company.legalName,
    taxId: company.taxId || null,
    address:
      [
        company.addressLine1,
        company.addressLine2,
        [company.postalCode, company.city].filter(Boolean).join(" "),
        company.province,
      ]
        .filter((part) => part && part.trim() !== "")
        .join(", ") || null,
    phone: company.phone || null,
    email: company.email || null,
    website: company.website || null,
    iban: company.iban || null,
  };
}

/** Campos comunes de cabecera e importes de cualquier documento. */
interface DocumentCore {
  number: string | null;
  title: string | null;
  customerRef: string | null;
  notes: string | null;
  billingSnapshot: string | null;
  globalDiscountRate: number;
  linesSubtotal: number;
  discountTotal: number;
  taxableBase: number;
  vatTotal: number;
  withholdingTotal: number;
  total: number;
  vatBreakdown: string;
  lines: SheetLine[];
}

/**
 * Adapta un presupuesto a la hoja del documento.
 *
 * Presupuesto y pedido usan nombres distintos para sus dos fechas (emisión y
 * validez / fecha de pedido y entrega). La hoja habla de fecha principal y
 * secundaria para poder pintar los dos con el mismo componente.
 */
export function quoteToSheet(
  quote: DocumentCore & { issueDate: Date; validUntil: Date | null; terms: string | null },
): SheetDocument {
  return {
    ...quote,
    kind: "QUOTE",
    primaryDate: quote.issueDate,
    secondaryDate: quote.validUntil,
    terms: quote.terms,
  };
}

export function orderToSheet(
  order: DocumentCore & { orderDate: Date; dueDate: Date | null },
): SheetDocument {
  return {
    ...order,
    kind: "ORDER",
    primaryDate: order.orderDate,
    secondaryDate: order.dueDate,
    // Un pedido no lleva condiciones comerciales: eso se pactó en el
    // presupuesto y no se repite en la orden de trabajo.
    terms: null,
  };
}
