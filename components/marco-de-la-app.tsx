"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ajusteAlTeclado } from "@/lib/pantalla-telefono";

/**
 * El marco de la app (retrabajo del ítem 4, punto c, 06/11/2026). En la
 * computadora es el `h-dvh` de siempre. En el ancho del teléfono, sigue a la
 * parte visible de la página: con el teclado abierto cubre justo lo que se
 * ve, así el encabezado del chat (con el nombre del contacto) y la barra de
 * «← Conversaciones» no salen de la vista; al cerrarlo vuelve al alto entero
 * y la página vuelve arriba, así no queda corrida.
 */
export function MarcoDeLaApp({ children }: { children: ReactNode }) {
  const [estilo, setEstilo] = useState<CSSProperties | undefined>(undefined);

  useEffect(() => {
    const vv = window.visualViewport;
    const telefono = window.matchMedia("(max-width: 767.98px)");
    if (!vv) return;
    let cuadro = 0;
    const medir = () => {
      cancelAnimationFrame(cuadro);
      cuadro = requestAnimationFrame(() => {
        const ajuste = telefono.matches ? ajusteAlTeclado(vv) : null;
        if (!ajuste) {
          setEstilo(undefined);
          return;
        }
        setEstilo({ position: "fixed", left: 0, right: 0, top: 0, height: `${ajuste.alto}px`, transform: `translateY(${ajuste.arriba}px)` });
        // Al cerrar el teclado, la página puede quedar corrida: se la vuelve arriba.
        if (ajuste.arriba === 0 && window.scrollY !== 0) window.scrollTo(0, 0);
      });
    };
    medir();
    vv.addEventListener("resize", medir);
    vv.addEventListener("scroll", medir);
    telefono.addEventListener("change", medir);
    return () => {
      cancelAnimationFrame(cuadro);
      vv.removeEventListener("resize", medir);
      vv.removeEventListener("scroll", medir);
      telefono.removeEventListener("change", medir);
    };
  }, []);

  return (
    <div className="flex h-dvh flex-col md:flex-row" style={estilo}>
      {children}
    </div>
  );
}
