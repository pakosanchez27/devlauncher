/**
 * Extrae un mensaje legible de un error lanzado en el proceso principal.
 *
 * Electron envuelve los errores IPC como
 * `Error invoking remote method 'x': Error: <mensaje real>`, así que se toma la
 * última parte para mostrar solo el mensaje de negocio.
 */
export function messageFromError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const marker = raw.lastIndexOf('Error: ')
  return marker >= 0 ? raw.slice(marker + 'Error: '.length) : raw
}
