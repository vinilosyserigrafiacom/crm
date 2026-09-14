import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadEditorData } from "@/lib/editor-data";
import { getCompanySettings } from "@/lib/company";
import { peekNextNumber } from "@/lib/numbering";
import { prisma } from "@/lib/prisma";
import { toDateInput } from "@/lib/format";
import { DocumentEditor } from "@/components/document-editor";
import { createQuoteAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo presupuesto" };

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ cliente?: string }>;
}) {
  await requireUser();
  const { cliente } = await searchParams;

  const [{ customers, items }, company] = await Promise.all([
    loadEditorData(cliente),
    getCompanySettings(),
  ]);

  const today = new Date();
  const validUntil = new Date(today.getTime() + company.quoteValidDays * 86_400_000);
  const nextNumber = await peekNextNumber(prisma, "QUOTE", "A", today.getFullYear());

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Nuevo presupuesto</h1>
        <p className="page-subtitle">
          Se guarda como borrador. El número se asigna al enviarlo o aceptarlo.
        </p>
      </div>

      <DocumentEditor
        kind="QUOTE"
        action={createQuoteAction}
        customers={customers}
        items={items}
        numberHint={nextNumber}
        cancelHref="/presupuestos"
        submitLabel="Guardar borrador"
        values={{
          customerId: cliente ?? "",
          title: null,
          customerRef: null,
          notes: null,
          internalNotes: null,
          globalDiscountRate: 0,
          primaryDate: toDateInput(today),
          secondaryDate: toDateInput(validUntil),
          terms: company.quoteTerms,
          lines: [],
        }}
      />
    </div>
  );
}
