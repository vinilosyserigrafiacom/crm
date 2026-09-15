"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { listGroups, type MailrelayGroup } from "@/lib/mailrelay";
import { getMailrelayConfig } from "@/lib/integration-config";
import { pushSegmentToMailrelay } from "@/lib/mailrelay-push";

/**
 * Acciones de la conexión con Mailrelay.
 *
 * Reciben un objeto y no un FormData porque las llama la tarjeta de la ficha
 * del grupo, que necesita pintar la lista de grupos de Mailrelay antes de
 * enviar nada. Como el resto de acciones de este tipo, se validan igual que un
 * formulario: son endpoints públicos.
 */

export interface GroupsResult {
  ok: boolean;
  error?: string;
  groups?: MailrelayGroup[];
}

/** Los grupos de la cuenta de Mailrelay, para elegir destino. */
export async function loadMailrelayGroupsAction(): Promise<GroupsResult> {
  await requireUser();

  const config = await getMailrelayConfig();
  if (!config.ok) {
    return {
      ok: false,
      error: "La conexión con Mailrelay no está configurada. Se pone en Ajustes → Mailrelay.",
    };
  }

  try {
    return { ok: true, groups: await listGroups(config.config) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "No se ha podido hablar con Mailrelay.",
    };
  }
}

const pushSchema = z.object({
  segmentId: z.string().min(1),
  groupId: z.number().int().positive(),
});

export interface PushActionResult {
  ok: boolean;
  error?: string;
  message?: string;
  warnings?: string[];
}

/** Deja el grupo de Mailrelay igual que la audiencia del grupo del CRM. */
export async function pushToMailrelayAction(input: unknown): Promise<PushActionResult> {
  const user = await requireUser();

  const parsed = pushSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Elige un grupo de Mailrelay." };

  const config = await getMailrelayConfig();
  if (!config.ok) {
    return {
      ok: false,
      error: "La conexión con Mailrelay no está configurada. Se pone en Ajustes → Mailrelay.",
    };
  }

  const segment = await prisma.segment.findUnique({
    where: { id: parsed.data.segmentId },
    select: {
      id: true,
      name: true,
      kind: true,
      rulesJson: true,
      onlyWithConsent: true,
      includeAllContacts: true,
    },
  });
  if (!segment) return { ok: false, error: "Ese grupo ya no existe." };

  // El nombre del grupo de destino se lee de Mailrelay y no del navegador: es
  // lo que se va a guardar y a enseñar después, y no puede depender de lo que
  // mande el cliente.
  let grupo: MailrelayGroup | undefined;
  try {
    grupo = (await listGroups(config.config)).find((g) => g.id === parsed.data.groupId);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "No se ha podido hablar con Mailrelay.",
    };
  }
  if (!grupo) return { ok: false, error: "Ese grupo ya no está en tu cuenta de Mailrelay." };

  try {
    const resultado = await pushSegmentToMailrelay({
      config: config.config,
      segment,
      groupId: grupo.id,
      groupName: grupo.name,
      userId: user.id,
    });

    revalidatePath(`/newsletters/${segment.id}`);
    revalidatePath("/newsletters");

    const partes = [`${resultado.added} altas`, `${resultado.kept} ya estaban`];
    if (resultado.removed > 0) partes.push(`${resultado.removed} fuera del grupo`);

    return {
      ok: true,
      message: `«${grupo.name}» actualizado: ${partes.join(", ")}.`,
      warnings: resultado.warnings,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "La subida ha fallado.",
    };
  }
}
