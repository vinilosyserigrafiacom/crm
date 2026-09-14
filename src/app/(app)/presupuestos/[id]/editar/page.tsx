import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadEditorData } from "@/lib/editor-data";
import { toDateInput } from "@/lib/format";
import { DocumentEditor } from "@/components/document-editor";
import { updateQuoteAction } from "../../actions";

export const metadata: Metadata = { title: "Editar presupuesto" };

export default async function EditQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { lines: { orderBy: { position: "asc" } } },
  });
  if (!quote) notFound();

  // Un presupuesto anulado es un documento cerrado: se puede consultar, no
  // editar. La comprobación también está en la acción, aquí solo se evita
  // enseñar un formulario que no va a poder guardar.
  if (quote.status === "CANCELLED") redirect(`/presupuestos/${quote.id}`);

  const { customers, items } = await loadEditorData(quote.customerId);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">
          {quote.number ? `Presupuesto ${quote.number}` : "Borrador de presupuesto"}
        </h1>
        <p className="page-subtitle">
          Los importes se recalculan al guardar a partir de las líneas.
        </p>
      </div>

      <DocumentEditor
        kind="QUOTE"
        action={updateQuoteAction.bind(null, quote.id)}
        customers={customers}
        items={items}
        cancelHref={`/presupuestos/${quote.id}`}
        submitLabel="Guardar cambios"
        values={{
          customerId: quote.customerId,
          title: quote.title,
          customerRef: quote.customerRef,
          notes: quote.notes,
          internalNotes: quote.internalNotes,
          globalDiscountRate: quote.globalDiscountRate,
          primaryDate: toDateInput(quote.issueDate),
          secondaryDate: toDateInput(quote.validUntil),
          terms: quote.terms,
          lines: quote.lines,
        }}
      />
    </div>
  );
}
