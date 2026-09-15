"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { testWooConnection } from "@/lib/woocommerce";
import { clearSecret, getWooConfig, saveSecret } from "@/lib/integration-config";
import { runWooSync } from "@/lib/woo-sync";
import { parseForm, snapshotValues, text, type FormState } from "@/lib/form";
import { z } from "zod";

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

  const config = await getWooConfig();
  if (!config.ok) {
    return {
      error: "Faltan la dirección de la tienda o las claves. Rellénalas aquí arriba y guarda.",
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

  const config = await getWooConfig();
  if (!config.ok) {
    return {
      error: "Faltan la dirección de la tienda o las claves. Rellénalas aquí arriba y guarda.",
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

const wooCredentialsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1, "La dirección de la tienda es obligatoria")
    .transform((v) => v.replace(/\/+$/, ""))
    .refine((v) => /^https?:\/\//.test(v), "Tiene que empezar por https://"),
  consumerKey: z.string().trim().min(1, "La consumer key es obligatoria"),
  consumerSecret: z.string().trim().min(1, "El consumer secret es obligatorio"),
});

/**
 * Guarda las credenciales de la tienda desde la pantalla.
 *
 * El secreto puede llegar vacío cuando ya había uno guardado: significa
 * «déjalo como estaba». Así se puede corregir la dirección sin tener que volver
 * a WooCommerce a generar una clave nueva, porque el secreto no se enseña.
 */
export async function saveWooCredentialsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const anterior = await getWooConfig();
  const secretoEscrito = text(formData, "consumerSecret").trim();
  const consumerSecret =
    secretoEscrito || (anterior.ok ? anterior.config.consumerSecret : "");

  const parsed = parseForm(
    wooCredentialsSchema,
    {
      baseUrl: text(formData, "baseUrl"),
      consumerKey: text(formData, "consumerKey"),
      consumerSecret,
    },
    formData,
  );
  if (!parsed.ok) return parsed.state;

  try {
    await saveSecret("woocommerce", { ...parsed.data }, user.id, "Credenciales de WooCommerce guardadas");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "No se han podido guardar las credenciales.",
      values: snapshotValues(formData),
    };
  }

  revalidatePath("/ajustes");
  revalidatePath("/ajustes/woocommerce");
  return { message: "Credenciales guardadas. Prueba la conexión para comprobarlas." };
}

/** Borra las credenciales guardadas; vuelve a mandar lo que diga el .env. */
export async function clearWooCredentialsAction(): Promise<void> {
  const user = await requireRole("OWNER", "ADMIN");
  await clearSecret("woocommerce", user.id, "Credenciales de WooCommerce borradas");
  revalidatePath("/ajustes");
  revalidatePath("/ajustes/woocommerce");
}
