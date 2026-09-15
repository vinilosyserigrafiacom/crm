"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { initials } from "@/lib/format";

interface NavItem {
  href: string;
  label: string;
  /** Ruta base para marcar el apartado como activo también en sus subpáginas. */
  match: string;
  icon: React.ReactNode;
}

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Resumen",
    match: "/",
    icon: <Icon d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  },
  {
    href: "/clientes",
    label: "Clientes",
    match: "/clientes",
    icon: <Icon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />,
  },
  {
    href: "/presupuestos",
    label: "Presupuestos",
    match: "/presupuestos",
    icon: <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5" />,
  },
  {
    href: "/pedidos",
    label: "Pedidos",
    match: "/pedidos",
    icon: <Icon d="M3 7h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 7Zm5 0V5a4 4 0 0 1 8 0v2" />,
  },
  {
    href: "/taller",
    label: "Taller",
    match: "/taller",
    icon: (
      <Icon d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6M9.5 12.5h5" />
    ),
  },
  {
    href: "/catalogo",
    label: "Catálogo",
    match: "/catalogo",
    icon: <Icon d="M4 6h16M4 12h16M4 18h10" />,
  },
  {
    href: "/newsletters",
    label: "Newsletters",
    match: "/newsletters",
    icon: <Icon d="m3 7 9 6 9-6M3 7v10h18V7M3 7l9-4 9 4" />,
  },
  {
    href: "/ajustes",
    label: "Ajustes",
    match: "/ajustes",
    icon: <Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a8.5 8.5 0 0 0-2-1.2L15.6 3h-3.9l-.4 2.5a8.5 8.5 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a8.5 8.5 0 0 0 2 1.2l.4 2.5h3.9l.4-2.5a8.5 8.5 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.06-.4.1-.8.1-1.2Z" />,
  },
];

function isActive(pathname: string, match: string): boolean {
  if (match === "/") return pathname === "/";
  return pathname === match || pathname.startsWith(`${match}/`);
}

export function AppNav({
  user,
}: {
  user: { name: string; email: string; roleLabel: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const links = NAV.map((item) => {
    const active = isActive(pathname, item.match);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-ink-600 text-white"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
        }`}
      >
        {item.icon}
        {item.label}
      </Link>
    );
  });

  return (
    <>
      {/* Barra superior, solo en móvil. */}
      <header className="no-print sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button
          type="button"
          className="btn-ghost -ml-1 p-2"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="nav-lateral"
        >
          <span className="sr-only">{open ? "Cerrar menú" : "Abrir menú"}</span>
          <svg
            viewBox="0 0 24 24"
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        <span className="text-sm font-semibold text-slate-900">CRM Vinilos y Serigrafía</span>
      </header>

      <nav
        id="nav-lateral"
        className={`no-print fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 transition-transform lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 py-4">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink-600 text-sm font-bold text-white">
            VS
          </span>
          <span className="text-sm leading-tight font-semibold text-white">
            Vinilos y
            <br />
            Serigrafía
          </span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="ml-auto rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <span className="sr-only">Cerrar menú</span>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">{links}</div>

        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 px-1 py-1.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold text-white">
              {initials(user.name)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{user.name}</span>
              <span className="block truncate text-xs text-slate-400">{user.roleLabel}</span>
            </span>
          </div>
          <form action="/api/logout" method="post">
            <button
              type="submit"
              className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </nav>

      {/* Fondo oscuro al abrir el menú en móvil. */}
      {open && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30 bg-slate-900/50 lg:hidden"
        />
      )}
    </>
  );
}
