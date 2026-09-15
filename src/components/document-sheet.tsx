import { formatCents, formatQuantity, formatRate, parseVatBreakdown } from "@/lib/money";
import { documentNumber, formatDate } from "@/lib/format";
import { parseBillingSnapshot } from "@/lib/documents";

/**
 * Hoja del documento: lo que ve el cliente, tanto en pantalla como al
 * imprimir. Se usa igual para presupuestos y para pedidos.
 *
 * Los datos del emisor y del cliente se leen de la copia congelada
 * (billingSnapshot) cuando existe. Solo si el documento aún es un borrador sin
 * copia se usan los datos actuales: un documento ya emitido tiene que seguir
 * mostrando lo que se emitió.
 */

export interface SheetLine {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
  netAmount: number;
  notes: string | null;
}

export interface SheetDocument {
  kind: "QUOTE" | "ORDER";
  number: string | null;
  wooNumber?: string | null;
  title: string | null;
  customerRef: string | null;
  notes: string | null;
  terms: string | null;
  primaryDate: Date;
  secondaryDate: Date | null;
  billingSnapshot: string | null;
  linesSubtotal: number;
  discountTotal: number;
  globalDiscountRate: number;
  taxableBase: number;
  vatTotal: number;
  withholdingTotal: number;
  total: number;
  vatBreakdown: string;
  lines: SheetLine[];
}

export interface SheetParty {
  legalName: string;
  taxId: string | null;
  address: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  iban?: string | null;
  code?: string | null;
}

export function DocumentSheet({
  document,
  company,
  customer,
}: {
  document: SheetDocument;
  /** Datos actuales del emisor, usados solo si no hay copia congelada. */
  company: SheetParty;
  /** Datos actuales del cliente, usados solo si no hay copia congelada. */
  customer: SheetParty;
}) {
  const snapshot = parseBillingSnapshot(document.billingSnapshot);
  const isQuote = document.kind === "QUOTE";

  const emitter: SheetParty = snapshot?.company
    ? {
        legalName: snapshot.company.legalName ?? company.legalName,
        taxId: snapshot.company.taxId ?? company.taxId,
        address:
          [
            snapshot.company.addressLine1,
            snapshot.company.addressLine2,
            [snapshot.company.postalCode, snapshot.company.city].filter(Boolean).join(" "),
            snapshot.company.province,
          ]
            .filter((part) => part && String(part).trim() !== "")
            .join(", ") || company.address,
        phone: snapshot.company.phone ?? company.phone,
        email: snapshot.company.email ?? company.email,
        website: snapshot.company.website ?? company.website,
        iban: snapshot.company.iban ?? company.iban,
      }
    : company;

  const receiver: SheetParty = snapshot?.customer
    ? {
        legalName: snapshot.customer.legalName ?? customer.legalName,
        taxId: snapshot.customer.taxId ?? customer.taxId,
        address: snapshot.customer.address ?? customer.address,
        code: snapshot.customer.code ?? customer.code,
      }
    : customer;

  const breakdown = parseVatBreakdown(document.vatBreakdown).filter((entry) => entry.base !== 0);
  const hasLineDiscounts = document.lines.some((line) => line.discountRate > 0);

  return (
    <article className="print-sheet card mx-auto max-w-3xl p-6 sm:p-10">
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
        <div>
          <p className="text-base font-semibold text-slate-900">{emitter.legalName}</p>
          {emitter.taxId && <p className="text-xs text-slate-600">NIF {emitter.taxId}</p>}
          {emitter.address && <p className="text-xs text-slate-600">{emitter.address}</p>}
          <p className="text-xs text-slate-600">
            {[emitter.phone, emitter.email].filter(Boolean).join(" · ")}
          </p>
          {emitter.website && <p className="text-xs text-slate-600">{emitter.website}</p>}
        </div>

        <div className="text-right">
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
            {isQuote ? "Presupuesto" : "Pedido"}
          </p>
          <p className="font-mono text-lg font-semibold text-slate-900">
            {documentNumber(document)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            {isQuote ? "Fecha" : "Fecha del pedido"}: {formatDate(document.primaryDate)}
          </p>
          {document.secondaryDate && (
            <p className="text-xs text-slate-600">
              {isQuote ? "Válido hasta" : "Entrega"}: {formatDate(document.secondaryDate)}
            </p>
          )}
        </div>
      </header>

      <section className="grid gap-6 border-b border-slate-200 py-6 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Cliente</p>
          <p className="mt-1 text-sm font-medium text-slate-900">{receiver.legalName}</p>
          {receiver.taxId && <p className="text-xs text-slate-600">NIF {receiver.taxId}</p>}
          {receiver.address && <p className="text-xs text-slate-600">{receiver.address}</p>}
        </div>
        <div className="sm:text-right">
          {document.title && (
            <>
              <p className="text-xs font-semibold tracking-wider text-slate-500 uppercase">
                Trabajo
              </p>
              <p className="mt-1 text-sm text-slate-900">{document.title}</p>
            </>
          )}
          {document.customerRef && (
            <p className="mt-2 text-xs text-slate-600">Su referencia: {document.customerRef}</p>
          )}
        </div>
      </section>

      <div className="table-wrap py-6">
        <table className="table">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="num">Cant.</th>
              <th>Ud.</th>
              <th className="num">Precio</th>
              {hasLineDiscounts && <th className="num">Dto.</th>}
              <th className="num">IVA</th>
              <th className="num">Importe</th>
            </tr>
          </thead>
          <tbody>
            {document.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <span className="whitespace-pre-wrap">{line.description}</span>
                  {line.notes && (
                    <span className="block text-xs text-slate-500">{line.notes}</span>
                  )}
                </td>
                <td className="num">{formatQuantity(line.quantity)}</td>
                <td className="text-xs">{line.unit}</td>
                <td className="num">{formatCents(line.unitPrice)}</td>
                {hasLineDiscounts && (
                  <td className="num text-xs">
                    {line.discountRate > 0 ? formatRate(line.discountRate) : "—"}
                  </td>
                )}
                <td className="num text-xs">{formatRate(line.vatRate)}</td>
                <td className="num font-medium">{formatCents(line.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end border-t border-slate-200 pt-6">
        <dl className="w-full max-w-xs space-y-1.5 text-sm">
          {/* Sin descuento, suma de líneas y base imponible coinciden: se
              imprime solo la base. */}
          {document.discountTotal > 0 && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">Suma de líneas</dt>
                <dd className="tabular-nums">{formatCents(document.linesSubtotal)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-slate-600">
                  Descuento {formatRate(document.globalDiscountRate)}
                </dt>
                <dd className="tabular-nums">−{formatCents(document.discountTotal)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between gap-4">
            <dt className="text-slate-600">Base imponible</dt>
            <dd className="tabular-nums">{formatCents(document.taxableBase)}</dd>
          </div>
          {breakdown.map((entry) => (
            <div key={entry.rate} className="flex justify-between gap-4">
              <dt className="text-slate-600">
                IVA {formatRate(entry.rate)} s/ {formatCents(entry.base)}
              </dt>
              <dd className="tabular-nums">{formatCents(entry.vat)}</dd>
            </div>
          ))}
          {document.withholdingTotal > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-600">Retención IRPF</dt>
              <dd className="tabular-nums">−{formatCents(document.withholdingTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-slate-300 pt-1.5 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatCents(document.total)}</dd>
          </div>
        </dl>
      </div>

      {(document.notes || document.terms || emitter.iban) && (
        <footer className="mt-6 space-y-3 border-t border-slate-200 pt-6 text-xs text-slate-600">
          {document.notes && <p className="whitespace-pre-wrap">{document.notes}</p>}
          {document.terms && (
            <div>
              <p className="font-semibold text-slate-700">Condiciones</p>
              <p className="whitespace-pre-wrap">{document.terms}</p>
            </div>
          )}
          {emitter.iban && (
            <p>
              <span className="font-semibold text-slate-700">Pago por transferencia:</span>{" "}
              <span className="font-mono">{emitter.iban}</span>
            </p>
          )}
        </footer>
      )}
    </article>
  );
}
