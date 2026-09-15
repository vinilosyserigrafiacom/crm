import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getWooConfig, storedState } from "@/lib/integration-config";
import { CredentialsForm } from "@/components/credentials-form";
import { maskSecret } from "@/lib/secrets";
import { formatDateTime } from "@/lib/format";
import { SyncPanel } from "./sync-panel";
import {
  clearWooCredentialsAction,
  saveWooCredentialsAction,
  syncNowAction,
  testConnectionAction,
} from "./actions";

export const metadata: Metadata = { title: "WooCommerce" };

interface AvisoGuardado {
  scope?: string;
  reference?: string;
  message?: string;
}

function leerAvisos(json: string): AvisoGuardado[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as AvisoGuardado[]) : [];
  } catch {
    return [];
  }
}

export default async function WooCommercePage() {
  const user = await requireUser();
  const puedeGestionar = user.role === "OWNER" || user.role === "ADMIN";

  const [config, guardadas] = await Promise.all([getWooConfig(), storedState("woocommerce")]);
  const configurada = config.ok;

  const [ejecuciones, importados, clientesImportados] = await Promise.all([
    prisma.wooSyncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 10,
      include: { triggeredBy: { select: { name: true } } },
    }),
    prisma.order.count({ where: { source: "WOOCOMMERCE" } }),
    prisma.customer.count({ where: { source: "WOOCOMMERCE" } }),
  ]);

  const ultimaCorrecta = ejecuciones.find((e) => e.status === "OK");
  const avisosUltima = ultimaCorrecta ? leerAvisos(ultimaCorrecta.warnings) : [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500">
          <Link href="/ajustes" className="hover:underline">
            Ajustes
          </Link>{" "}
          · Integraciones
        </p>
        <h1 className="page-title">WooCommerce</h1>
        <p className="page-subtitle">
          Trae los clientes y los pedidos de la tienda. La información va en un solo sentido: el
          CRM nunca escribe nada en WooCommerce.
        </p>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Conexión</h2>
          <span className={configurada ? "pill-green" : "pill-amber"}>
            {configurada ? "Configurada" : "Sin configurar"}
          </span>
        </div>
        <div className="card-body space-y-4">
          {configurada && (
            <dl className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Tienda</dt>
                <dd className="break-all">{config.config.baseUrl}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Clientes importados</dt>
                <dd className="tabular-nums">{clientesImportados}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Pedidos importados</dt>
                <dd className="tabular-nums">{importados}</dd>
              </div>
            </dl>
          )}

          {puedeGestionar ? (
            <>
              <p className="text-sm text-slate-700">
                Las claves se generan en WooCommerce → Ajustes → Avanzado → API REST, con permiso
                de <strong>solo lectura</strong>: el CRM no necesita más.
              </p>
              <CredentialsForm
                action={saveWooCredentialsAction}
                clearAction={guardadas.saved ? clearWooCredentialsAction : undefined}
                saved={guardadas.saved}
                savedLabel={
                  guardadas.savedAt
                    ? `Guardadas el ${formatDateTime(guardadas.savedAt)}${
                        guardadas.savedBy ? ` por ${guardadas.savedBy}` : ""
                      }.`
                    : undefined
                }
                fields={[
                  {
                    name: "baseUrl",
                    label: "Dirección de la tienda",
                    wide: true,
                    placeholder: "https://vinilosyserigrafia.com",
                    hint: "Sin /wp-json ni barra final.",
                    value: configurada ? config.config.baseUrl : "",
                  },
                  {
                    name: "consumerKey",
                    label: "Consumer key",
                    placeholder: "ck_…",
                    value: configurada ? config.config.consumerKey : "",
                  },
                  {
                    name: "consumerSecret",
                    label: "Consumer secret",
                    placeholder: "cs_…",
                    secret: true,
                    masked: configurada ? maskSecret(config.config.consumerSecret) : undefined,
                  },
                ]}
              />
              {configurada && config.source === "ENV" && !guardadas.saved && (
                <p className="text-xs text-slate-500">
                  Ahora mismo la conexión sale del fichero{" "}
                  <code className="rounded bg-slate-100 px-1 font-mono">.env</code> del servidor. Si
                  guardas aquí unas credenciales, mandan las de esta pantalla.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-600">
              Solo las cuentas de propietario y administración pueden cambiar las credenciales.
            </p>
          )}

          {puedeGestionar ? (
            <SyncPanel
              configurada={configurada}
              test={testConnectionAction}
              sync={syncNowAction}
            />
          ) : (
            <p className="text-sm text-slate-600">
              Solo las cuentas de propietario y administración pueden sincronizar.
            </p>
          )}
        </div>
      </section>

      {avisosUltima.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Avisos de la última sincronización</h2>
          </div>
          <ul className="card-body space-y-2 text-sm">
            {avisosUltima.slice(0, 20).map((aviso, indice) => (
              <li key={indice} className="flex flex-wrap items-baseline gap-2">
                <span className="pill-amber">{aviso.reference ?? "?"}</span>
                <span className="text-slate-700">{aviso.message}</span>
              </li>
            ))}
            {avisosUltima.length > 20 && (
              <li className="text-xs text-slate-500">
                y {avisosUltima.length - 20} avisos más.
              </li>
            )}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Últimas sincronizaciones</h2>
        </div>
        {ejecuciones.length === 0 ? (
          <p className="empty">
            Todavía no se ha sincronizado nada. La primera vez usa «Importar todo».
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Cuándo</th>
                  <th>Estado</th>
                  <th className="num">Clientes</th>
                  <th className="num">Pedidos</th>
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {ejecuciones.map((run) => (
                  <tr key={run.id}>
                    <td className="text-xs whitespace-nowrap">
                      {formatDateTime(run.startedAt)}
                      {run.triggeredBy && (
                        <span className="block text-slate-400">{run.triggeredBy.name}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={
                          run.status === "OK"
                            ? "pill-green"
                            : run.status === "ERROR"
                              ? "pill-red"
                              : "pill-blue"
                        }
                      >
                        {run.status === "OK"
                          ? "Correcta"
                          : run.status === "ERROR"
                            ? "Con error"
                            : "En marcha"}
                      </span>
                    </td>
                    <td className="num text-xs">
                      {run.customersCreated > 0 && `+${run.customersCreated}`}
                      {run.customersCreated > 0 && run.customersUpdated > 0 && " / "}
                      {run.customersUpdated > 0 && `~${run.customersUpdated}`}
                      {run.customersCreated === 0 && run.customersUpdated === 0 && "—"}
                    </td>
                    <td className="num text-xs">
                      {run.ordersCreated > 0 && `+${run.ordersCreated}`}
                      {run.ordersCreated > 0 && run.ordersUpdated > 0 && " / "}
                      {run.ordersUpdated > 0 && `~${run.ordersUpdated}`}
                      {run.ordersCreated === 0 && run.ordersUpdated === 0 && "—"}
                    </td>
                    <td className="text-xs text-slate-600">
                      {run.error ? (
                        <span className="text-red-700">{run.error}</span>
                      ) : (
                        <>
                          {run.since
                            ? `Cambios desde ${formatDateTime(run.since)}`
                            : "Importación completa"}
                          {run.ordersSkipped > 0 && (
                            <span className="block text-slate-400">
                              {run.ordersSkipped} con el estado respetado del taller
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-body space-y-2 text-xs text-slate-500">
        <p>
          <strong className="text-slate-700">Los pedidos importados no gastan numeración.</strong>{" "}
          Conservan el número de la tienda y solo reciben uno de tu serie si los confirmas aquí.
          Así un pedido que la tienda acabe cancelando no deja un hueco en una serie que tiene que
          ser correlativa.
        </p>
        <p>
          <strong className="text-slate-700">El taller manda sobre la tienda.</strong> Si mueves un
          pedido de columna en el tablero, la siguiente sincronización respeta dónde lo has puesto
          y no lo devuelve a su sitio. Lo que sí se refresca siempre son las líneas y los importes,
          que es lo que solo sabe la tienda.
        </p>
        <p>
          <strong className="text-slate-700">Comprar no es consentir.</strong> Los clientes
          importados entran sin consentimiento para newsletters: eso se marca a mano en su ficha
          cuando conste que lo dieron.
        </p>
      </section>
    </div>
  );
}
