import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { resolveAudience, toCsv } from "@/lib/segments";

/**
 * Descarga de la lista de destinatarios en CSV.
 *
 * La lista se resuelve en el momento de descargar, no se lee de ningún sitio:
 * si alguien se ha dado de baja hace un minuto, no sale en el fichero.
 *
 * Se deja constancia en el registro de auditoría de cada exportación, con
 * cuántos correos salieron y quién la pidió. Es una copia de datos personales
 * que sale de la aplicación, y conviene poder responder a quién la sacó y
 * cuándo.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const segment = await prisma.segment.findUnique({ where: { id } });
  if (!segment) {
    return NextResponse.json({ error: "El grupo no existe" }, { status: 404 });
  }

  const audiencia = await resolveAudience(segment);
  const csv = toCsv(audiencia.recipients);

  await recordAudit(prisma, {
    userId: user.id,
    entity: "Segment",
    entityId: segment.id,
    action: "UPDATE",
    summary: `Exportados ${audiencia.recipients.length} destinatarios del grupo «${segment.name}»`,
    data: { destinatarios: audiencia.recipients.length },
  });

  // El nombre del grupo lo escribe una persona y acaba en una cabecera HTTP:
  // se deja solo lo alfanumérico para que no pueda colar saltos de línea ni
  // comillas que rompan la cabecera.
  const nombreFichero =
    segment.name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 50) || "grupo";

  const fecha = new Date().toISOString().slice(0, 10);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreFichero}-${fecha}.csv"`,
      // Contiene datos personales: que no se quede en ninguna caché.
      "Cache-Control": "no-store",
    },
  });
}
