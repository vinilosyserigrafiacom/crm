import type { Prisma } from "@prisma/client";
import type { DocType } from "@/lib/validation";

/**
 * Numeración correlativa de documentos.
 *
 * El número se reserva en el momento de EMITIR el documento, nunca al crear el
 * borrador: si se numerase el borrador, cada borrador descartado dejaría un
 * hueco en la serie.
 *
 * Verifactu exige que la numeración de facturas sea correlativa y sin huecos.
 * Reservar el número dentro de la misma transacción que emite el documento da
 * esa garantía: si la emisión falla, el contador vuelve atrás con ella.
 */

const PREFIXES: Record<DocType, string> = {
  QUOTE: "PRE",
  ORDER: "PED",
  INVOICE: "FAC",
};

export interface ReservedNumber {
  /** Referencia completa: PRE-A-2026-0001. */
  number: string;
  /** Número secuencial sin formatear, por si hace falta ordenar por él. */
  sequence: number;
}

/**
 * Reserva el siguiente número de una serie y ejercicio.
 *
 * Debe llamarse SIEMPRE dentro de una transacción (`prisma.$transaction`), con
 * el cliente de transacción como primer argumento.
 */
export async function reserveDocumentNumber(
  tx: Prisma.TransactionClient,
  docType: DocType,
  series: string,
  year: number,
): Promise<ReservedNumber> {
  // El upsert devuelve el contador ya incrementado, así que el número que nos
  // toca es el anterior: al crear la secuencia dejamos next en 2 y tomamos
  // el 1; al incrementarla, tomamos el valor previo.
  const sequence = await tx.numberSequence.upsert({
    where: { docType_series_year: { docType, series, year } },
    create: { docType, series, year, next: 2 },
    update: { next: { increment: 1 } },
    select: { next: true, padding: true },
  });

  const taken = sequence.next - 1;
  const padded = String(taken).padStart(sequence.padding, "0");

  return {
    number: `${PREFIXES[docType]}-${series}-${year}-${padded}`,
    sequence: taken,
  };
}

/**
 * Reserva el siguiente código de cliente: C-0001.
 *
 * Usa el mismo contador que los documentos para no tener dos mecanismos de
 * numeración distintos, con la clave docType "CUSTOMER" y año 0, porque los
 * códigos de cliente no se reinician cada ejercicio.
 */
export async function reserveCustomerCode(tx: Prisma.TransactionClient): Promise<string> {
  const sequence = await tx.numberSequence.upsert({
    where: { docType_series_year: { docType: "CUSTOMER", series: "C", year: 0 } },
    create: { docType: "CUSTOMER", series: "C", year: 0, next: 2 },
    update: { next: { increment: 1 } },
    select: { next: true, padding: true },
  });
  const taken = sequence.next - 1;
  return `C-${String(taken).padStart(sequence.padding, "0")}`;
}

/** Siguiente número que se asignaría, sin reservarlo. Solo para mostrarlo. */
export async function peekNextNumber(
  db: { numberSequence: Prisma.NumberSequenceDelegate },
  docType: DocType,
  series: string,
  year: number,
): Promise<string> {
  const sequence = await db.numberSequence.findUnique({
    where: { docType_series_year: { docType, series, year } },
    select: { next: true, padding: true },
  });
  const next = sequence?.next ?? 1;
  const padding = sequence?.padding ?? 4;
  return `${PREFIXES[docType]}-${series}-${year}-${String(next).padStart(padding, "0")}`;
}
