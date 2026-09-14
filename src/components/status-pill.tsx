import {
  ORDER_STATUS_LABELS,
  QUOTE_STATUS_LABELS,
  type OrderStatus,
  type QuoteStatus,
} from "@/lib/validation";

/*
 * Los estados se distinguen por color y por texto. Solo por color no sirve:
 * una de cada doce personas no distingue el rojo del verde, y esta pantalla la
 * va a mirar alguien con prisa en el taller.
 */

const QUOTE_STYLES: Record<QuoteStatus, string> = {
  DRAFT: "pill-slate",
  SENT: "pill-blue",
  ACCEPTED: "pill-green",
  REJECTED: "pill-red",
  EXPIRED: "pill-amber",
  CANCELLED: "pill-slate",
};

const ORDER_STYLES: Record<OrderStatus, string> = {
  DRAFT: "pill-slate",
  CONFIRMED: "pill-blue",
  IN_PRODUCTION: "pill-violet",
  READY: "pill-amber",
  DELIVERED: "pill-green",
  CANCELLED: "pill-slate",
};

export function QuoteStatusPill({ status }: { status: string }) {
  const key = (status as QuoteStatus) in QUOTE_STATUS_LABELS ? (status as QuoteStatus) : "DRAFT";
  return <span className={QUOTE_STYLES[key]}>{QUOTE_STATUS_LABELS[key]}</span>;
}

export function OrderStatusPill({ status }: { status: string }) {
  const key = (status as OrderStatus) in ORDER_STATUS_LABELS ? (status as OrderStatus) : "DRAFT";
  return <span className={ORDER_STYLES[key]}>{ORDER_STATUS_LABELS[key]}</span>;
}
