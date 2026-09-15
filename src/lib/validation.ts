import { z } from "zod";

/**
 * Valores permitidos de los campos "enum" y esquemas de validación de
 * formularios. Es la única fuente de verdad: SQLite no soporta enums de
 * Prisma, así que la base de datos guarda texto y la garantía la da Zod.
 */

export const USER_ROLES = ["OWNER", "ADMIN", "STAFF"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CUSTOMER_KINDS = ["COMPANY", "INDIVIDUAL"] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export const TAX_ID_TYPES = ["NIF", "VAT_EU", "PASSPORT", "OTHER"] as const;

export const ADDRESS_KINDS = ["BILLING", "SHIPPING", "WORKSHOP"] as const;
export type AddressKind = (typeof ADDRESS_KINDS)[number];

export const ITEM_KINDS = ["PRODUCT", "SERVICE"] as const;

export const QUOTE_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const ORDER_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DOC_TYPES = ["QUOTE", "ORDER", "INVOICE"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const SEGMENT_KINDS = ["STATIC", "DYNAMIC"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const SEGMENT_KIND_LABELS: Record<SegmentKind, string> = {
  STATIC: "Lista fija",
  DYNAMIC: "Por reglas",
};

/**
 * Columnas del tablero de taller.
 *
 * Los anulados no tienen columna: son un callejón sin salida y ocuparían sitio
 * en una pantalla que se mira para saber qué hay que sacar hoy. Se consultan
 * desde el listado de pedidos.
 */
export const BOARD_COLUMNS: OrderStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "IN_PRODUCTION",
  "READY",
  "DELIVERED",
];

// ---------------------------------------------------------------------------
// Etiquetas en castellano
// ---------------------------------------------------------------------------

export const CUSTOMER_KIND_LABELS: Record<CustomerKind, string> = {
  COMPANY: "Empresa",
  INDIVIDUAL: "Particular",
};

export const ADDRESS_KIND_LABELS: Record<AddressKind, string> = {
  BILLING: "Facturación",
  SHIPPING: "Envío",
  WORKSHOP: "Instalación",
};

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  EXPIRED: "Caducado",
  CANCELLED: "Anulado",
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: "Borrador",
  CONFIRMED: "Confirmado",
  IN_PRODUCTION: "En producción",
  READY: "Listo",
  DELIVERED: "Entregado",
  CANCELLED: "Anulado",
};

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  OWNER: "Propietario",
  ADMIN: "Administración",
  STAFF: "Taller",
};

/**
 * Transiciones de estado permitidas. Tener esto en datos y no repartido por
 * la interfaz evita que un presupuesto acabe, por ejemplo, "aceptado" después
 * de haberse anulado.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ["SENT", "ACCEPTED", "CANCELLED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["CANCELLED"],
  REJECTED: ["SENT", "CANCELLED"],
  EXPIRED: ["SENT", "CANCELLED"],
  CANCELLED: [],
};

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "READY", "CANCELLED"],
  IN_PRODUCTION: ["READY", "CANCELLED"],
  READY: ["DELIVERED", "IN_PRODUCTION", "CANCELLED"],
  DELIVERED: [],
  CANCELLED: [],
};

// ---------------------------------------------------------------------------
// Utilidades de coerción desde formularios HTML
// ---------------------------------------------------------------------------

/** Texto opcional: "" del formulario se convierte en null en la base. */
const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable();

const requiredText = (campo: string, max = 200) =>
  z.string().trim().min(1, `${campo} es obligatorio`).max(max, `${campo} es demasiado largo`);

/** Entero no negativo leído de un input de texto. */
const intFromForm = (def = 0) =>
  z
    .union([z.string(), z.number()])
    .transform((v) => {
      if (typeof v === "number") return v;
      const cleaned = v.trim().replace(",", ".");
      if (cleaned === "") return def;
      return Number(cleaned);
    })
    .pipe(z.number().finite());

const checkbox = z
  .union([z.string(), z.boolean(), z.undefined()])
  .transform((v) => v === true || v === "on" || v === "true");

// ---------------------------------------------------------------------------
// Esquemas
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Introduce un correo válido"),
  password: z.string().min(1, "Introduce la contraseña"),
});

export const customerSchema = z.object({
  kind: z.enum(CUSTOMER_KINDS),
  legalName: requiredText("La razón social o el nombre"),
  tradeName: optionalText,
  taxId: optionalText,
  taxIdType: z.enum(TAX_ID_TYPES),
  countryCode: z.string().trim().toUpperCase().length(2).default("ES"),
  email: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || z.string().email().safeParse(v).success, {
      message: "El correo no tiene un formato válido",
    }),
  phone: optionalText,
  website: optionalText,
  paymentTermsDays: intFromForm(0).pipe(
    z.number().int().min(0, "Los días de pago no pueden ser negativos").max(365),
  ),
  defaultVatRate: intFromForm(2100).pipe(z.number().int().min(0).max(10_000)),
  vatExempt: checkbox,
  vatExemptReason: optionalText,
  withholdingRate: intFromForm(0).pipe(z.number().int().min(0).max(10_000)),
  notes: optionalText,
  tags: optionalText,
  active: checkbox,
  marketingOptOut: checkbox,
  marketingConsentSource: optionalText,
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const contactSchema = z.object({
  name: requiredText("El nombre del contacto"),
  jobTitle: optionalText,
  email: optionalText,
  phone: optionalText,
  notes: optionalText,
  isPrimary: checkbox,
  marketingOptOut: checkbox,
});

export const addressSchema = z.object({
  kind: z.enum(ADDRESS_KINDS),
  label: optionalText,
  line1: requiredText("La dirección"),
  line2: optionalText,
  postalCode: optionalText,
  city: optionalText,
  province: optionalText,
  countryCode: z.string().trim().toUpperCase().length(2).default("ES"),
  isDefault: checkbox,
});

export const itemSchema = z.object({
  sku: requiredText("La referencia", 40),
  name: requiredText("El nombre"),
  description: optionalText,
  category: optionalText,
  kind: z.enum(ITEM_KINDS),
  unit: requiredText("La unidad", 16),
  unitPrice: z.number().int().min(0),
  unitCost: z.number().int().min(0),
  vatRate: z.number().int().min(0).max(10_000),
  active: checkbox,
});

export const documentLineSchema = z.object({
  id: z.string().optional(),
  itemId: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  sku: optionalText,
  description: requiredText("La descripción de la línea", 500),
  unit: z.string().trim().max(16).default("ud"),
  quantity: z.number().min(0, "La cantidad no puede ser negativa"),
  unitPrice: z.number().int(),
  discountRate: z.number().int().min(0).max(10_000),
  vatRate: z.number().int().min(0).max(10_000),
  notes: optionalText,
});
export type DocumentLineInput = z.infer<typeof documentLineSchema>;

/** Cabecera común de presupuesto y pedido. */
const documentBase = {
  customerId: z.string().min(1, "Selecciona un cliente"),
  title: optionalText,
  customerRef: optionalText,
  notes: optionalText,
  internalNotes: optionalText,
  globalDiscountRate: z.number().int().min(0).max(10_000),
  lines: z.array(documentLineSchema).min(1, "Añade al menos una línea"),
};

export const quoteSchema = z.object({
  ...documentBase,
  issueDate: z.string().min(1, "Indica la fecha"),
  validUntil: z.string().optional().nullable(),
  terms: optionalText,
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export const orderSchema = z.object({
  ...documentBase,
  orderDate: z.string().min(1, "Indica la fecha"),
  dueDate: z.string().optional().nullable(),
});
export type OrderInput = z.infer<typeof orderSchema>;

export const segmentSchema = z.object({
  name: requiredText("El nombre del grupo", 80),
  description: optionalText,
  kind: z.enum(SEGMENT_KINDS),
  onlyWithConsent: checkbox,
  includeAllContacts: checkbox,
  active: checkbox,
});

export const companySettingsSchema = z.object({
  legalName: requiredText("La razón social"),
  tradeName: optionalText.transform((v) => v ?? ""),
  taxId: optionalText.transform((v) => v ?? ""),
  addressLine1: optionalText.transform((v) => v ?? ""),
  addressLine2: optionalText.transform((v) => v ?? ""),
  postalCode: optionalText.transform((v) => v ?? ""),
  city: optionalText.transform((v) => v ?? ""),
  province: optionalText.transform((v) => v ?? ""),
  countryCode: z.string().trim().toUpperCase().length(2).default("ES"),
  phone: optionalText.transform((v) => v ?? ""),
  email: optionalText.transform((v) => v ?? ""),
  website: optionalText.transform((v) => v ?? ""),
  iban: optionalText.transform((v) => v ?? ""),
  defaultVatRate: z.number().int().min(0).max(10_000),
  quoteValidDays: z.number().int().min(1).max(365),
  quoteTerms: optionalText.transform((v) => v ?? ""),
});

/** Aplana los errores de Zod a un mapa campo -> primer mensaje. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in result)) result[key] = issue.message;
  }
  return result;
}
