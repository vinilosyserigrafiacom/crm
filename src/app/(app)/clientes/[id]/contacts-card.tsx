"use client";

import { useActionState, useEffect, useState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import { prefill, prefillChecked, type FormState } from "@/lib/form";

export interface ContactRow {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isPrimary: boolean;
  marketingOptOut: boolean;
}

type SaveAction = (state: FormState, formData: FormData) => Promise<FormState>;
type DeleteAction = (formData: FormData) => Promise<void>;

function ContactForm({
  contact,
  save,
  onDone,
}: {
  contact: ContactRow | null;
  save: SaveAction;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(save, {});
  const errors = state.errors ?? {};

  // Al guardar correctamente el formulario se cierra solo; la lista de arriba
  // ya se ha revalidado en el servidor.
  useEffect(() => {
    if (state.message) onDone();
  }, [state.message, onDone]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg bg-slate-50 p-3">
      {contact && <input type="hidden" name="contactId" value={contact.id} />}
      <ErrorBanner message={state.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Nombre"
          htmlFor="contact-name"
          error={errors.name}
          required
        >
          <input
            id="contact-name"
            name="name"
            className={`input ${errors.name ? "input-error" : ""}`}
            defaultValue={prefill(state, "name", contact?.name ?? "")}
            required
            autoFocus
          />
        </Field>
        <Field label="Cargo" htmlFor="contact-job">
          <input
            id="contact-job"
            name="jobTitle"
            className="input"
            defaultValue={prefill(state, "jobTitle", contact?.jobTitle ?? "")}
            placeholder="Compras, diseño, gerencia…"
          />
        </Field>
        <Field label="Correo" htmlFor="contact-email">
          <input
            id="contact-email"
            name="email"
            type="email"
            className="input"
            defaultValue={prefill(state, "email", contact?.email ?? "")}
          />
        </Field>
        <Field label="Teléfono" htmlFor="contact-phone">
          <input
            id="contact-phone"
            name="phone"
            className="input"
            defaultValue={prefill(state, "phone", contact?.phone ?? "")}
          />
        </Field>
      </div>

      <Field label="Notas" htmlFor="contact-notes">
        <input
          id="contact-notes"
          name="notes"
          className="input"
          defaultValue={prefill(state, "notes", contact?.notes ?? "")}
        />
      </Field>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="isPrimary"
            className="h-4 w-4 rounded border-slate-300"
            defaultChecked={prefillChecked(state, "isPrimary", contact?.isPrimary ?? false)}
          />
          Contacto principal
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="marketingOptOut"
            className="h-4 w-4 rounded border-slate-300"
            defaultChecked={prefillChecked(
              state,
              "marketingOptOut",
              contact?.marketingOptOut ?? false,
            )}
          />
          De baja de las newsletters
        </label>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn-primary btn-sm">
          {contact ? "Guardar contacto" : "Añadir contacto"}
        </SubmitButton>
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function ContactsCard({
  contacts,
  save,
  remove,
}: {
  contacts: ContactRow[];
  save: SaveAction;
  remove: DeleteAction;
}) {
  // null = nada abierto, "new" = formulario de alta, un id = edición.
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Contactos</h2>
        {editing !== "new" && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setEditing("new")}
          >
            Añadir contacto
          </button>
        )}
      </div>

      <div className="card-body space-y-3">
        {contacts.length === 0 && editing !== "new" && (
          <p className="text-sm text-slate-500">
            Sin contactos. Añade la persona con la que se habla en este cliente.
          </p>
        )}

        {editing === "new" && (
          <ContactForm
            contact={null}
            save={save}
            onDone={() => setEditing(null)}
          />
        )}

        <ul className="divide-y divide-slate-100">
          {contacts.map((contact) =>
            editing === contact.id ? (
              <li key={contact.id} className="py-3">
                <ContactForm
                  contact={contact}
                  save={save}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={contact.id}
                className="flex flex-wrap items-start gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-900">
                    {contact.name}
                    {contact.isPrimary && (
                      <span className="pill-green">Principal</span>
                    )}
                    {contact.marketingOptOut && (
                      <span className="pill-slate">Sin newsletters</span>
                    )}
                  </p>
                  {contact.jobTitle && (
                    <p className="text-xs text-slate-500">{contact.jobTitle}</p>
                  )}
                  <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="hover:underline"
                      >
                        {contact.email}
                      </a>
                    )}
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="hover:underline"
                      >
                        {contact.phone}
                      </a>
                    )}
                  </p>
                  {contact.notes && (
                    <p className="mt-1 text-xs text-slate-500">
                      {contact.notes}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditing(contact.id)}
                  >
                    Editar
                  </button>
                  <form action={remove}>
                    <input type="hidden" name="contactId" value={contact.id} />
                    <button
                      type="submit"
                      className="btn-ghost btn-sm text-red-600 hover:bg-red-50"
                    >
                      Borrar
                    </button>
                  </form>
                </div>
              </li>
            ),
          )}
        </ul>
      </div>
    </section>
  );
}
