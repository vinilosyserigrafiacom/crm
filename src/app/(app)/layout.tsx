import { requireUser } from "@/lib/auth";
import { AppNav } from "@/components/app-nav";
import { USER_ROLE_LABELS } from "@/lib/validation";

/**
 * Armazón de las páginas con sesión. Todas las rutas de este grupo pasan por
 * requireUser(), así que ninguna página de dentro necesita comprobar la sesión
 * otra vez para mostrarse.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="min-h-dvh">
      <AppNav
        user={{
          name: user.name,
          email: user.email,
          roleLabel: USER_ROLE_LABELS[user.role] ?? user.role,
        }}
      />
      <main className="lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
