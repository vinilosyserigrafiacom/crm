"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseAmountToCents } from "@/lib/money";
import { itemSchema } from "@/lib/validation";
import { bool, int, parseForm, text, type FormState } from "@/lib/form";

/**
 * Crea o modifica un artículo del catálogo.
 *
 * Cambiar un artículo no cambia los documentos ya hechos: las líneas de
 * presupuesto y de pedido guardan su propia copia de la descripción y del
 * precio. El catálogo solo sirve para escribir más rápido.
 */
export async function saveItemAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const itemId = text(formData, "itemId") || null;

  const parsed = parseForm(itemSchema, {
    sku: text(formData, "sku").toUpperCase(),
    name: text(formData, "name"),
    description: text(formData, "description"),
    category: text(formData, "category"),
    kind: text(formData, "kind") || "SERVICE",
    unit: text(formData, "unit") || "ud",
    unitPrice: parseAmountToCents(text(formData, "unitPrice")) ?? 0,
    unitCost: parseAmountToCents(text(formData, "unitCost")) ?? 0,
    vatRate: int(formData, "vatRate", 2100),
    active: bool(formData, "active"),
  });
  if (!parsed.ok) return parsed.state;

  try {
    await prisma.$transaction(async (tx) => {
      const item = itemId
        ? await tx.item.update({ where: { id: itemId }, data: parsed.data })
        : await tx.item.create({ data: parsed.data });

      await recordAudit(tx, {
        userId: user.id,
        entity: "Item",
        entityId: item.id,
        action: itemId ? "UPDATE" : "CREATE",
        summary: `${itemId ? "Modificado" : "Añadido"} el artículo ${item.sku} · ${item.name}`,
        data: { unitPrice: item.unitPrice, vatRate: item.vatRate },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return {
        error: "Ya existe un artículo con esa referencia.",
        errors: { sku: "Referencia repetida" },
      };
    }
    throw error;
  }

  revalidatePath("/catalogo");
  return { message: itemId ? "Artículo actualizado." : "Artículo añadido." };
}

/**
 * Activa o desactiva un artículo.
 *
 * No se borra: puede estar referenciado desde líneas de documentos antiguos, y
 * desactivarlo ya lo saca del desplegable del editor.
 */
export async function toggleItemActiveAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const itemId = text(formData, "itemId");
  if (!itemId) return;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { active: true, sku: true, name: true },
  });
  if (!item) return;

  await prisma.$transaction(async (tx) => {
    await tx.item.update({ where: { id: itemId }, data: { active: !item.active } });
    await recordAudit(tx, {
      userId: user.id,
      entity: "Item",
      entityId: itemId,
      action: "UPDATE",
      summary: `${item.active ? "Desactivado" : "Reactivado"} el artículo ${item.sku} · ${item.name}`,
    });
  });

  revalidatePath("/catalogo");
}
