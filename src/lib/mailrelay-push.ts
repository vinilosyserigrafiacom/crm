import { prisma } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { resolveAudience, type Recipient } from "@/lib/segments";
import {
  fetchAllSubscribers,
  groupIdsOf,
  syncSubscriber,
  MailrelayError,
  type MailrelayConfig,
  type MailrelaySubscriber,
} from "@/lib/mailrelay";

/**
 * Subir un grupo del CRM a un grupo de Mailrelay.
 *
 * Esto no es «exportar»: es dejar el grupo de Mailrelay igual que la audiencia
 * del CRM en este momento. Da de alta a quien falte y saca del grupo a quien ya
 * no esté —porque se dio de baja, porque se archivó el cliente o porque dejó de
 * cumplir la regla—, que es lo único que hace que una baja en el CRM sirva de
 * algo cuando el correo lo manda otro.
 *
 * Sacar a alguien de un grupo nunca es borrarlo de Mailrelay: puede estar en
 * otros grupos y en otras listas que aquí no se ven.
 */

export interface PushResult {
  /** Añadidos al grupo (altas nuevas o suscriptores que ya existían). */
  added: number;
  /** Ya estaban en el grupo y siguen. */
  kept: number;
  /** Sacados del grupo por no estar ya en la audiencia. */
  removed: number;
  /** Destinatarios de la audiencia en el momento de subir. */
  audienceSize: number;
  warnings: string[];
}

/** A partir de aquí la subida son demasiadas llamadas para una pantalla. */
const AVISO_TAMANO = 2_000;

interface SubscribersIndex {
  /** Por correo en minúsculas. */
  byEmail: Map<string, { subscriber: MailrelaySubscriber; groupIds: number[] }>;
}

/**
 * Trae todos los suscriptores y comprueba que se sabe a qué grupos pertenecen.
 *
 * Si Mailrelay no devuelve los grupos de cada uno, la subida se para antes de
 * escribir nada: para meter a alguien en un grupo hay que mandar su lista
 * completa de grupos, y mandarla a ciegas lo sacaría de todos los demás.
 */
async function indexSubscribers(config: MailrelayConfig): Promise<SubscribersIndex> {
  const byEmail = new Map<string, { subscriber: MailrelaySubscriber; groupIds: number[] }>();

  for await (const lote of fetchAllSubscribers(config)) {
    for (const subscriber of lote) {
      const groupIds = groupIdsOf(subscriber);
      if (groupIds === null) {
        throw new MailrelayError(
          "Mailrelay no está devolviendo a qué grupos pertenece cada suscriptor, y sin eso subir el grupo sacaría a gente de sus otros grupos. No se ha cambiado nada.",
        );
      }
      byEmail.set(subscriber.email.trim().toLowerCase(), { subscriber, groupIds });
    }
  }

  return { byEmail };
}

export interface PushOptions {
  config: MailrelayConfig;
  segment: {
    id: string;
    name: string;
    kind: string;
    rulesJson: string;
    onlyWithConsent: boolean;
    includeAllContacts: boolean;
  };
  groupId: number;
  groupName: string;
  userId: string | null;
  /** Inyectable para poder probar sin red. */
  loadAudience?: () => Promise<{ recipients: Recipient[] }>;
}

export async function pushSegmentToMailrelay(options: PushOptions): Promise<PushResult> {
  const { config, segment, groupId, groupName, userId } = options;

  const { recipients } = options.loadAudience
    ? await options.loadAudience()
    : await resolveAudience(segment);

  const warnings: string[] = [];
  if (recipients.length > AVISO_TAMANO) {
    warnings.push(
      `El grupo tiene ${recipients.length} destinatarios: la subida va uno a uno y puede tardar varios minutos.`,
    );
  }

  const { byEmail } = await indexSubscribers(config);

  // Los que la audiencia manda que estén en el grupo.
  const deseados = new Map<string, Recipient>();
  for (const destinatario of recipients) {
    deseados.set(destinatario.email.trim().toLowerCase(), destinatario);
  }

  let added = 0;
  let kept = 0;
  let removed = 0;

  for (const [email, destinatario] of deseados) {
    const actual = byEmail.get(email);

    if (actual && actual.groupIds.includes(groupId)) {
      kept += 1;
      continue;
    }

    try {
      await syncSubscriber(config, {
        email: destinatario.email,
        name: destinatario.name,
        // La lista completa: los grupos que ya tenía más este.
        groupIds: [...new Set([...(actual?.groupIds ?? []), groupId])],
      });
      added += 1;
    } catch (error) {
      warnings.push(
        `${destinatario.email}: ${error instanceof Error ? error.message : "no se ha podido dar de alta"}`,
      );
    }
  }

  // Los que están en el grupo de Mailrelay y ya no salen en la audiencia.
  for (const [email, { subscriber, groupIds }] of byEmail) {
    if (!groupIds.includes(groupId)) continue;
    if (deseados.has(email)) continue;

    try {
      await syncSubscriber(config, {
        email: subscriber.email,
        name: subscriber.name ?? "",
        // Se queda en los demás grupos: aquí solo se sale de este.
        groupIds: groupIds.filter((id) => id !== groupId),
      });
      removed += 1;
    } catch (error) {
      warnings.push(
        `${subscriber.email}: ${error instanceof Error ? error.message : "no se ha podido sacar del grupo"}`,
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.segment.update({
      where: { id: segment.id },
      data: {
        mailrelayGroupId: groupId,
        mailrelayGroupName: groupName,
        mailrelaySyncedAt: new Date(),
        mailrelaySyncedCount: recipients.length,
      },
    });
    await recordAudit(tx, {
      userId,
      entity: "Segment",
      entityId: segment.id,
      action: "UPDATE",
      summary: `«${segment.name}» subido al grupo «${groupName}» de Mailrelay: ${added} altas, ${kept} ya estaban, ${removed} fuera`,
      data: { groupId, added, kept, removed, audienceSize: recipients.length },
    });
  });

  return { added, kept, removed, audienceSize: recipients.length, warnings };
}
