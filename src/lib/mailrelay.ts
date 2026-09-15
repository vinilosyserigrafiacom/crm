import { z } from "zod";

/**
 * Cliente de la API de Mailrelay (v2, la que cuelga de /api/v1).
 *
 * Este fichero solo sabe hablar con la API; de dónde salen las credenciales lo
 * decide `src/lib/integration-config.ts`, que mira primero lo escrito en
 * Ajustes (cifrado) y luego el .env. Aquí queda el lector del entorno, que es
 * el respaldo para montar un servidor nuevo sin entrar a la aplicación.
 *
 * De la API se usan tres cosas y solo tres, a propósito: listar grupos, listar
 * suscriptores paginando y `subscribers/sync`, que crea o actualiza en una sola
 * llamada y está pensada justo para esto, sincronizar desde un sistema de
 * fuera. Todo lo demás (filtros por grupo, búsquedas) se resuelve aquí con los
 * datos ya traídos, para no depender de parámetros de consulta que cambien.
 */

export interface MailrelayConfig {
  /** Raíz de la cuenta, sin barra final: https://tucuenta.ipzmarketing.com */
  baseUrl: string;
  apiKey: string;
}

export type MailrelayConfigResult =
  | { ok: true; config: MailrelayConfig }
  | { ok: false; missing: string[] };

export function readMailrelayConfig(
  env: NodeJS.ProcessEnv = process.env,
): MailrelayConfigResult {
  const missing: string[] = [];
  const baseUrl = (env.MAILRELAY_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (env.MAILRELAY_API_KEY ?? "").trim();

  if (baseUrl === "") missing.push("MAILRELAY_URL");
  if (apiKey === "") missing.push("MAILRELAY_API_KEY");
  if (missing.length > 0) return { ok: false, missing };

  return { ok: true, config: { baseUrl, apiKey } };
}

export class MailrelayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "MailrelayError";
  }
}

function describeStatus(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return `Mailrelay ha rechazado la clave (${status}). Revísala en Ajustes → Mailrelay y comprueba que sigue activa en tu cuenta.`;
  }
  if (status === 404) {
    return "No se encuentra la API en esa dirección (404). La dirección tiene que ser la de tu cuenta, del estilo https://tucuenta.ipzmarketing.com";
  }
  if (status === 422) {
    return `Mailrelay ha rechazado los datos (422): ${body.slice(0, 200)}`;
  }
  if (status === 429) {
    return "Mailrelay ha cortado por exceso de peticiones (429). Espera un rato y vuelve a subir el grupo.";
  }
  if (status >= 500) {
    return `Mailrelay ha respondido con un error interno (${status}). Vuelve a intentarlo en un rato.`;
  }
  return `Mailrelay ha respondido ${status}: ${body.slice(0, 200)}`;
}

const TIMEOUT_MS = 30_000;

/** Una llamada a la API, con la clave en cabecera y nunca en la URL. */
async function request<T>(
  config: MailrelayConfig,
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string | number>; body?: unknown; schema: z.ZodType<T> },
): Promise<T> {
  const url = new URL(`${config.baseUrl}/api/v1/${path}`);
  for (const [clave, valor] of Object.entries(options.query ?? {})) {
    url.searchParams.set(clave, String(valor));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "X-AUTH-TOKEN": config.apiKey,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new MailrelayError(
        `Mailrelay no ha respondido en ${TIMEOUT_MS / 1000} segundos.`,
      );
    }
    throw new MailrelayError(
      "No se ha podido conectar con Mailrelay. Comprueba la dirección de la cuenta y que el servidor tenga salida a internet.",
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new MailrelayError(describeStatus(response.status, body), response.status);
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new MailrelayError("Mailrelay ha devuelto algo que no es JSON.");
  }

  const parsed = options.schema.safeParse(json);
  if (!parsed.success) {
    const fallo = parsed.error.issues[0];
    throw new MailrelayError(
      `La respuesta de Mailrelay no tiene la forma esperada en ${path}: ${fallo?.path.join(".")} ${fallo?.message}`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Forma de los datos
// ---------------------------------------------------------------------------

const groupSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  subscribers_count: z.number().int().nullish(),
});
export type MailrelayGroup = z.infer<typeof groupSchema>;

/**
 * Un suscriptor.
 *
 * `group_ids` es la pieza que importa: es lo que permite sacar a alguien de un
 * grupo sin tocar los demás a los que pertenezca. Se declara opcional porque no
 * todas las respuestas lo traen, y quien lo use tiene que contar con que falte.
 */
const subscriberSchema = z.object({
  id: z.number().int(),
  email: z.string(),
  name: z.string().nullish(),
  status: z.string().nullish(),
  group_ids: z.array(z.number().int()).nullish(),
  groups: z.array(z.object({ id: z.number().int() })).nullish(),
});
export type MailrelaySubscriber = z.infer<typeof subscriberSchema>;

/** Los grupos de un suscriptor, venga la respuesta como venga. */
export function groupIdsOf(subscriber: MailrelaySubscriber): number[] | null {
  if (subscriber.group_ids) return subscriber.group_ids;
  if (subscriber.groups) return subscriber.groups.map((g) => g.id);
  return null;
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

/** Los grupos de la cuenta. Es además la prueba de que la conexión funciona. */
export async function listGroups(config: MailrelayConfig): Promise<MailrelayGroup[]> {
  return request(config, "GET", "groups", {
    query: { per_page: 200 },
    schema: z.array(groupSchema),
  });
}

/** Cuántos suscriptores se recorren como mucho antes de rendirse. */
const MAX_PAGES = 200;
const PER_PAGE = 100;

/**
 * Todos los suscriptores de la cuenta, de cien en cien.
 *
 * Se traen todos y se filtra aquí en vez de pedirle a Mailrelay los de un grupo
 * concreto: un parámetro de filtro que la API ignorase devolvería la lista
 * entera sin avisar, y el que sobra acabaría fuera del grupo por error. Con
 * unos miles de suscriptores esto son unas pocas peticiones.
 */
export async function* fetchAllSubscribers(
  config: MailrelayConfig,
): AsyncGenerator<MailrelaySubscriber[]> {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const lote = await request(config, "GET", "subscribers", {
      query: { page, per_page: PER_PAGE },
      schema: z.array(subscriberSchema),
    });
    if (lote.length === 0) return;
    yield lote;
    if (lote.length < PER_PAGE) return;
  }
}

export interface SubscriberInput {
  email: string;
  name?: string | null;
  /** Grupos a los que queda perteneciendo. Es la lista completa, no un añadido. */
  groupIds: number[];
  status?: "active" | "inactive";
}

/**
 * Crea o actualiza un suscriptor.
 *
 * `subscribers/sync` existe justo para esto y ahorra tener que averiguar antes
 * si la persona ya estaba dada de alta.
 */
export async function syncSubscriber(
  config: MailrelayConfig,
  input: SubscriberInput,
): Promise<MailrelaySubscriber> {
  return request(config, "POST", "subscribers/sync", {
    body: {
      email: input.email,
      name: input.name ?? "",
      status: input.status ?? "active",
      group_ids: input.groupIds,
    },
    // La respuesta unas veces trae el suscriptor suelto y otras envuelto en
    // { data: … }; se aceptan las dos formas y se devuelve el suscriptor.
    schema: z.union([
      subscriberSchema,
      z.object({ data: subscriberSchema }).transform((r) => r.data),
    ]),
  });
}

export interface ConnectionTest {
  ok: boolean;
  message: string;
  groups?: MailrelayGroup[];
}

/** Comprueba la conexión trayendo los grupos de la cuenta. */
export async function testMailrelayConnection(
  config: MailrelayConfig,
): Promise<ConnectionTest> {
  try {
    const groups = await listGroups(config);
    return {
      ok: true,
      message:
        groups.length === 0
          ? "Conectado con Mailrelay, pero la cuenta no tiene ningún grupo todavía. Crea uno en Mailrelay y vuelve aquí."
          : `Conectado con Mailrelay. ${groups.length} ${groups.length === 1 ? "grupo" : "grupos"} en la cuenta.`,
      groups,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Error desconocido.",
    };
  }
}
