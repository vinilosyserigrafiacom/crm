import { prisma } from "@/lib/prisma";
import type { CustomerOption, ItemOption } from "@/components/document-editor";

/**
 * Opciones que necesita el editor de documentos.
 *
 * Solo se ofrecen clientes y artículos activos: un cliente archivado no debería
 * aparecer al crear un presupuesto nuevo. Si un documento ya existente apunta a
 * uno archivado, se añade a la lista para no perderlo al editarlo.
 */
export async function loadEditorData(includeCustomerId?: string | null): Promise<{
  customers: CustomerOption[];
  items: ItemOption[];
}> {
  const [customers, items] = await Promise.all([
    prisma.customer.findMany({
      where: includeCustomerId
        ? { OR: [{ active: true }, { id: includeCustomerId }] }
        : { active: true },
      orderBy: { legalName: "asc" },
      select: {
        id: true,
        code: true,
        legalName: true,
        defaultVatRate: true,
        withholdingRate: true,
        vatExempt: true,
      },
    }),
    prisma.item.findMany({
      where: { active: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        unit: true,
        unitPrice: true,
        vatRate: true,
        category: true,
      },
    }),
  ]);

  return { customers, items };
}
