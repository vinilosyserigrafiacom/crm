"use client";

import { useActionState, useEffect, useState } from "react";
import { ErrorBanner, Field, SubmitButton } from "@/components/ui";
import {
  ADDRESS_KIND_LABELS,
  ADDRESS_KINDS,
  type AddressKind,
} from "@/lib/validation";
import { prefill, prefillChecked, type FormState } from "@/lib/form";

export interface AddressRow {
  id: string;
  kind: string;
  label: string | null;
  line1: string;
  line2: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  countryCode: string;
  isDefault: boolean;
}

type SaveAction = (state: FormState, formData: FormData) => Promise<FormState>;
type DeleteAction = (formData: FormData) => Promise<void>;

function AddressForm({
  address,
  save,
  onDone,
}: {
  address: AddressRow | null;
  save: SaveAction;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(save, {});
  const errors = state.errors ?? {};

  useEffect(() => {
    if (state.message) onDone();
  }, [state.message, onDone]);

  return (
    <form action={formAction} className="space-y-3 rounded-lg bg-slate-50 p-3">
      {address && <input type="hidden" name="addressId" value={address.id} />}
      <ErrorBanner message={state.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tipo" htmlFor="address-kind">
          <select
            id="address-kind"
            name="kind"
            className="input"
            defaultValue={prefill(state, "kind", address?.kind ?? "BILLING")}
          >
            {ADDRESS_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {ADDRESS_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Etiqueta"
          htmlFor="address-label"
          hint="«Nave 2», «Tienda centro»…"
        >
          <input
            id="address-label"
            name="label"
            className="input"
            defaultValue={prefill(state, "label", address?.label ?? "")}
          />
        </Field>
      </div>

      <Field
        label="Dirección"
        htmlFor="address-line1"
        error={errors.line1}
        required
      >
        <input
          id="address-line1"
          name="line1"
          className={`input ${errors.line1 ? "input-error" : ""}`}
          defaultValue={prefill(state, "line1", address?.line1 ?? "")}
          required
          autoFocus
        />
      </Field>
      <Field label="Complemento" htmlFor="address-line2">
        <input
          id="address-line2"
          name="line2"
          className="input"
          defaultValue={prefill(state, "line2", address?.line2 ?? "")}
          placeholder="Piso, puerta, polígono…"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="C.P." htmlFor="address-cp">
          <input
            id="address-cp"
            name="postalCode"
            className="input"
            defaultValue={prefill(
              state,
              "postalCode",
              address?.postalCode ?? "",
            )}
            inputMode="numeric"
          />
        </Field>
        <Field label="Localidad" htmlFor="address-city">
          <input
            id="address-city"
            name="city"
            className="input"
            defaultValue={prefill(state, "city", address?.city ?? "")}
          />
        </Field>
        <Field label="Provincia" htmlFor="address-province">
          <input
            id="address-province"
            name="province"
            className="input"
            defaultValue={prefill(state, "province", address?.province ?? "")}
          />
        </Field>
        <Field label="País" htmlFor="address-country">
          <input
            id="address-country"
            name="countryCode"
            className="input uppercase"
            defaultValue={prefill(
              state,
              "countryCode",
              address?.countryCode ?? "ES",
            )}
            maxLength={2}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          name="isDefault"
          className="h-4 w-4 rounded border-slate-300"
          defaultChecked={prefillChecked(
            state,
            "isDefault",
            address?.isDefault ?? false,
          )}
        />
        Dirección por defecto para este tipo
      </label>

      <div className="flex items-center gap-2">
        <SubmitButton className="btn-primary btn-sm">
          {address ? "Guardar dirección" : "Añadir dirección"}
        </SubmitButton>
        <button type="button" className="btn-ghost btn-sm" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function oneLine(address: AddressRow): string {
  return [
    address.line1,
    address.line2,
    [address.postalCode, address.city].filter(Boolean).join(" "),
    address.province,
    address.countryCode === "ES" ? null : address.countryCode,
  ]
    .filter((part) => part && String(part).trim() !== "")
    .join(" · ");
}

export function AddressesCard({
  addresses,
  save,
  remove,
}: {
  addresses: AddressRow[];
  save: SaveAction;
  remove: DeleteAction;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="card-header">
        <h2 className="card-title">Direcciones</h2>
        {editing !== "new" && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setEditing("new")}
          >
            Añadir dirección
          </button>
        )}
      </div>

      <div className="card-body space-y-3">
        {addresses.length === 0 && editing !== "new" && (
          <p className="text-sm text-slate-500">
            Sin direcciones. Hace falta al menos la de facturación.
          </p>
        )}

        {editing === "new" && (
          <AddressForm
            address={null}
            save={save}
            onDone={() => setEditing(null)}
          />
        )}

        <ul className="divide-y divide-slate-100">
          {addresses.map((address) =>
            editing === address.id ? (
              <li key={address.id} className="py-3">
                <AddressForm
                  address={address}
                  save={save}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li
                key={address.id}
                className="flex flex-wrap items-start gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="pill-slate">
                      {ADDRESS_KIND_LABELS[address.kind as AddressKind] ??
                        address.kind}
                    </span>
                    {address.label && (
                      <span className="font-medium text-slate-900">
                        {address.label}
                      </span>
                    )}
                    {address.isDefault && (
                      <span className="pill-green">Por defecto</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {oneLine(address)}
                  </p>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={() => setEditing(address.id)}
                  >
                    Editar
                  </button>
                  <form action={remove}>
                    <input type="hidden" name="addressId" value={address.id} />
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
