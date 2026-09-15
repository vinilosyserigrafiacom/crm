"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireUser } from "@/lib/auth";
import { parseForm, snapshotValues, text, type FormState } from "@/lib/form";
import { testMailrelayConnection } from "@/lib/mailrelay";
import { clearSecret, getMailrelayConfig, saveSecret } from "@/lib/integration-config";

export interface TestResult {
  ok: boolean;
  message: string;
  /** Nombres de los grupos de la cuenta, para ver que se está hablando con la correcta. */
  groups?: string[];
}

/** Comprueba la conexión trayendo los grupos de la cuenta. */
export async function testConnectionAction(): Promise<TestResult> {
  await requireUser();

  const config = await getMailrelayConfig();
  if (!config.ok) {
    return {
      ok: false,
      message: "Faltan la dirección de la cuenta o la clave. Rellénalas aquí arriba y guarda.",
    };
  }

  const resultado = await testMailrelayConnection(config.config);
  return {
    ok: resultado.ok,
    message: resultado.message,
    groups: resultado.groups?.map((g) => g.name),
  };
}

const mailrelayCredentialsSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .min(1, "La dirección de la cuenta es obligatoria")
    .transform((v) => v.replace(/\/+$/, ""))
    .refine((v) => /^https?:\/\//.test(v), "Tiene que empezar por https://"),
  apiKey: z.string().trim().min(1, "La clave de la API es obligatoria"),
});

/** Guarda las credenciales de Mailrelay desde la pantalla. */
export async function saveMailrelayCredentialsAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireRole("OWNER", "ADMIN");

  const anterior = await getMailrelayConfig();
  const escrita = text(formData, "apiKey").trim();
  const apiKey = escrita || (anterior.ok ? anterior.config.apiKey : "");

  const parsed = parseForm(
    mailrelayCredentialsSchema,
    { baseUrl: text(formData, "baseUrl"), apiKey },
    formData,
  );
  if (!parsed.ok) return parsed.state;

  try {
    await saveSecret("mailrelay", { ...parsed.data }, user.id, "Credenciales de Mailrelay guardadas");
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "No se han podido guardar las credenciales.",
      values: snapshotValues(formData),
    };
  }

  revalidatePath("/ajustes");
  revalidatePath("/ajustes/mailrelay");
  return { message: "Credenciales guardadas. Prueba la conexión para comprobarlas." };
}

/** Borra las credenciales guardadas; vuelve a mandar lo que diga el .env. */
export async function clearMailrelayCredentialsAction(): Promise<void> {
  const user = await requireRole("OWNER", "ADMIN");
  await clearSecret("mailrelay", user.id, "Credenciales de Mailrelay borradas");
  revalidatePath("/ajustes");
  revalidatePath("/ajustes/mailrelay");
}
