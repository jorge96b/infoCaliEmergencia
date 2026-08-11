const CLAVE = "mushu-dispositivo";

/**
 * Identidad anónima del navegador.
 *
 * No es autenticación y no pretende serlo: cualquiera puede borrarla o
 * fabricarse otra. Sirve para que un mismo teléfono cuente una sola vez en el
 * consenso y para poder aplicar límites de tasa. Lo que de verdad contiene el
 * abuso son los índices únicos por hora y las medianas de las vistas.
 */
export function idDispositivo(): string {
  if (typeof window === "undefined") return "";

  let id = window.localStorage.getItem(CLAVE);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(CLAVE, id);
  }
  return id;
}

/** UUID nuevo para cada acción, generado antes del primer intento de red. */
export function nuevoClientId(): string {
  return crypto.randomUUID();
}
