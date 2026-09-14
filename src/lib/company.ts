import { prisma } from "@/lib/prisma";

/**
 * Datos del emisor. Se guardan en una fila única con id "default"; si no
 * existe todavía se crea con los valores por defecto, así que la aplicación
 * funciona recién instalada sin pasar antes por Ajustes.
 */
export async function getCompanySettings() {
  return prisma.companySettings.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}
