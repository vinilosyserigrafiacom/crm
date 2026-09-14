import { prisma } from "@/lib/prisma";
import { getCompanySettings } from "@/lib/company";
import { buildBillingSnapshot, formatAddressLine } from "@/lib/documents";

/**
 * Consultas de servidor que comparten presupuestos y pedidos: cargar el
 * cliente con lo necesario para calcular y construir la copia congelada de los
 * datos de facturación.
 */

/** Datos del cliente que hacen falta para calcular y para el snapshot. */
export async function loadCustomerForDocument(customerId: string) {
  return prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      code: true,
      legalName: true,
      taxId: true,
      taxIdType: true,
      countryCode: true,
      withholdingRate: true,
      addresses: {
        where: { kind: "BILLING" },
        orderBy: { isDefault: "desc" },
        take: 1,
      },
    },
  });
}

export type CustomerForDocument = NonNullable<
  Awaited<ReturnType<typeof loadCustomerForDocument>>
>;

export async function snapshotFor(customer: CustomerForDocument): Promise<string> {
  const company = await getCompanySettings();
  return buildBillingSnapshot(
    {
      legalName: company.legalName,
      taxId: company.taxId,
      addressLine1: company.addressLine1,
      addressLine2: company.addressLine2,
      postalCode: company.postalCode,
      city: company.city,
      province: company.province,
      countryCode: company.countryCode,
      phone: company.phone,
      email: company.email,
      website: company.website,
      iban: company.iban,
    },
    {
      code: customer.code,
      legalName: customer.legalName,
      taxId: customer.taxId,
      taxIdType: customer.taxIdType,
      countryCode: customer.countryCode,
      address: formatAddressLine(customer.addresses[0] ?? null),
    },
  );
}
