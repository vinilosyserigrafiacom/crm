import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { reserveCustomerCode } from "@/lib/numbering";
import { formatCents } from "@/lib/money";
import type { OrderStatus } from "@/lib/validation";
import {
  fetchWooAll,
  wooCustomerSchema,
  wooOrderSchema,
  type WooConfig,
  type WooCustomer,
  type WooOrder,
} from "@/lib/woocommerce";
import {
  mapCustomer,
  mapCustomerFromOrder,
  mapOrder,
  mapWooStatus,
  type MappedAddress,
  type MappedOrder,
} from "@/lib/woo-mapping";

/**
 * Importación desde WooCommerce.
 *
 * Va en un solo sentido: la tienda manda y el CRM no le escribe nada. Eso
 * significa que ningún fallo de aquí puede estropear la tienda, que es la que
 * está cobrando.
 *
 * Las dos reglas que sostienen el resto:
 *
 *  1. **No se consume numeración.** Un pedido importado conserva el número de
 *     la tienda y `number` sigue vacío hasta que alguien lo confirme aquí. Si
 *     se numerase al importar, cada pedido que la tienda acabe cancelando
 *     dejaría un hueco en una serie que Verifactu exige correlativa.
 *  2. **El trabajo del taller manda sobre la tienda.** Si alguien ha movido un
 *     pedido de columna, la siguiente sincronización no lo devuelve a su sitio.
 *     Ver `decideStatus()`.
 */

export interface SyncWarning {
  scope: "customer" | "order";
  reference: string;
  message: string;
}

export interface SyncResult {
  customersCreated: number;
  customersUpdated: number;
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  warnings: SyncWarning[];
}

/**
 * Qué hacer con el estado que trae la tienda.
 *
 *  - `sin-cambios`: la tienda dice lo mismo que ya tenemos.
 *  - `aplicar`: el pedido sigue donde lo dejó la última sincronización, así que
 *    el cambio de la tienda es información nueva y se aplica.
 *  - `divergido`: el taller lo ha movido por su cuenta. A partir de ahí manda
 *    el taller: para ellos lo que importa es dónde está el trabajo de verdad, y
 *    de eso la tienda no se entera.
 *
 * En la primera importación no hay estado anterior y no hay nada que respetar.
 */
export type StatusDecision = "sin-cambios" | "aplicar" | "divergido";

export function decideStatus(
  currentStatus: string,
  lastSeenWooStatus: string | null,
  incomingWooStatus: string,
): StatusDecision {
  const entrante: OrderStatus = mapWooStatus(incomingWooStatus);
  if (currentStatus === entrante) return "sin-cambios";
  if (lastSeenWooStatus === null) return "aplicar";
  return currentStatus === mapWooStatus(lastSeenWooStatus) ? "aplicar" : "divergido";
}

/** Campos de contacto que la tienda puede refrescar sin pisar nada nuestro. */
function customerUpdateData(mapped: ReturnType<typeof mapCustomer>) {
  // Se actualizan solo los datos que la tienda conoce mejor que nosotros. Ni
  // etiquetas, ni notas, ni consentimiento, ni bajas: eso lo gestiona el taller
  // y una sincronización no tiene por qué saberlo.
  const data: Prisma.CustomerUpdateInput = {
    legalName: mapped.legalName,
    kind: mapped.kind,
    syncedAt: new Date(),
  };
  if (mapped.email) data.email = mapped.email;
  if (mapped.phone) data.phone = mapped.phone;
  if (mapped.taxId) data.taxId = mapped.taxId;
  return data;
}

/** Crea las direcciones que aún no estén, comparando por calle. */
async function syncAddresses(
  tx: Prisma.TransactionClient,
  customerId: string,
  addresses: MappedAddress[],
): Promise<void> {
  if (addresses.length === 0) return;

  const existentes = await tx.address.findMany({
    where: { customerId },
    select: { line1: true, kind: true },
  });
  const conocidas = new Set(existentes.map((a) => `${a.kind}|${a.line1.toLowerCase()}`));

  for (const direccion of addresses) {
    const clave = `${direccion.kind}|${direccion.line1.toLowerCase()}`;
    if (conocidas.has(clave)) continue;
    await tx.address.create({
      data: {
        customerId,
        ...direccion,
        // Solo es la dirección por defecto si el cliente no tenía ninguna de
        // ese tipo: no se cambia una elección que haya hecho el taller.
        isDefault: !existentes.some((a) => a.kind === direccion.kind),
      },
    });
    conocidas.add(clave);
  }
}

/** Crea el contacto principal si la ficha no tenía ninguno. */
async function ensureContact(
  tx: Prisma.TransactionClient,
  customerId: string,
  contactName: string | null,
  email: string | null,
  phone: string | null,
): Promise<void> {
  if (!contactName) return;
  const cuantos = await tx.contact.count({ where: { customerId } });
  if (cuantos > 0) return;

  await tx.contact.create({
    data: {
      customerId,
      name: contactName,
      email,
      phone,
      isPrimary: true,
      // Comprar en la tienda no es consentir recibir publicidad: la ficha entra
      // sin consentimiento y ya se marcará a mano si procede.
    },
  });
}

/** Da de alta o actualiza un cliente que viene de la tienda. */
async function upsertCustomer(
  tx: Prisma.TransactionClient,
  mapped: ReturnType<typeof mapCustomer>,
  userId: string | null,
): Promise<{ id: string; created: boolean }> {
  const existente = await tx.customer.findUnique({
    where: { wooId: mapped.wooId },
    select: { id: true },
  });

  if (existente) {
    await tx.customer.update({
      where: { id: existente.id },
      data: customerUpdateData(mapped),
    });
    await syncAddresses(tx, existente.id, mapped.addresses);
    return { id: existente.id, created: false };
  }

  // Antes de crear otra ficha, se busca por correo: es muy habitual tener ya al
  // cliente dado de alta a mano desde antes de conectar la tienda, y duplicarlo
  // sería peor que no importarlo.
  const porCorreo = mapped.email
    ? await tx.customer.findFirst({
        where: { email: mapped.email, wooId: null },
        select: { id: true },
      })
    : null;

  if (porCorreo) {
    await tx.customer.update({
      where: { id: porCorreo.id },
      data: { ...customerUpdateData(mapped), wooId: mapped.wooId },
    });
    await syncAddresses(tx, porCorreo.id, mapped.addresses);
    await ensureContact(tx, porCorreo.id, mapped.contactName, mapped.email, mapped.phone);
    await recordAudit(tx, {
      userId,
      entity: "Customer",
      entityId: porCorreo.id,
      action: "UPDATE",
      summary: `Ficha enlazada con el cliente ${mapped.wooId} de la tienda por coincidir el correo`,
      data: { wooId: mapped.wooId, email: mapped.email },
    });
    return { id: porCorreo.id, created: false };
  }

  const code = await reserveCustomerCode(tx);
  const creado = await tx.customer.create({
    data: {
      code,
      wooId: mapped.wooId,
      source: "WOOCOMMERCE",
      syncedAt: new Date(),
      kind: mapped.kind,
      legalName: mapped.legalName,
      tradeName: mapped.tradeName,
      taxId: mapped.taxId,
      email: mapped.email,
      phone: mapped.phone,
    },
  });
  await syncAddresses(tx, creado.id, mapped.addresses);
  await ensureContact(tx, creado.id, mapped.contactName, mapped.email, mapped.phone);

  await recordAudit(tx, {
    userId,
    entity: "Customer",
    entityId: creado.id,
    action: "CREATE",
    summary: `Cliente ${creado.code} importado de la tienda · ${creado.legalName}`,
    data: { wooId: mapped.wooId },
  });

  return { id: creado.id, created: true };
}

/** Totales del pedido, en los campos que espera el modelo. */
function totalsData(mapped: MappedOrder) {
  return {
    globalDiscountRate: 0,
    linesSubtotal: mapped.totals.linesSubtotal,
    discountTotal: mapped.totals.discountTotal,
    taxableBase: mapped.totals.taxableBase,
    vatTotal: mapped.totals.vatTotal,
    withholdingTotal: mapped.totals.withholdingTotal,
    total: mapped.totals.total,
    vatBreakdown: JSON.stringify(mapped.totals.vatBreakdown),
  };
}

/** Da de alta o actualiza un pedido de la tienda. */
async function upsertOrder(
  tx: Prisma.TransactionClient,
  mapped: MappedOrder,
  customerId: string,
  userId: string | null,
): Promise<{ created: boolean; statusDiverged: boolean }> {
  const existente = await tx.order.findUnique({
    where: { wooId: mapped.wooId },
    select: { id: true, status: true, wooStatus: true, total: true, number: true },
  });

  if (!existente) {
    const creado = await tx.order.create({
      data: {
        // Sin número del CRM a propósito: el de la tienda va en wooNumber.
        series: "A",
        year: mapped.orderDate.getFullYear(),
        customerId,
        createdById: userId,
        source: "WOOCOMMERCE",
        wooId: mapped.wooId,
        wooNumber: mapped.wooNumber,
        wooStatus: mapped.wooStatus,
        syncedAt: new Date(),
        status: mapped.status,
        orderDate: mapped.orderDate,
        title: mapped.title,
        customerRef: mapped.customerRef,
        notes: mapped.notes,
        currency: mapped.currency,
        ...totalsData(mapped),
        lines: { create: mapped.lines },
      },
    });

    await recordAudit(tx, {
      userId,
      entity: "Order",
      entityId: creado.id,
      action: "CREATE",
      summary: `Pedido #${mapped.wooNumber} importado de la tienda por ${formatCents(creado.total)}`,
      data: { wooId: mapped.wooId, wooStatus: mapped.wooStatus },
    });
    return { created: true, statusDiverged: false };
  }

  const decision = decideStatus(existente.status, existente.wooStatus, mapped.wooStatus);
  const aplicarEstado = decision === "aplicar";

  // Las líneas y los importes sí se refrescan siempre: son la foto de lo que el
  // cliente compró, y eso solo lo sabe la tienda.
  await tx.orderLine.deleteMany({ where: { orderId: existente.id } });
  await tx.order.update({
    where: { id: existente.id },
    data: {
      customerId,
      wooNumber: mapped.wooNumber,
      wooStatus: mapped.wooStatus,
      syncedAt: new Date(),
      orderDate: mapped.orderDate,
      title: mapped.title,
      customerRef: mapped.customerRef,
      notes: mapped.notes,
      currency: mapped.currency,
      ...(aplicarEstado ? { status: mapped.status } : {}),
      ...totalsData(mapped),
      lines: { create: mapped.lines },
    },
  });

  if (existente.total !== mapped.totals.total || aplicarEstado) {
    await recordAudit(tx, {
      userId,
      entity: "Order",
      entityId: existente.id,
      action: aplicarEstado ? "STATUS_CHANGE" : "UPDATE",
      summary: aplicarEstado
        ? `Pedido #${mapped.wooNumber}: la tienda lo ha puesto en «${mapped.wooStatus}»`
        : `Pedido #${mapped.wooNumber} actualizado desde la tienda: ${formatCents(existente.total)} → ${formatCents(mapped.totals.total)}`,
      data: { wooId: mapped.wooId, wooStatus: mapped.wooStatus },
    });
  }

  return { created: false, statusDiverged: decision === "divergido" };
}

export interface SyncOptions {
  config: WooConfig;
  /** Solo lo modificado después de esta fecha. Null para traerlo todo. */
  since: Date | null;
  userId: string | null;
  /** Inyectable para poder probar sin red. */
  fetchCustomers?: () => AsyncGenerator<WooCustomer[]>;
  fetchOrders?: () => AsyncGenerator<WooOrder[]>;
}

/**
 * Importa clientes y pedidos.
 *
 * Cada cliente y cada pedido van en su propia transacción, no todo en una. Con
 * una transacción única, un pedido raro al final tiraría abajo el trabajo de
 * los cien anteriores; así lo que entra bien se queda, y lo que falla se
 * apunta como aviso.
 */
export async function runWooSync(options: SyncOptions): Promise<SyncResult> {
  const { config, since, userId } = options;

  const resultado: SyncResult = {
    customersCreated: 0,
    customersUpdated: 0,
    ordersCreated: 0,
    ordersUpdated: 0,
    ordersSkipped: 0,
    warnings: [],
  };

  const parametros: Record<string, string | number> = { per_page: 100 };
  if (since) parametros.modified_after = since.toISOString().slice(0, 19);

  // --- Clientes -------------------------------------------------------------

  const clientes =
    options.fetchCustomers?.() ??
    fetchWooAll(config, "customers", { ...parametros, role: "all" }, wooCustomerSchema);

  for await (const lote of clientes) {
    for (const woo of lote) {
      try {
        const mapped = mapCustomer(woo);
        const { created } = await prisma.$transaction((tx) =>
          upsertCustomer(tx, mapped, userId),
        );
        if (created) resultado.customersCreated += 1;
        else resultado.customersUpdated += 1;
      } catch (error) {
        resultado.warnings.push({
          scope: "customer",
          reference: String(woo.id),
          message: error instanceof Error ? error.message : "Fallo desconocido",
        });
      }
    }
  }

  // --- Pedidos --------------------------------------------------------------

  const pedidos =
    options.fetchOrders?.() ??
    fetchWooAll(config, "orders", { ...parametros, status: "any" }, wooOrderSchema);

  for await (const lote of pedidos) {
    for (const woo of lote) {
      try {
        const mapped = mapOrder(woo);

        // El pedido puede venir de un invitado, sin cuenta en la tienda. En ese
        // caso se saca el cliente de la propia dirección de facturación.
        const { customerId, customerCreated } = await prisma.$transaction(async (tx) => {
          if (woo.customer_id > 0) {
            const existente = await tx.customer.findUnique({
              where: { wooId: woo.customer_id },
              select: { id: true },
            });
            if (existente) return { customerId: existente.id, customerCreated: false };
          }

          const deInvitado = mapCustomerFromOrder(woo);
          const porCorreo = deInvitado.email
            ? await tx.customer.findFirst({
                where: { email: deInvitado.email },
                select: { id: true },
              })
            : null;
          if (porCorreo) return { customerId: porCorreo.id, customerCreated: false };

          const code = await reserveCustomerCode(tx);
          const creado = await tx.customer.create({
            data: {
              code,
              wooId: woo.customer_id > 0 ? woo.customer_id : null,
              source: "WOOCOMMERCE",
              syncedAt: new Date(),
              kind: deInvitado.kind,
              legalName: deInvitado.legalName,
              taxId: deInvitado.taxId,
              email: deInvitado.email,
              phone: deInvitado.phone,
            },
          });
          await syncAddresses(tx, creado.id, deInvitado.addresses);
          await ensureContact(
            tx,
            creado.id,
            deInvitado.contactName,
            deInvitado.email,
            deInvitado.phone,
          );
          await recordAudit(tx, {
            userId,
            entity: "Customer",
            entityId: creado.id,
            action: "CREATE",
            summary: `Cliente ${creado.code} creado desde el pedido #${mapped.wooNumber} de la tienda`,
            data: { wooOrderId: woo.id },
          });
          return { customerId: creado.id, customerCreated: true };
        });
        if (customerCreated) resultado.customersCreated += 1;

        const { created, statusDiverged } = await prisma.$transaction((tx) =>
          upsertOrder(tx, mapped, customerId, userId),
        );
        if (created) resultado.ordersCreated += 1;
        else resultado.ordersUpdated += 1;
        // «Saltado» no es lo contrario de «actualizado»: las líneas y los
        // importes se refrescan igual, lo que se respeta es el estado.
        if (statusDiverged) resultado.ordersSkipped += 1;

        // El total calculado por el CRM debería coincidir con el de la tienda.
        // Si no, no se elige en silencio: se avisa para poder mirarlo.
        if (mapped.wooTotalCents !== mapped.totals.total) {
          resultado.warnings.push({
            scope: "order",
            reference: `#${mapped.wooNumber}`,
            message: `La tienda dice ${formatCents(mapped.wooTotalCents)} y de las líneas salen ${formatCents(mapped.totals.total)}.`,
          });
        }
      } catch (error) {
        resultado.warnings.push({
          scope: "order",
          reference: `#${woo.number || woo.id}`,
          message: error instanceof Error ? error.message : "Fallo desconocido",
        });
      }
    }
  }

  return resultado;
}
