/**
 * Colocación de tarjetas en el tablero de taller.
 *
 * Las posiciones se reescriben de 10 en 10 en toda la columna afectada cada vez
 * que se suelta una tarjeta. Es más escritura de la mínima necesaria, pero una
 * columna del taller tiene decenas de tarjetas, no miles, y a cambio la
 * numeración no se degrada nunca: no hay que arreglar empates ni quedarse sin
 * hueco entre dos posiciones consecutivas.
 */

/** Separación entre tarjetas consecutivas. */
export const BOARD_STEP = 10;

/**
 * Nuevo orden de una columna tras mover una tarjeta dentro de ella o traerla
 * de otra.
 *
 * @param ids      Ids de la columna destino, en su orden actual.
 * @param movedId  Tarjeta que se suelta.
 * @param beforeId Tarjeta ante la que se suelta; null para dejarla al final.
 */
export function reorder(ids: string[], movedId: string, beforeId: string | null): string[] {
  const resto = ids.filter((id) => id !== movedId);

  if (beforeId === null || beforeId === movedId) {
    return [...resto, movedId];
  }

  const destino = resto.indexOf(beforeId);
  // Si la referencia ya no está en la columna (otra persona la ha movido
  // mientras tanto), la tarjeta va al final en lugar de fallar.
  if (destino === -1) return [...resto, movedId];

  return [...resto.slice(0, destino), movedId, ...resto.slice(destino)];
}

/** Posición que le toca a cada tarjeta según su orden en la columna. */
export function positionsFor(ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, (index + 1) * BOARD_STEP]));
}
