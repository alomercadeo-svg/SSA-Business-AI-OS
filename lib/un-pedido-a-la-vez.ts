/**
 * Un solo pedido de la lista de la bandeja en curso por pestaña (retrabajo de
 * F35, 04/11/2026, decidido por Marcos).
 *
 * Hasta ese día, cada pausa de más de 300 ms mientras se escribía disparaba un
 * pedido nuevo a la ruta, y los anteriores seguían corriendo en la base aunque
 * su respuesta se ignorara: buscar «catalina vasquez» disparó cuatro, que
 * tardaron de 4,2 a 6,2 s (medido en el navegador de Marcos).
 *
 * Ahora:
 * - `escribir` espera `esperaMs` desde la última llamada (la espera de las
 *   teclas, que antes estaba en la lista) y después pide.
 * - `pedirYa` pide sin espera (pestañas y filtros).
 * - Mientras un pedido está en curso no sale otro: lo nuevo queda guardado, y
 *   lo más nuevo reemplaza a lo guardado. Cuando el pedido vuelve, si lo
 *   guardado es distinto, su respuesta se ignora y sale uno solo con lo
 *   guardado; si no, se usa.
 * - Pedir lo mismo que ya se ve, sin nada en curso, no pide nada.
 *
 * Un cambio de pestaña o de filtro con una búsqueda en curso espera a que esa
 * búsqueda vuelva (aceptado por Marcos el 04/11/2026).
 *
 * `volverAPedir` (F35, tramo C de S8) pide aunque lo pedido sea lo que ya se
 * ve: después de guardar el próximo seguimiento, la lista tiene que volver a
 * preguntarle al servidor. Si hay uno en curso, su respuesta puede ser de antes
 * del cambio: se descarta, y sale uno solo cuando vuelve.
 *
 * Sin React ni nada de servidor: la usa `components/inbox/conversation-list.tsx`.
 */
export interface OpcionesDelPedido<T, R> {
  esperaMs: number;
  /** Lo que ya se ve (lo que trajo el servidor con la página). */
  inicial: T;
  igual: (a: T, b: T) => boolean;
  ejecutar: (args: T) => Promise<R>;
  aplicar: (args: T, resultado: R) => void;
  alFallar?: (args: T, error: unknown) => void;
  /** Verdadero mientras hay un pedido en curso o uno guardado. */
  alCambiarOcupado?: (ocupado: boolean) => void;
}

export interface UnPedidoALaVez<T> {
  escribir(args: T): void;
  pedirYa(args: T): void;
  volverAPedir(args: T): void;
  /** Lo que se ve cambió por otro camino (por ejemplo, la página nueva del servidor). */
  seVe(args: T): void;
  cancelar(): void;
}

export function crearUnPedidoALaVez<T, R>(o: OpcionesDelPedido<T, R>): UnPedidoALaVez<T> {
  let visto: T = o.inicial;
  let enCurso: T | null = null;
  let guardado: T | null = null;
  // Lo guardado sale aunque sea igual a lo que está en curso (volverAPedir).
  let forzar = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const avisar = () => o.alCambiarOcupado?.(enCurso !== null || guardado !== null);

  function lanzar(args: T) {
    enCurso = args;
    avisar();
    o.ejecutar(args).then(
      (r) => terminar(args, true, () => o.aplicar(args, r)),
      (e) => terminar(args, false, () => o.alFallar?.(args, e)),
    );
  }

  function terminar(args: T, salioBien: boolean, usar: () => void) {
    const siguiente = guardado;
    const repetir = forzar;
    guardado = null;
    forzar = false;
    enCurso = null;
    if (siguiente !== null && (repetir || !o.igual(siguiente, args))) {
      // La respuesta es vieja: se ignora, y sale uno solo con lo último.
      lanzar(siguiente);
      return;
    }
    // Solo lo que salió bien pasa a ser lo que se ve: un fallo se reintenta.
    if (salioBien) visto = args;
    usar();
    avisar();
  }

  function pedirYa(args: T) {
    if (timer) clearTimeout(timer);
    timer = null;
    if (enCurso !== null) {
      guardado = args;
      avisar();
      return;
    }
    if (o.igual(args, visto)) return;
    lanzar(args);
  }

  return {
    escribir(args: T) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        pedirYa(args);
      }, o.esperaMs);
    },
    pedirYa,
    volverAPedir(args: T) {
      if (timer) clearTimeout(timer);
      timer = null;
      if (enCurso !== null) {
        guardado = args;
        forzar = true;
        avisar();
        return;
      }
      lanzar(args);
    },
    seVe(args: T) {
      visto = args;
    },
    // Solo la espera de las teclas: un pedido en curso termina igual. React,
    // en desarrollo, desmonta y vuelve a montar, y apagarla del todo la
    // dejaría sin funcionar.
    cancelar() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
