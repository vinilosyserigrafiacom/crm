"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { readWooConfig, testWooConnection } from "@/lib/woocommerce";
import { runWooSync } from "@/lib/woo-sync";
import type { FormState } from "@/lib/form";

/**
 * Acciones de la integración con la tienda.
 *
 * Exigen cuenta de administración, no solo sesión: una importación toca todas
 * las fichas de cliente y es de las pocas cosas de la aplicación que no tiene
 * vuelta atrás con un botón.
 */

/** Comprueba que las credenciales funcionan, sin importar nada. */
export async function testConnectionAction(): Promise<FormState> {
  await requireRole("OWNER", "ADMIN");

  const config = readWooConfig();
  if (!config.ok) {
    return {
      error: `Falta configurar ${config.missing.join(", ")} en el fichero .env del servidor.`,
    };
  }

  const resultado = await testWooConnection(config.config);
  if (!resultado.ok) return { error: resultado.error };

  return {
    message: `Conexión correcta. La tienda tiene ${resultado.orders} pedidos.`,
  };
}

/**
 * Trae de la tienda lo que haya cambiado.
 *
 * Por defecto solo pide lo modificado desde la última sincronización correcta.
 * `completa` fuerza a traerlo todo, que es lo que hace falta la primera vez y
 * cuando se sospecha que algo se quedó por el camino.
 */
export async function syncNowAction(completa: boolean): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const config = readWooConfig();
  if (!config.ok) {
    return {
      error: `Falta configurar ${config.missing.join(", ")} en el fichero .env del servidor.`,
    };
  }

  // Si ya hay una sincronización en marcha no se lanza otra: dos a la vez
  // pelearían por las mismas fichas sin ganar nada.
  const enMarcha = await prisma.wooSyncRun.findFirst({
    where: { status: "RUNNING" },
    select: { id: true, startedAt: true },
  });
  if (enMarcha) {
    // Una ejecución que lleve más de media hora en marcha es una que se quedó
    // colgada, no una que siga trabajando: se da por fallida y se sigue.
    const colgada = Date.now() - enMarcha.startedAt.getTime() > 30 * 60 * 1000;
    if (!colgada) return { error: "Ya hay una sincronización en marcha." };
    await prisma.wooSyncRun.update({
      where: { id: enMarcha.id },
      data: {
        status: "ERROR",
        finishedAt: new Date(),
        error: "Se quedó a medias: la marcó como fallida una ejecución posterior.",
      },
    });
  }

  const ultimaCorrecta = completa
    ? null
    : await prisma.wooSyncRun.findFirst({
        where: { status: "OK" },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      });

  // Se resta un margen a la fecha de corte: entre que la tienda marca un pedido
  // como modificado y nosotros lo leemos pasan segundos, y sin holgura un
  // cambio justo en el límite se quedaría sin traer para siempre.
  const since = ultimaCorrecta ? new Date(ultimaCorrecta.startedAt.getTime() - 5 * 60_000) : null;

  const run = await prisma.wooSyncRun.create({
    data: { since, triggeredById: user.id },
  });

  try {
    const resultado = await runWooSync({ config: config.config, since, userId: user.id });

    await prisma.wooSyncRun.update({
      where: { id: run.id },
      data: {
        status: "OK",
        finishedAt: new Date(),
        customersCreated: resultado.customersCreated,
        customersUpdated: resultado.customersUpdated,
        ordersCreated: resultado.ordersCreated,
        ordersUpdated: resultado.ordersUpdated,
        ordersSkipped: resultado.ordersSkipped,
        warnings: JSON.stringify(resultado.warnings),
      },
    });

    await recordAudit(prisma, {
      userId: user.id,
      entity: "WooSyncRun",
      entityId: run.id,
      action: "UPDATE",
      summary:
        `Sincronización con la tienda: ${resultado.customersCreated} clientes nuevos, ` +
        `${resultado.ordersCreated} pedidos nuevos, ${resultado.ordersUpdated} actualizados`,
      data: resultado,
    });

    revalidatePath("/ajustes/woocommerce");
    revalidatePath("/clientes");
    revalidatePath("/pedidos");
    revalidatePath("/taller");

    const partes = [
      `${resultado.customersCreated} clientes nuevos`,
      `${resultado.customersUpdated} actualizados`,
      `${resultado.ordersCreated} pedidos nuevos`,
      `${resultado.ordersUpdated} actualizados`,
    ];
    if (resultado.ordersSkipped > 0) {
      partes.push(`${resultado.ordersSkipped} con el estado respetado del taller`);
    }
    return { message: `Listo: ${partes.join(", ")}.` };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "Fallo desconocido";
    await prisma.wooSyncRun.update({
      where: { id: run.id },
      data: { status: "ERROR", finishedAt: new Date(), error: mensaje },
    });
    revalidatePath("/ajustes/woocommerce");
    return { error: mensaje };
  }
}
