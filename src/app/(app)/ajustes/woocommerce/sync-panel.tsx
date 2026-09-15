"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/form";

/**
 * Botones de la integración.
 *
 * La sincronización puede tardar minutos con una tienda grande, así que el
 * botón se queda deshabilitado y avisa de que no se cierre la pestaña: la
 * importación corre en el servidor mientras dure la petición.
 */
export function SyncPanel({
  configurada,
  test,
  sync,
}: {
  configurada: boolean;
  test: () => Promise<FormState>;
  sync: (completa: boolean) => Promise<FormState>;
}) {
  const [estado, setEstado] = useState<FormState>({});
  const [enMarcha, setEnMarcha] = useState<null | "test" | "incremental" | "completa">(null);
  const [, startTransition] = useTransition();

  const lanzar = (que: "test" | "incremental" | "completa") => {
    setEstado({});
    setEnMarcha(que);
    startTransition(async () => {
      const resultado =
        que === "test" ? await test() : await sync(que === "completa");
      setEstado(resultado);
      setEnMarcha(null);
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary"
          disabled={!configurada || enMarcha !== null}
          onClick={() => lanzar("test")}
        >
          {enMarcha === "test" ? "Probando…" : "Probar conexión"}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={!configurada || enMarcha !== null}
          onClick={() => lanzar("incremental")}
        >
          {enMarcha === "incremental" ? "Sincronizando…" : "Sincronizar cambios"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          disabled={!configurada || enMarcha !== null}
          onClick={() => lanzar("completa")}
        >
          {enMarcha === "completa" ? "Importando…" : "Importar todo"}
        </button>
      </div>

      {enMarcha !== null && enMarcha !== "test" && (
        <p className="text-xs text-slate-500">
          Puede tardar varios minutos si la tienda tiene muchos pedidos. No cierres la pestaña
          hasta que termine.
        </p>
      )}

      {estado.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {estado.error}
        </div>
      )}
      {estado.message && (
        <p
          role="status"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          {estado.message}
        </p>
      )}
    </div>
  );
}
