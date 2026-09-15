"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { formatDate } from "@/lib/format";
import { createCardAction } from "./actions";

/**
 * Alta rápida de una tarjeta.
 *
 * El trabajo entra por teléfono o por el mostrador mientras hay gente delante:
 * lo que hace falta en ese momento es apuntar de quién es y qué es, no abrir el
 * editor y ponerse con las líneas. La tarjeta nace en borrador y los importes
 * se rellenan luego, cuando haya un rato.
 */

export interface CardCustomer {
  id: string;
  code: string;
  legalName: string;
  tradeName: string | null;
}

export function NewCardForm({
  customers,
  /** Entrega comprometida en yyyy-mm-dd, o null para dejarla sin fecha. */
  defaultDate = null,
  onClose,
}: {
  customers: CardCustomer[];
  defaultDate?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const primerCampo = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    primerCampo.current?.focus();
  }, []);

  const enviar = (formData: FormData) => {
    const customerId = String(formData.get("customerId") ?? "");
    if (!customerId) {
      setError("Elige un cliente.");
      return;
    }
    const date = String(formData.get("date") ?? "").trim();
    setError(null);

    startTransition(async () => {
      const resultado = await createCardAction({
        customerId,
        title: String(formData.get("title") ?? ""),
        date: date || null,
      });
      if (!resultado.ok) {
        setError(resultado.error ?? "No se ha podido crear la tarjeta.");
        return;
      }
      onClose();
      router.refresh();
    });
  };

  return (
    <form
      action={enviar}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      className="space-y-2 rounded-lg border border-ink-200 bg-ink-50/60 p-2.5"
    >
      {error && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="card-customer" className="label">
          Cliente
        </label>
        <select
          id="card-customer"
          name="customerId"
          ref={primerCampo}
          defaultValue=""
          className="input text-xs"
          required
        >
          <option value="" disabled>
            Elige un cliente…
          </option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.tradeName ?? c.legalName} · {c.code}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="card-title" className="label">
          Trabajo
        </label>
        <input
          id="card-title"
          name="title"
          className="input text-xs"
          placeholder="Rotulación furgoneta, 30 camisetas…"
        />
      </div>

      <div>
        <label htmlFor="card-date" className="label">
          Entrega
        </label>
        <input
          id="card-date"
          name="date"
          type="date"
          defaultValue={defaultDate ?? ""}
          className="input text-xs"
        />
      </div>

      <div className="flex items-center gap-2">
        <button type="submit" className="btn-primary btn-sm" disabled={pendiente}>
          {pendiente ? "Creando…" : "Crear tarjeta"}
        </button>
        <button type="button" onClick={onClose} className="btn-ghost btn-sm">
          Cancelar
        </button>
      </div>

      <p className="text-[11px] text-slate-500">
        Nace en borrador y sin importes. Ábrela para poner las líneas y confirmarla.
      </p>
    </form>
  );
}

/** Botón que abre el formulario en el sitio donde se pulsa. */
export function NewCardPanel({
  customers,
  defaultDate = null,
  label = "Nueva tarjeta",
  className = "btn-secondary btn-sm",
}: {
  customers: CardCustomer[];
  defaultDate?: string | null;
  label?: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className={className}>
        {label}
      </button>
    );
  }

  return (
    <div className="w-full">
      {defaultDate && (
        <p className="mb-1 text-xs font-medium text-slate-600">
          Entrega el {formatDate(new Date(`${defaultDate}T12:00:00`))}
        </p>
      )}
      <NewCardForm
        customers={customers}
        defaultDate={defaultDate}
        onClose={() => setAbierto(false)}
      />
    </div>
  );
}
