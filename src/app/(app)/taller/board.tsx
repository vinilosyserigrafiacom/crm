"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { describeDueDate, documentNumber, formatDate, truncate } from "@/lib/format";
import {
  BOARD_COLUMNS,
  ORDER_STATUS_LABELS,
  ORDER_TRANSITIONS,
  type OrderStatus,
} from "@/lib/validation";
import { moveCardAction, type CardActionResult } from "./actions";
import { NewCardPanel, type CardCustomer } from "./new-card";

export interface BoardCard {
  id: string;
  number: string | null;
  wooNumber: string | null;
  title: string | null;
  customerId: string;
  customerName: string;
  status: string;
  dueDate: Date | null;
  total: number;
}

/**
 * Tablero de taller.
 *
 * El arrastre usa la API nativa del navegador, sin librería: son cuatro
 * manejadores y evita meter 40 kB de dependencia en una pantalla. A cambio no
 * funciona con el dedo, así que cada tarjeta lleva además un menú «Mover a»
 * con las columnas a las que puede ir. En el taller se usa el móvil, de modo
 * que esa vía no es un añadido de cortesía: es la principal para media casa.
 */

const COLUMN_TONE: Record<OrderStatus, string> = {
  DRAFT: "border-slate-300",
  CONFIRMED: "border-ink-400",
  IN_PRODUCTION: "border-violet-400",
  READY: "border-amber-400",
  DELIVERED: "border-emerald-400",
  CANCELLED: "border-slate-300",
};

function Card({
  card,
  destinos,
  arrastrando,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onMover,
  pendiente,
}: {
  card: BoardCard;
  destinos: OrderStatus[];
  arrastrando: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
  onMover: (destino: OrderStatus) => void;
  pendiente: boolean;
}) {
  const [encima, setEncima] = useState(false);
  const retrasado =
    card.dueDate !== null &&
    card.status !== "DELIVERED" &&
    new Date(card.dueDate).setHours(23, 59, 59) < Date.now();

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Firefox no inicia el arrastre si no se escribe algo en dataTransfer.
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        e.preventDefault();
        setEncima(true);
      }}
      onDragLeave={() => setEncima(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setEncima(false);
        onDropBefore();
      }}
      className={`${encima ? "border-t-2 border-t-ink-500 pt-1.5" : ""} ${
        arrastrando ? "opacity-40" : ""
      } ${pendiente ? "animate-pulse" : ""}`}
    >
      <article className="card cursor-grab p-3 active:cursor-grabbing">
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/pedidos/${card.id}`}
            className="font-mono text-xs font-medium text-ink-700 hover:underline"
          >
            {documentNumber(card)}
          </Link>
          <span className="text-xs font-medium tabular-nums text-slate-600">
            {formatCents(card.total)}
          </span>
        </div>

        {card.title && (
          <p className="mt-1 text-sm leading-snug text-slate-900">
            {truncate(card.title, 60)}
          </p>
        )}
        <p className="mt-0.5 text-xs text-slate-500">{truncate(card.customerName, 30)}</p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {card.dueDate ? (
            <span className={retrasado ? "pill-red" : "pill-slate"}>
              {retrasado ? "Retrasado · " : ""}
              {formatDate(card.dueDate)}
            </span>
          ) : (
            <span className="pill-amber">Sin fecha</span>
          )}
          {card.dueDate && !retrasado && (
            <span className="text-xs text-slate-400">{describeDueDate(card.dueDate)}</span>
          )}
        </div>

        {destinos.length > 0 && (
          <label className="mt-2 block">
            <span className="sr-only">Mover {documentNumber(card)} a otra columna</span>
            <select
              className="input py-1 text-xs"
              value=""
              disabled={pendiente}
              onChange={(e) => {
                if (e.target.value) onMover(e.target.value as OrderStatus);
              }}
            >
              <option value="">Mover a…</option>
              {destinos.map((destino) => (
                <option key={destino} value={destino}>
                  {ORDER_STATUS_LABELS[destino]}
                </option>
              ))}
            </select>
          </label>
        )}
      </article>
    </li>
  );
}

export function Board({
  cards: initialCards,
  customers,
}: {
  cards: BoardCard[];
  /** Para el alta rápida; solo clientes activos. */
  customers: CardCustomer[];
}) {
  const [cards, setCards] = useState(initialCards);
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [columnaActiva, setColumnaActiva] = useState<OrderStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Cuando el servidor devuelve datos nuevos tras revalidar, mandan los suyos.
  useEffect(() => setCards(initialCards), [initialCards]);

  const enviar = (orderId: string, toStatus: OrderStatus, beforeId: string | null) => {
    const anteriores = cards;
    setError(null);
    setPendiente(orderId);

    // Movimiento optimista: la tarjeta salta ya, y si el servidor lo rechaza se
    // devuelve a su sitio con el motivo. Esperar a la respuesta para pintar
    // haría que arrastrar se sintiera roto.
    setCards((actuales) => {
      const movida = actuales.find((c) => c.id === orderId);
      if (!movida) return actuales;
      const resto = actuales.filter((c) => c.id !== orderId);
      const actualizada = { ...movida, status: toStatus };
      if (beforeId === null) return [...resto, actualizada];
      const indice = resto.findIndex((c) => c.id === beforeId);
      if (indice === -1) return [...resto, actualizada];
      return [...resto.slice(0, indice), actualizada, ...resto.slice(indice)];
    });

    startTransition(async () => {
      const resultado: CardActionResult = await moveCardAction({ orderId, toStatus, beforeId });
      setPendiente(null);
      if (!resultado.ok) {
        setCards(anteriores);
        setError(resultado.error ?? "No se ha podido mover la tarjeta.");
      }
    });
  };

  return (
    <div className="space-y-3">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {BOARD_COLUMNS.map((columna) => {
          const deLaColumna = cards.filter((c) => c.status === columna);
          const importe = deLaColumna.reduce((suma, c) => suma + c.total, 0);
          const activa = columnaActiva === columna;

          return (
            <section
              key={columna}
              onDragOver={(e) => {
                e.preventDefault();
                setColumnaActiva(columna);
              }}
              onDragLeave={() => setColumnaActiva((c) => (c === columna ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setColumnaActiva(null);
                if (arrastrada) enviar(arrastrada, columna, null);
                setArrastrada(null);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-xl border-t-4 bg-slate-100/70 ${
                COLUMN_TONE[columna]
              } ${activa ? "ring-2 ring-ink-400 ring-inset" : ""}`}
            >
              <header className="flex items-baseline justify-between gap-2 px-3 py-2.5">
                <h2 className="text-sm font-semibold text-slate-900">
                  {ORDER_STATUS_LABELS[columna]}
                </h2>
                <span className="text-xs tabular-nums text-slate-500">
                  {deLaColumna.length}
                  {importe > 0 && ` · ${formatCents(importe)}`}
                </span>
              </header>

              {columna === "DRAFT" && (
                <div className="px-2 pb-2">
                  <NewCardPanel
                    customers={customers}
                    label="+ Nueva tarjeta"
                    className="btn-secondary btn-sm w-full"
                  />
                </div>
              )}

              <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-3">
                {deLaColumna.length === 0 && (
                  <li className="rounded-lg border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
                    Suelta aquí una tarjeta
                  </li>
                )}
                {deLaColumna.map((card) => (
                  <Card
                    key={card.id}
                    card={card}
                    destinos={ORDER_TRANSITIONS[columna] ?? []}
                    arrastrando={arrastrada === card.id}
                    pendiente={pendiente === card.id}
                    onDragStart={() => setArrastrada(card.id)}
                    onDragEnd={() => setArrastrada(null)}
                    onDropBefore={() => {
                      setColumnaActiva(null);
                      if (arrastrada && arrastrada !== card.id) {
                        enviar(arrastrada, columna, card.id);
                      }
                      setArrastrada(null);
                    }}
                    onMover={(destino) => enviar(card.id, destino, null)}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
