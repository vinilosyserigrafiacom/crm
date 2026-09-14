import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getCompanySettings } from "@/lib/company";
import { DocumentSheet } from "@/components/document-sheet";
import { PrintButton, PrintTrigger } from "@/components/print-trigger";
import { formatAddressLine } from "@/lib/documents";
import { companyToSheetParty, quoteToSheet } from "@/lib/sheet";

export const metadata: Metadata = { title: "Imprimir presupuesto" };

export default async function PrintQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const quote = await prisma.quote.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { position: "asc" } },
      customer: {
        select: {
          code: true,
          legalName: true,
          taxId: true,
          addresses: {
            where: { kind: "BILLING" },
            orderBy: { isDefault: "desc" },
            take: 1,
          },
        },
      },
    },
  });
  if (!quote) notFound();

  const company = await getCompanySettings();

  return (
    <div className="space-y-4">
      <PrintTrigger />

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Usa «Guardar como PDF» en el diálogo de impresión para enviarlo por correo.
        </p>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link href={`/presupuestos/${quote.id}`} className="btn-ghost">
            Volver
          </Link>
        </div>
      </div>

      <DocumentSheet
        document={quoteToSheet(quote)}
        company={companyToSheetParty(company)}
        customer={{
          legalName: quote.customer.legalName,
          taxId: quote.customer.taxId,
          address: formatAddressLine(quote.customer.addresses[0] ?? null),
          code: quote.customer.code,
        }}
      />
    </div>
  );
}
