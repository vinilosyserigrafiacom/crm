import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadEditorData } from "@/lib/editor-data";
import { toDateInput } from "@/lib/format";
import { DocumentEditor } from "@/components/document-editor";
import { updateOrderAction } from "../../actions";

export const metadata: Metadata = { title: "Editar pedido" };

export default async function EditOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!order) notFound();

  // Un pedido entregado o anulado está cerrado; la acción también lo rechaza.
  if (order.status === "CANCELLED" || order.status === "DELIVERED") {
    redirect(`/pedidos/${order.id}`);
  }

  const { customers, items } = await loadEditorData(order.customerId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">
          {order.number ? `Pedido ${order.number}` : "Borrador de pedido"}
        </h1>
        <p className="page-subtitle">
          Los importes se recalculan al guardar a partir de las líneas.
        </p>
      </div>

      <DocumentEditor
        kind="ORDER"
        action={updateOrderAction.bind(null, order.id)}
        customers={customers}
        items={items}
        cancelHref={`/pedidos/${order.id}`}
        submitLabel="Guardar cambios"
        values={{
          customerId: order.customerId,
          title: order.title,
          customerRef: order.customerRef,
          notes: order.notes,
          internalNotes: order.internalNotes,
          globalDiscountRate: order.globalDiscountRate,
          primaryDate: toDateInput(order.orderDate),
          secondaryDate: toDateInput(order.dueDate),
          terms: null,
          lines: order.lines,
        }}
      />
    </div>
  );
}
