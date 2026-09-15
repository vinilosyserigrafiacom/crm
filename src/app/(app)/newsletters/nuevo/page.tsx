import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { EMPTY_RULES, loadSuggestions } from "@/lib/segments";
import { SegmentForm } from "../segment-form";
import { createSegmentAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo grupo" };

export default async function NewSegmentPage() {
  await requireUser();
  const sugerencias = await loadSuggestions();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Nuevo grupo</h1>
        <p className="page-subtitle">
          Una lista fija si quieres elegir tú a quién escribes, o un grupo por reglas si
          prefieres que se mantenga solo al día.
        </p>
      </div>

      <SegmentForm
        action={createSegmentAction}
        sugerencias={sugerencias}
        cancelHref="/newsletters"
        submitLabel="Crear grupo"
        values={{
          name: "",
          description: null,
          kind: "STATIC",
          onlyWithConsent: true,
          includeAllContacts: false,
          active: true,
          rules: EMPTY_RULES,
        }}
      />
    </div>
  );
}
