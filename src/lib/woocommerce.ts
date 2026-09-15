import { z } from "zod";

/**
 * Cliente de la API REST de WooCommerce.
 *
 * Las credenciales salen del entorno y no de la base de datos, igual que
 * SESSION_SECRET: una clave de la tienda permite leer todo el fichero de
 * clientes, y guardarla en la base de datos la metería en cualquier copia de
 * seguridad que se mande por correo. El precio es que configurar la conexión
 * pide editar el .env; a cambio, la pantalla de Ajustes no puede filtrarla.
 *
 * Todo lo que devuelve la tienda se valida con Zod. Es dato externo: aunque sea
 * tu propia tienda, un plugin puede cambiar un campo de sitio en cualquier
 * actualización, y es mejor un error claro que un pedido importado a cero.
 */

export interface WooConfig {
  /** Raíz de la tienda, sin barra final: https://vinilosyserigrafia.com */
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}

export type WooConfigResult =
  | { ok: true; config: WooConfig }
  | { ok: false; missing: string[] };

/** Lee y valida la configuración del entorno. */
export function readWooConfig(env: NodeJS.ProcessEnv = process.env): WooConfigResult {
  const missing: string[] = [];
  const baseUrl = (env.WOO_URL ?? "").trim().replace(/\/+$/, "");
  const consumerKey = (env.WOO_CONSUMER_KEY ?? "").trim();
  const consumerSecret = (env.WOO_CONSUMER_SECRET ?? "").trim();

  if (baseUrl === "") missing.push("WOO_URL");
  if (consumerKey === "") missing.push("WOO_CONSUMER_KEY");
  if (consumerSecret === "") missing.push("WOO_CONSUMER_SECRET");
  if (missing.length > 0) return { ok: false, missing };

  return { ok: true, config: { baseUrl, consumerKey, consumerSecret } };
}

/** ¿Está configurada la integración? */
export function isWooConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readWooConfig(env).ok;
}

export class WooError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "WooError";
  }
}

/** Traduce los fallos típicos a algo que se pueda leer sin saber de HTTP. */
function describeStatus(status: number, body: string): string {
  if (status === 401) {
    return "La tienda ha rechazado las credenciales (401). Revisa WOO_CONSUMER_KEY y WOO_CONSUMER_SECRET, y que la clave tenga permiso de lectura.";
  }
  if (status === 403) {
    return "La tienda ha denegado el acceso (403). Suele ser que la clave no tiene permisos, o que un cortafuegos o plugin de seguridad está bloqueando la API.";
  }
  if (status === 404) {
    return "No se encuentra la API en esa dirección (404). Comprueba WOO_URL y que los enlaces permanentes de WordPress no estén en «Simple», porque entonces /wp-json no funciona.";
  }
  if (status >= 500) {
    return `La tienda ha respondido con un error interno (${status}). Vuelve a intentarlo en un rato.`;
  }
  return `La tienda ha respondido ${status}: ${body.slice(0, 200)}`;
}

export interface WooPage<T> {
  items: T[];
  /** Total de páginas que dice la tienda, de la cabecera X-WP-TotalPages. */
  totalPages: number;
  totalItems: number;
}

/** Tiempo máximo por petición. Una tienda lenta no debe colgar la pantalla. */
const TIMEOUT_MS = 30_000;

/**
 * Pide una página de un recurso.
 *
 * La autenticación va por cabecera Basic, que es lo que recomienda WooCommerce
 * sobre HTTPS. No se pasan las claves por la URL: acabarían en los registros
 * del servidor web y en el historial de cualquier proxy por el medio.
 */
export async function fetchWooPage<T>(
  config: WooConfig,
  resource: "customers" | "orders",
  params: Record<string, string | number>,
  schema: z.ZodType<T>,
): Promise<WooPage<T>> {
  const url = new URL(`${config.baseUrl}/wp-json/wc/v3/${resource}`);
  for (const [clave, valor] of Object.entries(params)) {
    url.searchParams.set(clave, String(valor));
  }

  const credenciales = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString(
    "base64",
  );

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Basic ${credenciales}`,
        Accept: "application/json",
        "User-Agent": "CRM Vinilos y Serigrafia",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new WooError(
        `La tienda no ha respondido en ${TIMEOUT_MS / 1000} segundos. Puede estar caída o muy lenta.`,
      );
    }
    // El mensaje de red se recorta: puede traer la URL entera, y la URL no
    // lleva credenciales pero sí el dominio, que no aporta nada al usuario.
    throw new WooError(
      `No se ha podido conectar con la tienda. Comprueba WOO_URL y que el servidor tenga salida a internet.`,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new WooError(describeStatus(response.status, body), response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new WooError(
      "La tienda ha devuelto algo que no es JSON. Suele pasar cuando un plugin escribe avisos de PHP en la respuesta.",
    );
  }

  const parsed = z.array(schema).safeParse(json);
  if (!parsed.success) {
    throw new WooError(
      `La respuesta de la tienda no tiene la forma esperada en ${resource}: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
    );
  }

  return {
    items: parsed.data,
    totalPages: Number(response.headers.get("X-WP-TotalPages") ?? "1") || 1,
    totalItems: Number(response.headers.get("X-WP-Total") ?? parsed.data.length) || 0,
  };
}

/**
 * Recorre todas las páginas de un recurso.
 *
 * El tope de páginas no es paranoia: si la tienda devuelve mal la cabecera de
 * total de páginas, sin él el bucle no terminaría nunca.
 */
export async function* fetchWooAll<T>(
  config: WooConfig,
  resource: "customers" | "orders",
  params: Record<string, string | number>,
  schema: z.ZodType<T>,
  maxPages = 200,
): AsyncGenerator<T[]> {
  let page = 1;
  let totalPages = 1;

  do {
    const resultado = await fetchWooPage(config, resource, { ...params, page }, schema);
    totalPages = resultado.totalPages;
    if (resultado.items.length > 0) yield resultado.items;
    page += 1;
  } while (page <= totalPages && page <= maxPages);
}

// ---------------------------------------------------------------------------
// Forma de los datos que devuelve la tienda
// ---------------------------------------------------------------------------

/*
 * Solo se declaran los campos que se usan, y casi todos opcionales:
 * WooCommerce añade y quita campos entre versiones y cada plugin mete los
 * suyos, así que exigir el objeto completo haría que la importación fallara
 * entera por un campo que ni miramos.
 */

/**
 * Texto que puede llegar ausente o como null.
 *
 * WooCommerce manda unas veces "" y otras null para el mismo campo vacío, según
 * la versión y el plugin. Se normaliza a cadena vacía para no tener que
 * comprobarlo en cada uso.
 */
const texto = z
  .string()
  .nullish()
  .transform((v) => v ?? "");

const direccionSchema = z
  .object({
    first_name: texto,
    last_name: texto,
    company: texto,
    address_1: texto,
    address_2: texto,
    city: texto,
    state: texto,
    postcode: texto,
    country: texto,
    email: texto,
    phone: texto,
  })
  // El valor por defecto va completo porque Zod lo devuelve tal cual, sin
  // volver a pasarlo por el esquema, así que un {} dejaría campos sin definir.
  .default(() => ({
    first_name: "",
    last_name: "",
    company: "",
    address_1: "",
    address_2: "",
    city: "",
    state: "",
    postcode: "",
    country: "",
    email: "",
    phone: "",
  }));

export type WooAddress = z.infer<typeof direccionSchema>;

const metaSchema = z
  .object({ key: z.string(), value: z.unknown() })
  .transform((m) => ({ key: m.key, value: m.value }));

export const wooCustomerSchema = z.object({
  id: z.number().int(),
  email: texto,
  first_name: texto,
  last_name: texto,
  date_created_gmt: z.string().nullish(),
  billing: direccionSchema,
  shipping: direccionSchema,
  meta_data: z.array(metaSchema).default([]),
});

export type WooCustomer = z.infer<typeof wooCustomerSchema>;

const lineaSchema = z.object({
  id: z.number().int().optional(),
  name: texto,
  sku: texto,
  quantity: z.number().default(1),
  /** Importe de la línea SIN impuestos y ya con descuentos, como texto. */
  total: texto,
  /** Impuestos de la línea, como texto. */
  total_tax: texto,
  /** Importe antes de descuentos. */
  subtotal: texto,
  subtotal_tax: texto,
});

export type WooLineItem = z.infer<typeof lineaSchema>;

const envioSchema = z.object({
  method_title: texto,
  total: texto,
  total_tax: texto,
});

export const wooOrderSchema = z.object({
  id: z.number().int(),
  number: texto,
  status: z.string().default("pending"),
  currency: z.string().default("EUR"),
  date_created_gmt: z.string().nullish(),
  date_modified_gmt: z.string().nullish(),
  customer_id: z.number().int().default(0),
  customer_note: texto,
  total: texto,
  total_tax: texto,
  billing: direccionSchema,
  shipping: direccionSchema,
  line_items: z.array(lineaSchema).default([]),
  shipping_lines: z.array(envioSchema).default([]),
  meta_data: z.array(metaSchema).default([]),
});

export type WooOrder = z.infer<typeof wooOrderSchema>;

/**
 * Comprueba que la conexión funciona pidiendo una sola página vacía.
 *
 * Devuelve el número de pedidos que dice tener la tienda, que es una señal
 * clara de que no solo conecta, sino que además tiene permiso para leer.
 */
export async function testWooConnection(
  config: WooConfig,
): Promise<{ ok: true; orders: number } | { ok: false; error: string }> {
  try {
    const resultado = await fetchWooPage(
      config,
      "orders",
      { per_page: 1, status: "any" },
      wooOrderSchema,
    );
    return { ok: true, orders: resultado.totalItems };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof WooError ? error.message : "Fallo desconocido al conectar.",
    };
  }
}
