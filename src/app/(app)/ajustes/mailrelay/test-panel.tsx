"use client";

import { useState, useTransition } from "react";
import type { TestResult } from "./actions";

/** Botón de probar conexión: la prueba es que salgan los grupos de tu cuenta. */
export function TestPanel({
  configurada,
  test,
}: {
  configurada: boolean;
  test: () => Promise<TestResult>;
}) {
  const [resultado, setResultado] = useState<TestResult | null>(null);
  const [pendiente, startTransition] = useTransition();

  if (!configurada) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={pendiente}
        onClick={() => startTransition(async () => setResultado(await test()))}
      >
        {pendiente ? "Probando…" : "Probar conexión"}
      </button>

      {resultado && (
        <p
          role={resultado.ok ? "status" : "alert"}
          className={`text-sm ${resultado.ok ? "text-emerald-800" : "text-red-700"}`}
        >
          {resultado.message}
        </p>
      )}

      {resultado?.groups && resultado.groups.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {resultado.groups.map((nombre) => (
            <li key={nombre} className="pill-slate">
              {nombre}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
