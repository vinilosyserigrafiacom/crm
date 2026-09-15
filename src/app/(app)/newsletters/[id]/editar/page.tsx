import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadSuggestions, parseRules } from "@/lib/segments";
import { SegmentForm } from "../../segment-form";
import { updateSegmentAction } from "../../actions";

export const metadata: Metadata = { title: "Editar grupo" };

export default async function EditSegmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const segment = await prisma.segment.findUnique({ where: { id } });
  if (!segment) notFound();

  const sugerencias = await loadSuggestions();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">{segment.name}</h1>
        <p className="page-subtitle">Editando el grupo.</p>
      </div>

      <SegmentForm
        action={updateSegmentAction.bind(null, segment.id)}
        sugerencias={sugerencias}
        cancelHref={`/newsletters/${segment.id}`}
        submitLabel="Guardar cambios"
        values={{ ...segment, rules: parseRules(segment.rulesJson) }}
      />
    </div>
  );
}
