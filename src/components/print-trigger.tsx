"use client";

import { useEffect } from "react";

/**
 * Abre el diálogo de impresión al entrar en la página.
 *
 * Desde ahí, "Guardar como PDF" del navegador genera el PDF que se manda al
 * cliente. Es una dependencia menos que generar el PDF en el servidor, y el
 * resultado usa las fuentes y los márgenes que ya define la hoja de estilos.
 */
export function PrintTrigger() {
  useEffect(() => {
    // Un margen mínimo para que el navegador acabe de pintar la hoja antes de
    // abrir el diálogo; si no, Chrome imprime a veces la página a medio montar.
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

export function PrintButton() {
  return (
    <button type="button" className="btn-secondary" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
