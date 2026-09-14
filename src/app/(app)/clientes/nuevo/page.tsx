import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CustomerForm, EMPTY_CUSTOMER } from "../customer-form";
import { createCustomerAction } from "../actions";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">Nuevo cliente</h1>
        <p className="page-subtitle">
          El código de cliente se asigna solo al guardar.
        </p>
      </div>

      <CustomerForm
        action={createCustomerAction}
        values={EMPTY_CUSTOMER}
        cancelHref="/clientes"
        submitLabel="Crear cliente"
      />
    </div>
  );
}
