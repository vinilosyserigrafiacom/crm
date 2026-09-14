import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CRM · Vinilos y Serigrafía",
    template: "%s · CRM Vinilos y Serigrafía",
  },
  description:
    "Gestión de clientes, presupuestos y pedidos de vinilosyserigrafia.com",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
