import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { getCompanySettings } from "@/lib/company";
import { verifyAuditChain } from "@/lib/audit";
import { isWooConfigured } from "@/lib/woocommerce";
import { formatDateTime } from "@/lib/format";
import { USER_ROLE_LABELS, type UserRole } from "@/lib/validation";
import { CompanyForm, NewUserForm, PasswordForm } from "./settings-forms";
import {
  changeOwnPasswordAction,
  createUserAction,
  saveCompanySettingsAction,
  toggleUserActiveAction,
} from "./actions";

export const metadata: Metadata = { title: "Ajustes" };

export default async function SettingsPage() {
  const current = await requireUser();
  const canManage = current.role === "OWNER" || current.role === "ADMIN";

  const wooConfigurada = isWooConfigured();

  const [company, users, sequences, chain] = await Promise.all([
    getCompanySettings(),
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    prisma.numberSequence.findMany({ orderBy: [{ docType: "asc" }, { year: "desc" }] }),
    verifyAuditChain(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">Ajustes</h1>
        <p className="page-subtitle">
          Datos del taller, cuentas de acceso y estado de la numeración.
        </p>
      </div>

      {canManage ? (
        <CompanyForm action={saveCompanySettingsAction} values={company} />
      ) : (
        <section className="card card-body text-sm text-slate-600">
          Los datos del emisor solo los puede cambiar una cuenta de administración.
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Integraciones</h2>
        </div>
        <div className="card-body">
          <Link
            href="/ajustes/woocommerce"
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5 transition-colors hover:border-ink-300"
          >
            <span>
              <span className="block text-sm font-medium text-slate-900">WooCommerce</span>
              <span className="block text-xs text-slate-500">
                Importar clientes y pedidos de la tienda
              </span>
            </span>
            <span className={wooConfigurada ? "pill-green" : "pill-slate"}>
              {wooConfigurada ? "Configurada" : "Sin configurar"}
            </span>
          </Link>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">Cuentas de acceso</h2>
          </div>

          {canManage && (
            <div className="card-body">
              <NewUserForm action={createUserAction} />
            </div>
          )}

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Perfil</th>
                  <th>Último acceso</th>
                  {canManage && <th></th>}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className={user.active ? "" : "opacity-60"}>
                    <td>
                      <span className="font-medium text-slate-900">{user.name}</span>
                      <span className="block text-xs text-slate-500">{user.email}</span>
                      {!user.active && <span className="pill-slate mt-1">Desactivada</span>}
                    </td>
                    <td className="text-xs">
                      {USER_ROLE_LABELS[user.role as UserRole] ?? user.role}
                    </td>
                    <td className="text-xs whitespace-nowrap text-slate-500">
                      {user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Nunca"}
                    </td>
                    {canManage && (
                      <td className="text-right">
                        {user.id === current.id ? (
                          <span className="text-xs text-slate-400">Tu cuenta</span>
                        ) : (
                          <form action={toggleUserActiveAction}>
                            <input type="hidden" name="userId" value={user.id} />
                            <button type="submit" className="btn-ghost btn-sm">
                              {user.active ? "Desactivar" : "Activar"}
                            </button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="min-w-0 space-y-5">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Tu contraseña</h2>
            </div>
            <PasswordForm action={changeOwnPasswordAction} />
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Numeración</h2>
            </div>
            {sequences.length === 0 ? (
              <p className="empty">Todavía no se ha emitido ningún documento numerado.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Documento</th>
                      <th>Serie</th>
                      <th>Ejercicio</th>
                      <th className="num">Siguiente</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sequences.map((sequence) => (
                      <tr key={sequence.id}>
                        <td className="text-xs">
                          {sequence.docType === "QUOTE"
                            ? "Presupuestos"
                            : sequence.docType === "ORDER"
                              ? "Pedidos"
                              : sequence.docType === "CUSTOMER"
                                ? "Clientes"
                                : "Facturas"}
                        </td>
                        <td className="font-mono text-xs">{sequence.series}</td>
                        <td className="text-xs">{sequence.year === 0 ? "—" : sequence.year}</td>
                        <td className="num font-mono text-xs">{sequence.next}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Integridad del registro</h2>
            </div>
            <div className="card-body text-sm">
              {chain.ok ? (
                <p className="text-emerald-800">
                  Cadena correcta: {chain.checked} movimientos verificados sin alteraciones.
                </p>
              ) : (
                <p className="text-red-700">
                  La cadena se rompe en el movimiento nº {chain.brokenAt}. Alguien ha modificado el
                  registro directamente en la base de datos.
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                Cada movimiento guarda el hash del anterior. Es el mismo mecanismo que exigirá
                Verifactu para los registros de facturación, ya en marcha con clientes,
                presupuestos y pedidos.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
