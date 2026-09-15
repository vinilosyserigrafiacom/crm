import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { describeRules, parseRules, resolveAudience } from "@/lib/segments";
import { SEGMENT_KIND_LABELS, type SegmentKind } from "@/lib/validation";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Newsletters" };

export default async function SegmentsPage() {
  await requireUser();

  const [segments, bajas, conConsentimiento] = await Promise.all([
    prisma.segment.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: { _count: { select: { members: true } } },
    }),
    prisma.customer.count({ where: { marketingOptOut: true } }),
    prisma.customer.count({ where: { marketingConsentAt: { not: null } } }),
  ]);

  // El recuento real exige resolver cada grupo. Son pocas consultas y evita
  // enseñar un número que no se parece al que saldrá al exportar.
  const conRecuento = await Promise.all(
    segments.map(async (segment) => ({
      segment,
      audiencia: await resolveAudience(segment),
    })),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Newsletters</h1>
          <p className="page-subtitle">
            Grupos de destinatarios para tus campañas. {conConsentimiento} clientes con
            consentimiento expreso
            {bajas > 0 && `, ${bajas} dados de baja`}.
          </p>
        </div>
        <Link href="/newsletters/nuevo" className="btn-primary">
          Nuevo grupo
        </Link>
      </div>

      {segments.length === 0 ? (
        <div className="card">
          <p className="empty">
            Todavía no hay grupos. Crea el primero para preparar una campaña: por ejemplo,
            «clientes de textil con pedidos este año».
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {conRecuento.map(({ segment, audiencia }) => (
            <Link
              key={segment.id}
              href={`/newsletters/${segment.id}`}
              className={`card card-body transition-colors hover:border-ink-300 ${
                segment.active ? "" : "opacity-60"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{segment.name}</h2>
                <span className={segment.kind === "DYNAMIC" ? "pill-violet" : "pill-slate"}>
                  {SEGMENT_KIND_LABELS[segment.kind as SegmentKind] ?? segment.kind}
                </span>
              </div>

              <p className="mt-1 text-xs text-slate-500">
                {segment.description ??
                  (segment.kind === "DYNAMIC"
                    ? describeRules(parseRules(segment.rulesJson))
                    : `${segment._count.members} clientes elegidos a mano`)}
              </p>

              <p className="mt-3 text-2xl font-semibold tabular-nums text-slate-900">
                {audiencia.recipients.length}
                <span className="ml-1 text-sm font-normal text-slate-500">
                  {audiencia.recipients.length === 1 ? "destinatario" : "destinatarios"}
                </span>
              </p>

              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {audiencia.excluded.length > 0 && (
                  <span className="pill-amber">{audiencia.excluded.length} fuera</span>
                )}
                {!segment.onlyWithConsent && (
                  <span className="pill-amber">Sin exigir consentimiento</span>
                )}
                {!segment.active && <span className="pill-slate">Inactivo</span>}
              </p>

              <p className="mt-2 text-xs text-slate-400">
                Actualizado el {formatDate(segment.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      )}

      <section className="card card-body text-xs text-slate-500">
        <p>
          El CRM prepara las listas; el envío lo hace tu herramienta de correo. Desde cada grupo
          puedes descargar el CSV listo para importar en Mailchimp, Brevo o similar.
        </p>
        <p className="mt-1">
          Las bajas se respetan siempre, en todos los grupos y al instante: no hay listas
          congeladas que haya que acordarse de refrescar.
        </p>
      </section>
    </div>
  );
}
