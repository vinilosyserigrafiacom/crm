import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { loadEditorData } from "@/lib/editor-data";
import { peekNextNumber } from "@/lib/numbering";
import { toDateInput } from "@/lib/format";
import { DocumentEditor } from "@/components/document-editor";
import { createOrderAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo pedido" };

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  await requireUser();
  const { cliente } = await searchParams;

  const { customers, items } = await loadEditorData(cliente);
  const today = new Date();
  const nextNumber = await peekNextNumber(prisma, "ORDER", "A", today.getFullYear());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Nuevo pedido</h1>
        <p className="page-subtitle">
          Para un trabajo sin presupuesto previo. Si hay presupuesto, es mejor convertirlo desde
          su ficha para no teclear las líneas dos veces.
        </p>
      </div>

      <DocumentEditor
        kind="ORDER"
        action={createOrderAction}
        customers={customers}
        items={items}
        numberHint={nextNumber}
        cancelHref="/pedidos"
        submitLabel="Guardar borrador"
        values={{
          customerId: cliente ?? "",
          title: null,
          customerRef: null,
          notes: null,
          internalNotes: null,
          globalDiscountRate: 0,
          primaryDate: toDateInput(today),
          secondaryDate: "",
          terms: null,
          lines: [],
        }}
      />
    </div>
  );
}
