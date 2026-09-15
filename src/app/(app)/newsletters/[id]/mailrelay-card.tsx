"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";
import type { MailrelayGroup } from "@/lib/mailrelay";
import {
  loadMailrelayGroupsAction,
  pushToMailrelayAction,
  type PushActionResult,
} from "../mailrelay-actions";

/**
 * Subida del grupo a Mailrelay.
 *
 * Los grupos de la cuenta se piden al pulsar y no al pintar la página: si
 * Mailrelay está caído, la ficha del grupo tiene que seguir abriéndose y el CSV
 * tiene que seguir descargándose.
 */
export function MailrelayCard({
  segmentId,
  configured,
  recipientCount,
  linkedGroupId,
  linkedGroupName,
  syncedAt,
  syncedCount,
}: {
  segmentId: string;
  configured: boolean;
  recipientCount: number;
  linkedGroupId: number | null;
  linkedGroupName: string | null;
  syncedAt: Date | null;
  syncedCount: number | null;
}) {
  const router = useRouter();
  const [grupos, setGrupos] = useState<MailrelayGroup[] | null>(null);
  const [elegido, setElegido] = useState<number | null>(linkedGroupId);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<PushActionResult | null>(null);
  const [cargando, startLoad] = useTransition();
  const [subiendo, startPush] = useTransition();

  const cargarGrupos = () => {
    setError(null);
    startLoad(async () => {
      const r = await loadMailrelayGroupsAction();
      if (!r.ok) {
        setError(r.error ?? "No se han podido leer los grupos de Mailrelay.");
        return;
      }
      setGrupos(r.groups ?? []);
      if (elegido === null && r.groups && r.groups.length > 0) setElegido(r.groups[0].id);
    });
  };

  const subir = () => {
    if (elegido === null) {
      setError("Elige antes el grupo de Mailrelay.");
      return;
    }
    setError(null);
    setResultado(null);
    startPush(async () => {
      const r = await pushToMailrelayAction({ segmentId, groupId: elegido });
      setResultado(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Mailrelay</h2>
        {linkedGroupName && <span className="pill-violet">{linkedGroupName}</span>}
      </div>

      <div className="card-body space-y-3">
        {!configured ? (
          <p className="text-sm text-slate-600">
            La conexión con Mailrelay no está configurada.{" "}
            <Link href="/ajustes/mailrelay" className="text-ink-700 hover:underline">
              Ver cómo se configura
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Sube los {recipientCount} destinatarios de este grupo a un grupo de Mailrelay y lo
              deja igual que esta lista: da de alta a quien falte y saca del grupo a quien ya no
              esté.
            </p>

            {syncedAt && (
              <p className="text-xs text-slate-500">
                Última subida: {formatDateTime(syncedAt)}
                {syncedCount !== null && ` · ${syncedCount} destinatarios`}
              </p>
            )}

            {grupos === null ? (
              <button
                type="button"
                onClick={cargarGrupos}
                className="btn-secondary btn-sm"
                disabled={cargando}
              >
                {cargando ? "Leyendo tu cuenta…" : "Elegir grupo de Mailrelay"}
              </button>
            ) : grupos.length === 0 ? (
              <p className="text-sm text-amber-800">
                Tu cuenta de Mailrelay no tiene ningún grupo todavía. Crea uno allí y vuelve.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <label htmlFor="mailrelay-group" className="label">
                    Grupo de destino
                  </label>
                  <select
                    id="mailrelay-group"
                    className="input"
                    value={elegido ?? ""}
                    onChange={(e) => setElegido(Number(e.target.value))}
                  >
                    {grupos.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                        {g.subscribers_count !== null && g.subscribers_count !== undefined
                          ? ` (${g.subscribers_count})`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={subir}
                  className="btn-primary"
                  disabled={subiendo || recipientCount === 0}
                >
                  {subiendo ? "Subiendo…" : "Subir destinatarios"}
                </button>
              </div>
            )}

            {recipientCount === 0 && (
              <p className="text-xs text-slate-500">
                Este grupo no tiene ningún destinatario ahora mismo, así que no hay nada que
                subir.
              </p>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        {resultado?.ok && resultado.message && (
          <p role="status" className="text-sm font-medium text-emerald-800">
            {resultado.message}
          </p>
        )}
        {resultado && !resultado.ok && resultado.error && (
          <p role="alert" className="text-sm text-red-700">
            {resultado.error}
          </p>
        )}
        {resultado?.warnings && resultado.warnings.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
            {resultado.warnings.map((aviso, i) => (
              <li key={i}>{aviso}</li>
            ))}
          </ul>
        )}

        <p className="text-xs text-slate-500">
          La lista no se guarda en ningún sitio del CRM: se resuelve al subirla. Quien se haya
          dado de baja aquí sale del grupo de Mailrelay en la siguiente subida, y nunca se borra
          a nadie de Mailrelay: solo se le saca de este grupo.
        </p>
      </div>
    </section>
  );
}
