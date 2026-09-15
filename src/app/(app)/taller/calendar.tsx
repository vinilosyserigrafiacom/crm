"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { formatCents } from "@/lib/money";
import { documentNumber, formatDate, toDateInput, truncate } from "@/lib/format";
import { ORDER_STATUS_LABELS, type OrderStatus } from "@/lib/validation";
import { setDueDateAction, type CardActionResult } from "./actions";
import { NewCardForm, type CardCustomer } from "./new-card";
import type { BoardCard } from "./board";

/**
 * Calendario de entregas.
 *
 * La semana empieza en lunes, como aquí. Arrastrar una tarjeta a otro día
 * cambia su fecha de entrega comprometida; soltarla en la bandeja de abajo se
 * la quita. Los pedidos entregados y los anulados no se pueden mover: su fecha
 * ya es historia.
 */

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

const ESTADO_TONO: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 ring-slate-200",
  CONFIRMED: "bg-ink-50 text-ink-700 ring-ink-200",
  IN_PRODUCTION: "bg-violet-50 text-violet-700 ring-violet-200",
  READY: "bg-amber-50 text-amber-800 ring-amber-200",
  DELIVERED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

/** Los 42 días que se pintan: el mes completo más el relleno de las semanas. */
function diasDelMes(mes: Date): Date[] {
  const primero = new Date(mes.getFullYear(), mes.getMonth(), 1);
  // getDay() devuelve 0 para domingo; aquí la semana empieza en lunes.
  const desplazamiento = (primero.getDay() + 6) % 7;
  const inicio = new Date(primero);
  inicio.setDate(1 - desplazamiento);

  return Array.from({ length: 42 }, (_, i) => {
    const dia = new Date(inicio);
    dia.setDate(inicio.getDate() + i);
    return dia;
  });
}

function Chip({
  card,
  movible,
  onDragStart,
  pendiente,
}: {
  card: BoardCard;
  movible: boolean;
  onDragStart: () => void;
  pendiente: boolean;
}) {
  return (
    <Link
      href={`/pedidos/${card.id}`}
      draggable={movible}
      onDragStart={(e) => {
        if (!movible) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      title={`${documentNumber(card)} · ${card.customerName} · ${formatCents(card.total)}`}
      className={`block truncate rounded px-1.5 py-1 text-xs ring-1 ring-inset ${
        ESTADO_TONO[card.status] ?? ESTADO_TONO.DRAFT
      } ${movible ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
        pendiente ? "animate-pulse" : ""
      }`}
    >
      <span className="font-medium">{documentNumber(card)}</span>{" "}
      <span className="opacity-80">{truncate(card.title ?? card.customerName, 22)}</span>
    </Link>
  );
}

export function Calendar({
  cards,
  unscheduled,
  customers,
  month,
  prevHref,
  nextHref,
  todayHref,
  monthLabel,
}: {
  /** Pedidos con fecha de entrega dentro del mes que se muestra. */
  cards: BoardCard[];
  /** Pedidos abiertos sin fecha de entrega. */
  unscheduled: BoardCard[];
  /** Para el alta rápida; solo clientes activos. */
  customers: CardCustomer[];
  month: Date;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  monthLabel: string;
}) {
  const [locales, setLocales] = useState(cards);
  const [sinFecha, setSinFecha] = useState(unscheduled);
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [diaActivo, setDiaActivo] = useState<string | null>(null);
  const [bandejaActiva, setBandejaActiva] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState<string | null>(null);
  /** Día para el que se está dando de alta una tarjeta, en yyyy-mm-dd. */
  const [altaEn, setAltaEn] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => setLocales(cards), [cards]);
  useEffect(() => setSinFecha(unscheduled), [unscheduled]);

  const hoy = toDateInput(new Date());
  const mesActual = month.getMonth();

  const mover = (orderId: string, date: string | null) => {
    const antesConFecha = locales;
    const antesSinFecha = sinFecha;
    setError(null);
    setPendiente(orderId);

    const tarjeta =
      locales.find((c) => c.id === orderId) ?? sinFecha.find((c) => c.id === orderId);
    if (!tarjeta) return;

    // Movimiento optimista, igual que en el tablero.
    const actualizada: BoardCard = {
      ...tarjeta,
      dueDate: date === null ? null : new Date(`${date}T12:00:00`),
    };
    setLocales((c) => c.filter((x) => x.id !== orderId).concat(date === null ? [] : [actualizada]));
    setSinFecha((c) => c.filter((x) => x.id !== orderId).concat(date === null ? [actualizada] : []));

    startTransition(async () => {
      const resultado: CardActionResult = await setDueDateAction({ orderId, date });
      setPendiente(null);
      if (!resultado.ok) {
        setLocales(antesConFecha);
        setSinFecha(antesSinFecha);
        setError(resultado.error ?? "No se ha podido cambiar la fecha.");
      }
    });
  };

  const esMovible = (card: BoardCard) =>
    card.status !== "DELIVERED" && card.status !== "CANCELLED";

  const porDia = new Map<string, BoardCard[]>();
  for (const card of locales) {
    if (!card.dueDate) continue;
    const clave = toDateInput(card.dueDate);
    porDia.set(clave, [...(porDia.get(clave) ?? []), card]);
  }

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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900 first-letter:uppercase">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <Link href={prevHref} className="btn-secondary btn-sm" aria-label="Mes anterior">
            ←
          </Link>
          <Link href={todayHref} className="btn-secondary btn-sm">
            Hoy
          </Link>
          <Link href={nextHref} className="btn-secondary btn-sm" aria-label="Mes siguiente">
            →
          </Link>
        </div>
      </div>

      {altaEn && (
        <div className="card card-body">
          <p className="mb-2 text-sm font-medium text-slate-900">
            Nueva tarjeta con entrega el {formatDate(new Date(`${altaEn}T12:00:00`))}
          </p>
          <div className="max-w-sm">
            <NewCardForm
              customers={customers}
              defaultDate={altaEn}
              onClose={() => setAltaEn(null)}
            />
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {DIAS.map((dia) => (
            <div
              key={dia}
              className="px-2 py-1.5 text-center text-xs font-semibold tracking-wide text-slate-500 uppercase"
            >
              {dia}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {diasDelMes(month).map((dia) => {
            const clave = toDateInput(dia);
            const delDia = porDia.get(clave) ?? [];
            const esDeOtroMes = dia.getMonth() !== mesActual;
            const esHoy = clave === hoy;
            const activo = diaActivo === clave;

            return (
              <div
                key={clave}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDiaActivo(clave);
                }}
                onDragLeave={() => setDiaActivo((d) => (d === clave ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDiaActivo(null);
                  if (arrastrada) mover(arrastrada, clave);
                  setArrastrada(null);
                }}
                className={`min-h-24 border-r border-b border-slate-100 p-1.5 ${
                  esDeOtroMes ? "bg-slate-50/60" : ""
                } ${activo ? "bg-ink-50 ring-2 ring-ink-400 ring-inset" : ""}`}
              >
                <div className="mb-1 flex items-center justify-between">
                  <span
                    className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-xs tabular-nums ${
                      esHoy
                        ? "bg-ink-600 font-semibold text-white"
                        : esDeOtroMes
                          ? "text-slate-300"
                          : "text-slate-500"
                    }`}
                  >
                    {dia.getDate()}
                  </span>
                  <span className="flex items-center gap-1">
                    {delDia.length > 2 && (
                      <span className="text-[10px] text-slate-400">{delDia.length}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => setAltaEn(clave)}
                      aria-label={`Nueva tarjeta para el ${clave}`}
                      title="Nueva tarjeta para este día"
                      className={`grid h-5 w-5 place-items-center rounded text-sm leading-none text-slate-400 hover:bg-white hover:text-ink-700 ${
                        altaEn === clave ? "bg-white text-ink-700 ring-1 ring-ink-300" : ""
                      }`}
                    >
                      +
                    </button>
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  {delDia.map((card) => (
                    <Chip
                      key={card.id}
                      card={card}
                      movible={esMovible(card)}
                      pendiente={pendiente === card.id}
                      onDragStart={() => setArrastrada(card.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <section
        onDragOver={(e) => {
          e.preventDefault();
          setBandejaActiva(true);
        }}
        onDragLeave={() => setBandejaActiva(false)}
        onDrop={(e) => {
          e.preventDefault();
          setBandejaActiva(false);
          if (arrastrada) mover(arrastrada, null);
          setArrastrada(null);
        }}
        className={`card ${bandejaActiva ? "ring-2 ring-ink-400 ring-inset" : ""}`}
      >
        <div className="card-header">
          <h2 className="card-title">Sin fecha de entrega ({sinFecha.length})</h2>
          <p className="text-xs text-slate-500">
            Arrastra una tarjeta a un día para comprometerla, o suéltala aquí para quitarle la
            fecha.
          </p>
        </div>
        <div className="card-body">
          {sinFecha.length === 0 ? (
            <p className="text-sm text-slate-500">
              Todos los pedidos abiertos tienen fecha comprometida.
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {sinFecha.map((card) => (
                <li key={card.id} className="w-56">
                  <Chip
                    card={card}
                    movible={esMovible(card)}
                    pendiente={pendiente === card.id}
                    onDragStart={() => setArrastrada(card.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="text-xs text-slate-500">
        Colores por estado:{" "}
        {(["CONFIRMED", "IN_PRODUCTION", "READY", "DELIVERED"] as OrderStatus[]).map((estado) => (
          <span
            key={estado}
            className={`mr-1.5 inline-block rounded px-1.5 py-0.5 ring-1 ring-inset ${ESTADO_TONO[estado]}`}
          >
            {ORDER_STATUS_LABELS[estado]}
          </span>
        ))}
      </p>
    </div>
  );
}
