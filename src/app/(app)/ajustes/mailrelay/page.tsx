import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getMailrelayConfig, storedState } from "@/lib/integration-config";
import { CredentialsForm } from "@/components/credentials-form";
import { maskSecret } from "@/lib/secrets";
import { formatDateTime } from "@/lib/format";
import { TestPanel } from "./test-panel";
import {
  clearMailrelayCredentialsAction,
  saveMailrelayCredentialsAction,
  testConnectionAction,
} from "./actions";

export const metadata: Metadata = { title: "Mailrelay" };

export default async function MailrelayPage() {
  const user = await requireUser();
  const puedeGestionar = user.role === "OWNER" || user.role === "ADMIN";

  const [config, guardadas] = await Promise.all([
    getMailrelayConfig(),
    storedState("mailrelay"),
  ]);
  const configurada = config.ok;

  const grupos = await prisma.segment.findMany({
    where: { mailrelayGroupId: { not: null } },
    orderBy: { mailrelaySyncedAt: "desc" },
    select: {
      id: true,
      name: true,
      mailrelayGroupName: true,
      mailrelaySyncedAt: true,
      mailrelaySyncedCount: true,
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-slate-500">
          <Link href="/ajustes" className="hover:underline">
            Ajustes
          </Link>{" "}
          · Integraciones
        </p>
        <h1 className="page-title">Mailrelay</h1>
        <p className="page-subtitle">
          Sube los grupos de newsletter a tu cuenta de Mailrelay para mandar las campañas desde
          allí. El correo lo envía Mailrelay; el CRM solo mantiene la lista al día.
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
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-slate-500">Cuenta</dt>
                <dd className="break-all">{config.config.baseUrl}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Grupos enlazados</dt>
                <dd className="tabular-nums">{grupos.length}</dd>
              </div>
            </dl>
          )}

          {puedeGestionar ? (
            <>
              <p className="text-sm text-slate-700">
                La clave se genera en Mailrelay → Ajustes → Claves API. La dirección es la de tu
                panel, la que termina en <code className="font-mono">.ipzmarketing.com</code>.
              </p>
              <CredentialsForm
                action={saveMailrelayCredentialsAction}
                clearAction={guardadas.saved ? clearMailrelayCredentialsAction : undefined}
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
                    label: "Dirección de tu cuenta",
                    wide: true,
                    placeholder: "https://tucuenta.ipzmarketing.com",
                    hint: "Sin /api/v1 ni barra final.",
                    value: configurada ? config.config.baseUrl : "",
                  },
                  {
                    name: "apiKey",
                    label: "Clave de la API",
                    secret: true,
                    masked: configurada ? maskSecret(config.config.apiKey) : undefined,
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

          <TestPanel configurada={configurada} test={testConnectionAction} />
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Grupos enlazados</h2>
          <Link href="/newsletters" className="text-xs font-medium text-ink-700 hover:underline">
            Ir a Newsletters
          </Link>
        </div>
        {grupos.length === 0 ? (
          <p className="empty">
            Ningún grupo subido todavía. Se hace desde la ficha de cada grupo, en Newsletters.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Grupo del CRM</th>
                  <th>Grupo de Mailrelay</th>
                  <th>Última subida</th>
                  <th className="num">Destinatarios</th>
                </tr>
              </thead>
              <tbody>
                {grupos.map((grupo) => (
                  <tr key={grupo.id}>
                    <td>
                      <Link
                        href={`/newsletters/${grupo.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {grupo.name}
                      </Link>
                    </td>
                    <td className="text-sm text-slate-600">{grupo.mailrelayGroupName ?? "—"}</td>
                    <td className="text-xs whitespace-nowrap text-slate-500">
                      {grupo.mailrelaySyncedAt ? formatDateTime(grupo.mailrelaySyncedAt) : "Nunca"}
                    </td>
                    <td className="num tabular-nums">{grupo.mailrelaySyncedCount ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card card-body space-y-2 text-sm text-slate-700">
        <p>
          <strong>Subir deja el grupo igual que la lista del CRM.</strong> Da de alta a quien
          falte y saca del grupo a quien ya no esté, que es lo que hace que una baja apuntada aquí
          sirva de algo cuando el correo lo manda otro.
        </p>
        <p>
          <strong>Nunca se borra a nadie de Mailrelay.</strong> A quien sale de un grupo se le deja
          en los demás a los que pertenezca: puede estar en listas que desde aquí no se ven.
        </p>
        <p>
          <strong>La lista sigue sin guardarse aquí.</strong> Se resuelve en el momento de subirla,
          igual que al mirarla o al exportarla a CSV.
        </p>
      </section>
    </div>
  );
}
