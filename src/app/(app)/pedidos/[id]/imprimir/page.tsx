import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getCompanySettings } from "@/lib/company";
import { DocumentSheet } from "@/components/document-sheet";
import { PrintButton, PrintTrigger } from "@/components/print-trigger";
import { formatAddressLine } from "@/lib/documents";
import { companyToSheetParty, orderToSheet } from "@/lib/sheet";

export const metadata: Metadata = { title: "Imprimir pedido" };

export default async function PrintOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const order = await prisma.order.findUnique({
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
  if (!order) notFound();

  const company = await getCompanySettings();

  return (
    <div className="space-y-4">
      <PrintTrigger />

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Sirve como confirmación para el cliente y como hoja de trabajo para el taller.
        </p>
        <div className="flex items-center gap-2">
          <PrintButton />
          <Link href={`/pedidos/${order.id}`} className="btn-ghost">
            Volver
          </Link>
        </div>
      </div>

      <DocumentSheet
        document={orderToSheet(order)}
        company={companyToSheetParty(company)}
        customer={{
          legalName: order.customer.legalName,
          taxId: order.customer.taxId,
          address: formatAddressLine(order.customer.addresses[0] ?? null),
          code: order.customer.code,
        }}
      />
    </div>
  );
}
