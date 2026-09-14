import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Acceder" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-ink-600 text-sm font-bold text-white">
            VS
          </span>
          <div>
            <h1 className="text-lg leading-tight font-semibold text-slate-900">
              CRM Vinilos y Serigrafía
            </h1>
            <p className="text-sm text-slate-500">vinilosyserigrafia.com</p>
          </div>
        </div>

        <div className="card">
          <div className="card-body">
            <LoginForm next={next ?? ""} />
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-slate-500">
          Acceso restringido al personal del taller.
        </p>
      </div>
    </div>
  );
}
