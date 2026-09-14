import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { CustomerForm } from "../../customer-form";
import { updateCustomerAction } from "../../actions";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) notFound();

  // La acción se enlaza al id aquí: así el formulario no necesita llevar el id
  // en un campo oculto que alguien pudiera cambiar.
  const action = updateCustomerAction.bind(null, customer.id);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="page-title">{customer.legalName}</h1>
        <p className="page-subtitle">Editando el cliente {customer.code}.</p>
      </div>

      <CustomerForm
        action={action}
        values={customer}
        cancelHref={`/clientes/${customer.id}`}
        submitLabel="Guardar cambios"
      />
    </div>
  );
}
