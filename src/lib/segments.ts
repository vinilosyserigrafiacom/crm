import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseTags } from "@/lib/format";
import { formatCents } from "@/lib/money";

/**
 * Segmentación de destinatarios para las campañas de newsletter.
 *
 * Dos decisiones que sostienen el resto del módulo:
 *
 *  1. La lista de correos NO se guarda. Se resuelve cada vez que se mira o se
 *     exporta. Así una baja surte efecto de inmediato en todos los grupos, sin
 *     depender de que alguien se acuerde de refrescar una lista congelada.
 *  2. Una baja (`marketingOptOut`) manda siempre, por encima de cualquier
 *     regla. El consentimiento expreso solo se exige si el segmento lo pide,
 *     porque hay envíos que se amparan en la relación comercial previa.
 */

// ---------------------------------------------------------------------------
// Reglas de los segmentos dinámicos
// ---------------------------------------------------------------------------

export const segmentRulesSchema = z.object({
  /** Tipos de cliente. Vacío = todos. */
  kinds: z.array(z.enum(["COMPANY", "INDIVIDUAL"])).default([]),
  /** Basta con que tenga una de estas etiquetas. Vacío = cualquiera. */
  tagsAny: z.array(z.string().trim().min(1)).default([]),
  /** Provincias de alguna de sus direcciones. Vacío = cualquiera. */
  provinces: z.array(z.string().trim().min(1)).default([]),
  /** Excluir clientes archivados. */
  onlyActive: z.boolean().default(true),
  /** Ha pedido algo en los últimos N meses. Null = da igual. */
  orderedSinceMonths: z.number().int().min(1).max(120).nullable().default(null),
  /** Ha gastado al menos esto, en céntimos, sin contar pedidos anulados. */
  minSpentCents: z.number().int().min(0).nullable().default(null),
});

export type SegmentRules = z.infer<typeof segmentRulesSchema>;

export const EMPTY_RULES: SegmentRules = {
  kinds: [],
  tagsAny: [],
  provinces: [],
  onlyActive: true,
  orderedSinceMonths: null,
  minSpentCents: null,
};

/** Lee las reglas guardadas; si el JSON está roto, devuelve las de por defecto. */
export function parseRules(json: string | null | undefined): SegmentRules {
  if (!json) return EMPTY_RULES;
  try {
    const parsed = segmentRulesSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : EMPTY_RULES;
  } catch {
    return EMPTY_RULES;
  }
}

/** Resumen en castellano de las reglas, para enseñarlo en el listado. */
export function describeRules(rules: SegmentRules): string {
  const partes: string[] = [];

  if (rules.kinds.length === 1) {
    partes.push(rules.kinds[0] === "COMPANY" ? "empresas" : "particulares");
  }
  if (rules.tagsAny.length > 0) {
    partes.push(`etiquetados como ${rules.tagsAny.join(" o ")}`);
  }
  if (rules.provinces.length > 0) {
    partes.push(`de ${rules.provinces.join(" o ")}`);
  }
  if (rules.orderedSinceMonths !== null) {
    partes.push(
      rules.orderedSinceMonths === 12
        ? "con pedidos en el último año"
        : `con pedidos en los últimos ${rules.orderedSinceMonths} meses`,
    );
  }
  if (rules.minSpentCents !== null && rules.minSpentCents > 0) {
    partes.push(`que han superado los ${formatCents(rules.minSpentCents)}`);
  }
  if (!rules.onlyActive) {
    partes.push("incluyendo archivados");
  }

  if (partes.length === 0) return "Todos los clientes activos";
  return `Clientes ${partes.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Resolución de destinatarios
// ---------------------------------------------------------------------------

export interface Recipient {
  email: string;
  /** Nombre de la persona si el correo es de un contacto; si no, del cliente. */
  name: string;
  customerId: string;
  customerCode: string;
  customerName: string;
  source: "CUSTOMER" | "CONTACT";
  /** Fecha del consentimiento expreso, si consta. */
  consentAt: Date | null;
}

/** Motivos por los que un cliente del segmento se queda fuera del envío. */
export interface ExcludedRecipient {
  customerId: string;
  customerName: string;
  reason: "SIN_CORREO" | "BAJA" | "SIN_CONSENTIMIENTO";
}

export interface ResolvedAudience {
  recipients: Recipient[];
  excluded: ExcludedRecipient[];
  /** Clientes que entran en el segmento, tengan o no correo utilizable. */
  customerCount: number;
}

export const EXCLUSION_LABELS: Record<ExcludedRecipient["reason"], string> = {
  SIN_CORREO: "Sin correo electrónico",
  BAJA: "Se ha dado de baja",
  SIN_CONSENTIMIENTO: "Sin consentimiento expreso",
};

/** Lo que hace falta de un cliente para resolver sus destinatarios. */
const customerSelect = {
  id: true,
  code: true,
  legalName: true,
  tradeName: true,
  email: true,
  tags: true,
  kind: true,
  active: true,
  marketingOptOut: true,
  marketingConsentAt: true,
  contacts: {
    select: {
      id: true,
      name: true,
      email: true,
      isPrimary: true,
      marketingOptOut: true,
      marketingConsentAt: true,
    },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  },
  addresses: { select: { province: true } },
} satisfies Prisma.CustomerSelect;

type CustomerForAudience = Prisma.CustomerGetPayload<{ select: typeof customerSelect }>;

/** Compara textos ignorando mayúsculas y acentos. */
function igual(a: string, b: string): boolean {
  const limpia = (t: string) =>
    t
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
  return limpia(a) === limpia(b);
}

/**
 * Traduce las reglas a una consulta de Prisma.
 *
 * Etiquetas y provincias se filtran aquí solo de forma aproximada (`contains`),
 * porque las etiquetas viven en un campo de texto separado por comas y SQLite no
 * distingue acentos. El filtro exacto se remata luego en memoria con `igual()`;
 * sobre el volumen de clientes de un taller la diferencia no se nota y evita
 * que «vinilo» arrastre a «vinilos».
 */
export function buildCustomerWhere(rules: SegmentRules): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};

  if (rules.onlyActive) where.active = true;
  if (rules.kinds.length > 0) where.kind = { in: rules.kinds };
  if (rules.tagsAny.length > 0) {
    where.OR = rules.tagsAny.map((tag) => ({ tags: { contains: tag } }));
  }
  if (rules.provinces.length > 0) {
    where.addresses = {
      some: { OR: rules.provinces.map((p) => ({ province: { contains: p } })) },
    };
  }
  if (rules.orderedSinceMonths !== null) {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - rules.orderedSinceMonths);
    where.orders = { some: { orderDate: { gte: desde }, status: { not: "CANCELLED" } } };
  }

  return where;
}

/** Ids de los clientes que superan el gasto mínimo pedido por las reglas. */
async function customersAboveSpend(minSpentCents: number): Promise<Set<string>> {
  const grupos = await prisma.order.groupBy({
    by: ["customerId"],
    where: { status: { not: "CANCELLED" } },
    _sum: { total: true },
  });
  return new Set(
    grupos.filter((g) => (g._sum.total ?? 0) >= minSpentCents).map((g) => g.customerId),
  );
}

/** Aplica los filtros que no se pueden expresar bien en la consulta. */
function refine(customers: CustomerForAudience[], rules: SegmentRules): CustomerForAudience[] {
  let resultado = customers;

  if (rules.tagsAny.length > 0) {
    resultado = resultado.filter((c) => {
      const etiquetas = parseTags(c.tags);
      return rules.tagsAny.some((t) => etiquetas.some((e) => igual(e, t)));
    });
  }
  if (rules.provinces.length > 0) {
    resultado = resultado.filter((c) =>
      c.addresses.some((a) => a.province && rules.provinces.some((p) => igual(a.province!, p))),
    );
  }

  return resultado;
}

/** Los clientes que componen el segmento, ya sea por reglas o a mano. */
async function customersForSegment(segment: {
  kind: string;
  rulesJson: string;
  id: string;
}): Promise<CustomerForAudience[]> {
  if (segment.kind === "DYNAMIC") {
    const rules = parseRules(segment.rulesJson);
    const candidatos = await prisma.customer.findMany({
      where: buildCustomerWhere(rules),
      select: customerSelect,
      orderBy: { legalName: "asc" },
    });
    const refinados = refine(candidatos, rules);

    if (rules.minSpentCents !== null && rules.minSpentCents > 0) {
      const conGasto = await customersAboveSpend(rules.minSpentCents);
      return refinados.filter((c) => conGasto.has(c.id));
    }
    return refinados;
  }

  const miembros = await prisma.segmentMember.findMany({
    where: { segmentId: segment.id },
    select: { customer: { select: customerSelect } },
    orderBy: { customer: { legalName: "asc" } },
  });
  return miembros.map((m) => m.customer);
}

/**
 * Resuelve la lista de correos de un segmento.
 *
 * Reglas de inclusión, en este orden:
 *   1. Si el cliente está de baja, no entra nada suyo: ni su correo ni el de
 *      sus contactos. Una empresa que pide no recibir comunicaciones no espera
 *      que sigan llegando a su gente.
 *   2. Se elige el contacto principal, o todos si el segmento lo pide. Si no
 *      hay ningún contacto con correo, se usa el del cliente.
 *   3. Cada correo se descarta si esa persona se dio de baja, y también si el
 *      segmento exige consentimiento expreso y no consta.
 *   4. Se quitan los correos repetidos, comparando en minúsculas.
 */
/** Lo que hace falta saber de un cliente para sacar sus destinatarios. */
export interface AudienceCustomer {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
  email: string | null;
  marketingOptOut: boolean;
  marketingConsentAt: Date | null;
  contacts: {
    name: string;
    email: string | null;
    isPrimary: boolean;
    marketingOptOut: boolean;
    marketingConsentAt: Date | null;
  }[];
}

export interface AudienceOptions {
  onlyWithConsent: boolean;
  includeAllContacts: boolean;
}

/**
 * Destinatarios que aporta un cliente, o el motivo por el que no aporta ninguno.
 *
 * Está separada de la consulta a propósito: es la parte con reglas y la que
 * conviene poder probar sin base de datos.
 */
export function recipientsForCustomer(
  customer: AudienceCustomer,
  options: AudienceOptions,
): { recipients: Recipient[]; excludedReason: ExcludedRecipient["reason"] | null } {
  const nombreCliente = customer.tradeName ?? customer.legalName;

  // Una empresa que pide no recibir comunicaciones no espera que le sigan
  // llegando a su gente: la baja del cliente arrastra a sus contactos.
  if (customer.marketingOptOut) {
    return { recipients: [], excludedReason: "BAJA" };
  }

  const contactosConCorreo = customer.contacts.filter((c) => c.email?.trim());
  const elegidos = options.includeAllContacts
    ? contactosConCorreo
    : contactosConCorreo.filter((c) => c.isPrimary).slice(0, 1);

  const candidatos: Recipient[] = elegidos
    .filter((contacto) => !contacto.marketingOptOut)
    .map((contacto) => ({
      email: contacto.email!.trim(),
      name: contacto.name,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: nombreCliente,
      source: "CONTACT" as const,
      consentAt: contacto.marketingConsentAt,
    }));

  // El correo de la ficha entra si no ha salido ningún contacto, o si el grupo
  // pide escribir a todo el mundo.
  const correoCliente = customer.email?.trim();
  if (correoCliente && (candidatos.length === 0 || options.includeAllContacts)) {
    candidatos.push({
      email: correoCliente,
      name: nombreCliente,
      customerId: customer.id,
      customerCode: customer.code,
      customerName: nombreCliente,
      source: "CUSTOMER",
      consentAt: customer.marketingConsentAt,
    });
  }

  if (candidatos.length === 0) {
    // Sin candidatos puede ser porque no hay ningún correo, o porque los que
    // había son de gente que se dio de baja. Se distinguen para que la pantalla
    // diga qué arreglar.
    return {
      recipients: [],
      excludedReason: contactosConCorreo.length > 0 ? "BAJA" : "SIN_CORREO",
    };
  }

  const admitidos = options.onlyWithConsent
    ? candidatos.filter((c) => c.consentAt !== null)
    : candidatos;

  if (admitidos.length === 0) {
    return { recipients: [], excludedReason: "SIN_CONSENTIMIENTO" };
  }

  return { recipients: admitidos, excludedReason: null };
}

/**
 * Resuelve la lista de correos de un segmento.
 *
 * Aplica `recipientsForCustomer` a cada cliente del grupo y quita los correos
 * repetidos comparando en minúsculas: la misma persona puede figurar en dos
 * fichas y no debe recibir el envío dos veces.
 */
export async function resolveAudience(segment: {
  id: string;
  kind: string;
  rulesJson: string;
  onlyWithConsent: boolean;
  includeAllContacts: boolean;
}): Promise<ResolvedAudience> {
  const customers = await customersForSegment(segment);

  const recipients: Recipient[] = [];
  const excluded: ExcludedRecipient[] = [];
  const vistos = new Set<string>();

  for (const customer of customers) {
    const { recipients: suyos, excludedReason } = recipientsForCustomer(customer, segment);

    if (excludedReason !== null) {
      excluded.push({
        customerId: customer.id,
        customerName: customer.tradeName ?? customer.legalName,
        reason: excludedReason,
      });
      continue;
    }

    for (const destinatario of suyos) {
      const clave = destinatario.email.toLowerCase();
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      recipients.push(destinatario);
    }
  }

  return { recipients, excluded, customerCount: customers.length };
}

// ---------------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------------

/**
 * Escapa un campo para CSV según RFC 4180.
 *
 * Además antepone un apóstrofo a lo que empiece por =, +, - o @. Excel y
 * LibreOffice interpretan esos valores como fórmulas al abrir el fichero, y los
 * nombres de cliente los teclea una persona: bastaría con llamarse
 * «=HYPERLINK(...)» para que la hoja hiciera algo raro en el ordenador de quien
 * la abra.
 */
function csvField(value: string): string {
  const seguro = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(seguro)) return `"${seguro.replace(/"/g, '""')}"`;
  return seguro;
}

/**
 * CSV con las columnas que esperan Mailchimp, Brevo y compañía.
 *
 * Se antepone el BOM de UTF-8 porque, sin él, Excel abre el fichero en la
 * codificación del sistema y destroza los acentos de los nombres.
 */
export function toCsv(recipients: Recipient[]): string {
  const cabecera = ["email", "nombre", "cliente", "codigo_cliente", "origen", "consentimiento"];
  const filas = recipients.map((r) =>
    [
      r.email,
      r.name,
      r.customerName,
      r.customerCode,
      r.source === "CONTACT" ? "contacto" : "cliente",
      r.consentAt ? r.consentAt.toISOString().slice(0, 10) : "",
    ]
      .map(csvField)
      .join(","),
  );
  return `﻿${[cabecera.join(","), ...filas].join("\r\n")}\r\n`;
}

/** Etiquetas y provincias en uso, para sugerirlas al escribir las reglas. */
export async function loadSuggestions(): Promise<{ tags: string[]; provinces: string[] }> {
  const [clientes, direcciones] = await Promise.all([
    prisma.customer.findMany({
      where: { tags: { not: null } },
      select: { tags: true },
    }),
    prisma.address.findMany({
      where: { province: { not: null } },
      distinct: ["province"],
      select: { province: true },
      orderBy: { province: "asc" },
    }),
  ]);

  const tags = new Set<string>();
  for (const cliente of clientes) {
    for (const tag of parseTags(cliente.tags)) tags.add(tag);
  }

  return {
    tags: [...tags].sort((a, b) => a.localeCompare(b, "es")),
    provinces: direcciones
      .map((d) => d.province)
      .filter((p): p is string => Boolean(p && p.trim())),
  };
}
