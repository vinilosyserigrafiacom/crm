import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import {
  EXCLUSION_LABELS,
  describeRules,
  parseRules,
  resolveAudience,
} from "@/lib/segments";
import { SEGMENT_KIND_LABELS, type SegmentKind } from "@/lib/validation";
import { formatDate, truncate } from "@/lib/format";
import { getMailrelayConfig } from "@/lib/integration-config";
import { MembersCard } from "./members-card";
import { MailrelayCard } from "./mailrelay-card";
import {
  addMembersAction,
  deleteSegmentAction,
  optOutRecipientAction,
  removeMemberAction,
} from "../actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const segment = await prisma.segment.findUnique({ where: { id }, select: { name: true } });
  return { title: segment?.name ?? "Grupo" };
}

export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const segment = await prisma.segment.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true } },
      members: {
        orderBy: { customer: { legalName: "asc" } },
        select: {
          customer: {
            select: {
              id: true,
              code: true,
              legalName: true,
              email: true,
              _count: { select: { contacts: true } },
            },
          },
        },
      },
    },
  });
  if (!segment) notFound();

  const esEstatico = segment.kind === "STATIC";

  const [audiencia, candidatos, mailrelayConfig] = await Promise.all([
    resolveAudience(segment),
    esEstatico
      ? prisma.customer.findMany({
          where: { active: true },
          orderBy: { legalName: "asc" },
          select: { id: true, code: true, legalName: true },
        })
      : Promise.resolve([]),
    getMailrelayConfig(),
  ]);

  const borrar = deleteSegmentAction.bind(null, segment.id);
  const rules = parseRules(segment.rulesJson);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={esEstatico ? "pill-slate" : "pill-violet"}>
              {SEGMENT_KIND_LABELS[segment.kind as SegmentKind] ?? segment.kind}
            </span>
            {!segment.active && <span className="pill-slate">Inactivo</span>}
            {!segment.onlyWithConsent && (
              <span className="pill-amber">Sin exigir consentimiento</span>
            )}
          </p>
          <h1 className="page-title">{segment.name}</h1>
          <p className="page-subtitle">
            {segment.description ?? (esEstatico ? "Lista elegida a mano" : describeRules(rules))}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/newsletters/${segment.id}/export`}
            className="btn-primary"
            download
          >
            Descargar CSV
          </a>
          <Link href={`/newsletters/${segment.id}/editar`} className="btn-secondary">
            Editar
          </Link>
          <form action={borrar}>
            <button type="submit" className="btn-danger">
              Borrar grupo
            </button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Destinatarios
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {audiencia.recipients.length}
          </p>
          <p className="text-xs text-slate-500">correos únicos, listos para enviar</p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Clientes en el grupo
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {audiencia.customerCount}
          </p>
          <p className="text-xs text-slate-500">
            {esEstatico ? "elegidos a mano" : "que cumplen las reglas ahora mismo"}
          </p>
        </div>
        <div className="card card-body">
          <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">
            Se quedan fuera
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-700">
            {audiencia.excluded.length}
          </p>
          <p className="text-xs text-slate-500">sin correo, de baja o sin consentimiento</p>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0 space-y-5">
          {esEstatico && (
            <MembersCard
              members={segment.members.map((m) => ({
                id: m.customer.id,
                code: m.customer.code,
                legalName: m.customer.legalName,
                email: m.customer.email,
                contactCount: m.customer._count.contacts,
              }))}
              candidates={candidatos}
              add={addMembersAction.bind(null, segment.id)}
              remove={removeMemberAction.bind(null, segment.id)}
            />
          )}

          {!esEstatico && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Reglas del grupo</h2>
                <Link
                  href={`/newsletters/${segment.id}/editar`}
                  className="text-xs font-medium text-ink-700 hover:underline"
                >
                  Cambiar
                </Link>
              </div>
              <div className="card-body">
                <p className="text-sm text-slate-700">{describeRules(rules)}</p>
                <p className="mt-2 text-xs text-slate-500">
                  La lista se recalcula sola: si mañana un cliente cumple las reglas, entra sin
                  que haya que tocar nada.
                </p>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Se quedan fuera ({audiencia.excluded.length})</h2>
            </div>
            {audiencia.excluded.length === 0 ? (
              <p className="empty">Todos los clientes del grupo reciben el envío.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audiencia.excluded.map((excluido) => (
                      <tr key={`${excluido.customerId}-${excluido.reason}`}>
                        <td>
                          <Link
                            href={`/clientes/${excluido.customerId}`}
                            className="text-sm hover:underline"
                          >
                            {truncate(excluido.customerName, 32)}
                          </Link>
                        </td>
                        <td>
                          <span
                            className={
                              excluido.reason === "BAJA" ? "pill-red" : "pill-amber"
                            }
                          >
                            {EXCLUSION_LABELS[excluido.reason]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <div className="min-w-0 space-y-5">
          <MailrelayCard
            segmentId={segment.id}
            configured={mailrelayConfig.ok}
            recipientCount={audiencia.recipients.length}
            linkedGroupId={segment.mailrelayGroupId}
            linkedGroupName={segment.mailrelayGroupName}
            syncedAt={segment.mailrelaySyncedAt}
            syncedCount={segment.mailrelaySyncedCount}
          />

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Destinatarios ({audiencia.recipients.length})</h2>
              {segment.createdBy && (
                <p className="text-xs text-slate-500">Creado por {segment.createdBy.name}</p>
              )}
            </div>
            {audiencia.recipients.length === 0 ? (
              <p className="empty">
                Ningún destinatario todavía.
                {segment.onlyWithConsent &&
                  " Recuerda que este grupo exige consentimiento expreso; márcalo en la ficha de cada cliente."}
              </p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Correo</th>
                      <th>Nombre</th>
                      <th>Consentimiento</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {audiencia.recipients.map((destinatario) => (
                      <tr key={destinatario.email}>
                        <td className="text-xs">{destinatario.email}</td>
                        <td className="text-xs">
                          <Link
                            href={`/clientes/${destinatario.customerId}`}
                            className="hover:underline"
                          >
                            {truncate(destinatario.name, 24)}
                          </Link>
                          {destinatario.source === "CONTACT" && (
                            <span className="block text-slate-400">
                              {truncate(destinatario.customerName, 24)}
                            </span>
                          )}
                        </td>
                        <td className="text-xs whitespace-nowrap">
                          {destinatario.consentAt ? (
                            formatDate(destinatario.consentAt)
                          ) : (
                            <span className="pill-amber">No consta</span>
                          )}
                        </td>
                        <td className="text-right">
                          <form action={optOutRecipientAction.bind(null, segment.id)}>
                            <input
                              type="hidden"
                              name="customerId"
                              value={destinatario.customerId}
                            />
                            <input type="hidden" name="email" value={destinatario.email} />
                            <button
                              type="submit"
                              className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                              title="Dar de baja de todas las comunicaciones"
                            >
                              Baja
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
