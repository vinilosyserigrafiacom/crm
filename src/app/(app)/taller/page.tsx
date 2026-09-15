import type { Metadata } from "next";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatCents } from "@/lib/money";
import type { OrderStatus } from "@/lib/validation";
import { Board, type BoardCard } from "./board";
import { Calendar } from "./calendar";

export const metadata: Metadata = { title: "Taller" };

type Vista = "tablero" | "calendario";

/** Estados cuyo trabajo sigue vivo; son los que se planifican. */
const ABIERTOS: OrderStatus[] = ["DRAFT", "CONFIRMED", "IN_PRODUCTION", "READY"];

const cardSelect = {
  id: true,
  number: true,
  wooNumber: true,
  title: true,
  status: true,
  dueDate: true,
  total: true,
  customerId: true,
  customer: { select: { legalName: true, tradeName: true } },
} satisfies Prisma.OrderSelect;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof cardSelect }>;

function toCard(order: OrderRow): BoardCard {
  return {
    id: order.id,
    number: order.number,
    wooNumber: order.wooNumber,
    title: order.title,
    customerId: order.customerId,
    customerName: order.customer.tradeName ?? order.customer.legalName,
    status: order.status,
    dueDate: order.dueDate,
    total: order.total,
  };
}

/** Lee el mes de la URL (yyyy-mm); si no es válido, el actual. */
function readMonth(raw: string | undefined): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(raw ?? "");
  if (match) {
    const mes = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    if (!Number.isNaN(mes.getTime())) return mes;
  }
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), 1);
}

function monthParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default async function WorkshopPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; mes?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const vista: Vista = params.vista === "calendario" ? "calendario" : "tablero";
  const month = readMonth(params.mes);

  // El tablero enseña las columnas de trabajo. Los entregados se limitan a los
  // últimos para que la columna no crezca sin fin y siga siendo útil de mirar.
  const haceUnMes = new Date();
  haceUnMes.setMonth(haceUnMes.getMonth() - 1);

  const finDeMes = new Date(month.getFullYear(), month.getMonth() + 1, 1);

  const [enColumnas, entregadosRecientes, delMes, sinFecha, pendientes] = await Promise.all([
    prisma.order.findMany({
      where: { status: { in: ABIERTOS } },
      orderBy: [{ boardPosition: "asc" }, { createdAt: "asc" }],
      select: cardSelect,
    }),
    prisma.order.findMany({
      where: { status: "DELIVERED", deliveredAt: { gte: haceUnMes } },
      orderBy: [{ boardPosition: "asc" }, { deliveredAt: "desc" }],
      take: 20,
      select: cardSelect,
    }),
    prisma.order.findMany({
      where: {
        dueDate: { gte: month, lt: finDeMes },
        status: { not: "CANCELLED" },
      },
      orderBy: [{ dueDate: "asc" }, { boardPosition: "asc" }],
      select: cardSelect,
    }),
    prisma.order.findMany({
      where: { status: { in: ABIERTOS }, dueDate: null },
      orderBy: { createdAt: "asc" },
      select: cardSelect,
    }),
    prisma.order.aggregate({
      where: { status: { in: ABIERTOS } },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const boardCards = [...enColumnas, ...entregadosRecientes].map(toCard);

  const mesAnterior = new Date(month.getFullYear(), month.getMonth() - 1, 1);
  const mesSiguiente = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const monthLabel = new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
  }).format(month);

  const tabs: { key: Vista; label: string }[] = [
    { key: "tablero", label: "Tablero" },
    { key: "calendario", label: "Calendario" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Taller</h1>
          <p className="page-subtitle">
            {pendientes._count} trabajos en curso por {formatCents(pendientes._sum.total ?? 0)}.
          </p>
        </div>

        <nav className="flex items-center gap-1" aria-label="Vista">
          {tabs.map((tab) => {
            const activa = tab.key === vista;
            const href =
              tab.key === "calendario"
                ? `/taller?vista=calendario&mes=${monthParam(month)}`
                : "/taller";
            return (
              <Link
                key={tab.key}
                href={href}
                aria-current={activa ? "page" : undefined}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                  activa
                    ? "bg-ink-50 text-ink-700"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {vista === "tablero" ? (
        <>
          <Board cards={boardCards} />
          <p className="text-xs text-slate-500">
            Arrastra las tarjetas entre columnas, o usa «Mover a…» desde el móvil. La columna de
            entregados muestra solo el último mes; el resto está en{" "}
            <Link href="/pedidos" className="text-ink-700 hover:underline">
              Pedidos
            </Link>
            .
          </p>
        </>
      ) : (
        <Calendar
          cards={delMes.map(toCard)}
          unscheduled={sinFecha.map(toCard)}
          month={month}
          monthLabel={monthLabel}
          prevHref={`/taller?vista=calendario&mes=${monthParam(mesAnterior)}`}
          nextHref={`/taller?vista=calendario&mes=${monthParam(mesSiguiente)}`}
          todayHref="/taller?vista=calendario"
        />
      )}
    </div>
  );
}
