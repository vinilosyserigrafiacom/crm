import { computeDocumentTotals, roundCents, type DocumentTotals } from "@/lib/money";
import type { OrderStatus } from "@/lib/validation";
import type { WooAddress, WooCustomer, WooOrder } from "@/lib/woocommerce";

/**
 * Traducción de los datos de WooCommerce al modelo del CRM.
 *
 * Todo lo de este fichero son funciones puras: no tocan la base de datos ni la
 * red. Es donde están las decisiones que se pueden equivocar de verdad —un IVA
 * mal deducido, un estado mal mapeado— y por eso es la parte con pruebas.
 */

// ---------------------------------------------------------------------------
// Importes
// ---------------------------------------------------------------------------

/**
 * Importe de WooCommerce a céntimos.
 *
 * La tienda manda los importes como texto con punto decimal ("56.00"), nunca
 * con separador de millares. Se parsea de forma estricta en lugar de reutilizar
 * `parseAmountToCents`, que es tolerante porque lee lo que teclea una persona:
 * aquí, un formato inesperado es una señal de que algo ha cambiado en la tienda
 * y conviene que salte, no que se interprete a lo mejor mal.
 */
export function wooAmountToCents(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const texto = raw.trim();
  if (texto === "") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(texto)) return 0;
  return roundCents(Number(texto) * 100);
}

/** Tipos de IVA españoles, en puntos base, a los que se ajusta lo deducido. */
const TIPOS_CONOCIDOS = [0, 400, 1000, 2100];

/**
 * Deduce el tipo de IVA de una línea a partir de su base y su cuota.
 *
 * WooCommerce no manda el porcentaje en la línea, solo los importes. La
 * división da valores como 20,9999%, así que el resultado se ajusta al tipo
 * legal más cercano cuando queda a menos de medio punto: un documento español
 * con un IVA del 20,99% no existe y delataría un redondeo, no un tipo real.
 */
export function deduceVatRate(netCents: number, taxCents: number): number {
  if (netCents === 0) return taxCents === 0 ? 0 : 2100;

  const bruto = Math.round((taxCents / netCents) * 10_000);
  const cercano = TIPOS_CONOCIDOS.find((tipo) => Math.abs(tipo - bruto) <= 50);
  if (cercano !== undefined) return cercano;

  // Un tipo que no es ninguno de los españoles se respeta tal cual: puede ser
  // una tienda que venda a otro país.
  return Math.max(0, Math.min(10_000, bruto));
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * Estado de la tienda a estado de taller.
 *
 * `pending` y `on-hold` son pedidos sin pagar: entran como borrador, que es la
 * columna de «esto aún no es trabajo». `processing` es el pedido pagado y por
 * hacer. `completed` en la tienda significa enviado, que aquí es entregado.
 */
const ESTADOS: Record<string, OrderStatus> = {
  pending: "DRAFT",
  "on-hold": "DRAFT",
  "checkout-draft": "DRAFT",
  processing: "CONFIRMED",
  completed: "DELIVERED",
  cancelled: "CANCELLED",
  refunded: "CANCELLED",
  failed: "CANCELLED",
  trash: "CANCELLED",
};

export function mapWooStatus(wooStatus: string): OrderStatus {
  return ESTADOS[wooStatus.trim().toLowerCase()] ?? "DRAFT";
}

export const WOO_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente de pago",
  "on-hold": "En espera",
  processing: "En proceso",
  completed: "Completado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  failed: "Fallido",
  "checkout-draft": "Borrador",
  trash: "Papelera",
};

// ---------------------------------------------------------------------------
// Provincias
// ---------------------------------------------------------------------------

/**
 * Códigos de provincia de WooCommerce a nombre.
 *
 * La tienda manda "VA" y no "Valladolid". Sin esta tabla, el filtro por
 * provincia de los grupos de newsletter no encontraría nada en los clientes
 * importados, que es justo para lo que se usa.
 */
const PROVINCIAS: Record<string, string> = {
  C: "A Coruña", VI: "Álava", AB: "Albacete", A: "Alicante", AL: "Almería",
  O: "Asturias", AV: "Ávila", BA: "Badajoz", PM: "Baleares", B: "Barcelona",
  BU: "Burgos", CC: "Cáceres", CA: "Cádiz", S: "Cantabria", CS: "Castellón",
  CE: "Ceuta", CR: "Ciudad Real", CO: "Córdoba", CU: "Cuenca", GI: "Girona",
  GR: "Granada", GU: "Guadalajara", SS: "Guipúzcoa", H: "Huelva", HU: "Huesca",
  J: "Jaén", LO: "La Rioja", GC: "Las Palmas", LE: "León", L: "Lleida",
  LU: "Lugo", M: "Madrid", MA: "Málaga", ML: "Melilla", MU: "Murcia",
  NA: "Navarra", OR: "Ourense", P: "Palencia", PO: "Pontevedra", SA: "Salamanca",
  TF: "Santa Cruz de Tenerife", SG: "Segovia", SE: "Sevilla", SO: "Soria",
  T: "Tarragona", TE: "Teruel", TO: "Toledo", V: "Valencia", VA: "Valladolid",
  BI: "Vizcaya", ZA: "Zamora", Z: "Zaragoza",
};

/** Nombre de la provincia; si el código no se reconoce, se deja tal cual. */
export function provinceName(state: string, country: string): string | null {
  const codigo = state.trim().toUpperCase();
  if (codigo === "") return null;
  if (country.trim().toUpperCase() !== "ES") return state.trim();
  return PROVINCIAS[codigo] ?? state.trim();
}

// ---------------------------------------------------------------------------
// Identificador fiscal
// ---------------------------------------------------------------------------

/**
 * Claves donde los plugins españoles suelen guardar el NIF.
 *
 * No hay un estándar: cada plugin de facturación usa la suya. Se prueban las
 * habituales y se coge la primera con contenido.
 */
const CLAVES_NIF = [
  "_billing_nif",
  "billing_nif",
  "_billing_cif",
  "billing_cif",
  "_billing_vat",
  "billing_vat",
  "_billing_vat_number",
  "billing_vat_number",
  "_billing_dni",
  "billing_dni",
  "vat_number",
  "nif",
];

export function extractTaxId(meta: { key: string; value: unknown }[]): string | null {
  for (const clave of CLAVES_NIF) {
    const encontrado = meta.find((m) => m.key.toLowerCase() === clave);
    if (encontrado && typeof encontrado.value === "string" && encontrado.value.trim() !== "") {
      return encontrado.value.trim().toUpperCase();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

export interface MappedAddress {
  kind: "BILLING" | "SHIPPING";
  line1: string;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string;
  isDefault: boolean;
}

export interface MappedCustomer {
  wooId: number;
  kind: "COMPANY" | "INDIVIDUAL";
  legalName: string;
  tradeName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  addresses: MappedAddress[];
  /** Nombre de la persona de contacto, si el cliente es una empresa. */
  contactName: string | null;
}

function nombrePersona(direccion: WooAddress): string {
  return `${direccion.first_name} ${direccion.last_name}`.trim();
}

function limpiar(valor: string): string | null {
  const texto = valor.trim();
  return texto === "" ? null : texto;
}

function mapAddress(
  direccion: WooAddress,
  kind: "BILLING" | "SHIPPING",
): MappedAddress | null {
  if (direccion.address_1.trim() === "") return null;
  return {
    kind,
    line1: direccion.address_1.trim(),
    line2: limpiar(direccion.address_2),
    postalCode: limpiar(direccion.postcode),
    city: limpiar(direccion.city),
    province: provinceName(direccion.state, direccion.country),
    countryCode: (direccion.country.trim() || "ES").toUpperCase(),
    isDefault: true,
  };
}

/**
 * Cliente de la tienda a ficha del CRM.
 *
 * El nombre fiscal sale de la empresa si la hay, y si no del nombre y los
 * apellidos. Cuando hay empresa, la persona no se pierde: pasa a ser el
 * contacto principal de la ficha.
 */
export function mapCustomer(woo: WooCustomer): MappedCustomer {
  const facturacion = woo.billing;
  const empresa = limpiar(facturacion.company);
  // El nombre puede venir en la dirección de facturación o en la cuenta.
  const persona = nombrePersona(facturacion) || `${woo.first_name} ${woo.last_name}`.trim();

  const legalName = empresa ?? (persona || limpiar(woo.email) || `Cliente ${woo.id}`);

  const direcciones: MappedAddress[] = [];
  const facturacionMapeada = mapAddress(facturacion, "BILLING");
  if (facturacionMapeada) direcciones.push(facturacionMapeada);
  const envio = mapAddress(woo.shipping, "SHIPPING");
  // La dirección de envío solo se guarda si de verdad es distinta: en la mayoría
  // de tiendas es una copia de la de facturación y duplicarla solo ensucia.
  if (envio && envio.line1 !== facturacionMapeada?.line1) direcciones.push(envio);

  return {
    wooId: woo.id,
    kind: empresa ? "COMPANY" : "INDIVIDUAL",
    legalName,
    tradeName: null,
    taxId: extractTaxId(woo.meta_data),
    email: limpiar(woo.email) ?? limpiar(facturacion.email),
    phone: limpiar(facturacion.phone),
    addresses: direcciones,
    contactName: empresa ? persona || null : null,
  };
}

/**
 * Cliente deducido de un pedido de invitado.
 *
 * En WooCommerce se puede comprar sin cuenta: el pedido llega con
 * `customer_id: 0` y los datos solo en la dirección de facturación. Se crea una
 * ficha igualmente, porque para el taller es un cliente como cualquier otro.
 */
export function mapCustomerFromOrder(order: WooOrder): Omit<MappedCustomer, "wooId"> {
  const facturacion = order.billing;
  const empresa = limpiar(facturacion.company);
  const persona = nombrePersona(facturacion);

  const direcciones: MappedAddress[] = [];
  const facturacionMapeada = mapAddress(facturacion, "BILLING");
  if (facturacionMapeada) direcciones.push(facturacionMapeada);
  const envio = mapAddress(order.shipping, "SHIPPING");
  if (envio && envio.line1 !== facturacionMapeada?.line1) direcciones.push(envio);

  return {
    kind: empresa ? "COMPANY" : "INDIVIDUAL",
    legalName: empresa ?? (persona || limpiar(facturacion.email) || `Pedido ${order.number || order.id}`),
    tradeName: null,
    taxId: extractTaxId(order.meta_data),
    email: limpiar(facturacion.email),
    phone: limpiar(facturacion.phone),
    addresses: direcciones,
    contactName: empresa ? persona || null : null,
  };
}

// ---------------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------------

export interface MappedLine {
  position: number;
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

export interface MappedOrder {
  wooId: number;
  wooNumber: string;
  wooStatus: string;
  status: OrderStatus;
  orderDate: Date;
  title: string | null;
  customerRef: string;
  notes: string | null;
  currency: string;
  lines: MappedLine[];
  totals: DocumentTotals;
  /** Total que dice la tienda, para poder contrastarlo con el calculado. */
  wooTotalCents: number;
}

/**
 * Líneas del pedido.
 *
 * WooCommerce da por línea el `subtotal` (antes de descuentos) y el `total`
 * (después). El CRM guarda precio unitario y porcentaje de descuento, así que
 * se deduce: el precio sale del subtotal entre la cantidad, y el descuento de
 * la diferencia entre subtotal y total.
 */
export function mapLines(order: WooOrder): MappedLine[] {
  const lineas: MappedLine[] = [];

  for (const [indice, item] of order.line_items.entries()) {
    const cantidad = item.quantity && item.quantity > 0 ? item.quantity : 1;
    const subtotal = wooAmountToCents(item.subtotal);
    const total = wooAmountToCents(item.total);
    const impuesto = wooAmountToCents(item.total_tax);

    const unitPrice = roundCents(subtotal / cantidad);
    // El bruto se recalcula desde el precio unitario para que cuadre con el
    // resto del CRM, que siempre hace cantidad × precio.
    const grossAmount = roundCents(cantidad * unitPrice);
    const discountAmount = Math.max(0, subtotal - total);
    const discountRate =
      grossAmount > 0 ? Math.round((discountAmount / grossAmount) * 10_000) : 0;

    lineas.push({
      position: indice,
      sku: item.sku?.trim() || null,
      description: item.name?.trim() || "Artículo de la tienda",
      unit: "ud",
      quantity: cantidad,
      unitPrice,
      discountRate,
      vatRate: deduceVatRate(total, impuesto),
      grossAmount,
      discountAmount,
      netAmount: grossAmount - discountAmount,
      notes: null,
    });
  }

  // Los portes son una línea más: en el taller es un concepto que se cobra, y
  // dejarlo fuera haría que el total del pedido no cuadrase con la tienda.
  for (const envio of order.shipping_lines) {
    const total = wooAmountToCents(envio.total);
    if (total === 0) continue;
    const impuesto = wooAmountToCents(envio.total_tax);
    lineas.push({
      position: lineas.length,
      sku: null,
      description: envio.method_title?.trim() || "Envío",
      unit: "ud",
      quantity: 1,
      unitPrice: total,
      discountRate: 0,
      vatRate: deduceVatRate(total, impuesto),
      grossAmount: total,
      discountAmount: 0,
      netAmount: total,
      notes: null,
    });
  }

  return lineas;
}

/**
 * Pedido de la tienda al modelo del CRM.
 *
 * Los totales se recalculan con el motor del CRM a partir de las líneas, como
 * cualquier otro documento. El total que dice la tienda se conserva aparte para
 * poder contrastarlo: si no coinciden, la sincronización lo avisa en lugar de
 * elegir en silencio cuál de los dos es el bueno.
 */
export function mapOrder(order: WooOrder): MappedOrder {
  const lines = mapLines(order);

  const totals = computeDocumentTotals({
    lines: lines.map((l) => ({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      discountRate: l.discountRate,
      vatRate: l.vatRate,
    })),
  });

  const fecha = order.date_created_gmt ? new Date(`${order.date_created_gmt}Z`) : new Date();

  return {
    wooId: order.id,
    wooNumber: order.number?.trim() || String(order.id),
    wooStatus: order.status,
    status: mapWooStatus(order.status),
    orderDate: Number.isNaN(fecha.getTime()) ? new Date() : fecha,
    title: lines.length > 0 ? resumirLineas(lines) : null,
    customerRef: order.number?.trim() || String(order.id),
    notes: limpiar(order.customer_note),
    currency: order.currency?.trim() || "EUR",
    lines,
    totals,
    wooTotalCents: wooAmountToCents(order.total),
  };
}

/** Título corto del pedido: el primer artículo, y cuántos más hay. */
function resumirLineas(lines: MappedLine[]): string {
  const primera = lines[0].description;
  if (lines.length === 1) return primera;
  return `${primera} y ${lines.length - 1} concepto${lines.length - 1 === 1 ? "" : "s"} más`;
}
