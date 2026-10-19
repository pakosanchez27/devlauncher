import { createServer, Socket } from 'node:net'

/**
 * Utilidades de red para comprobar la disponibilidad de puertos y esperar a que
 * un servicio esté listo (EP-04).
 */

/** Espera `ms` milisegundos. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Intenta abrir un servidor en el puerto; false si el sistema lo impide. */
function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

/**
 * true si el puerto está libre (nadie escucha en él).
 *
 * En Windows `SO_REUSEADDR` puede permitir el bind aunque otro proceso esté
 * escuchando, así que se confirma con una conexión real al puerto.
 */
export async function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  if (!(await canBind(port, host))) return false
  return !(await isPortOpen(port, host, 500))
}

/** true si hay algo escuchando en el puerto (intento de conexión puntual). */
export function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    let settled = false

    function finish(value: boolean): void {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/** Espera a que el puerto esté escuchando; devuelve false si se agota el tiempo. */
export async function waitForPort(
  port: number,
  host = '127.0.0.1',
  timeoutMs = 20000,
  intervalMs = 300
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortOpen(port, host)) return true
    await delay(intervalMs)
  }
  return false
}

/** Espera a que una URL responda (cualquier estado por debajo de 500). */
export async function waitForHttp(
  url: string,
  timeoutMs = 20000,
  intervalMs = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const response = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (response.status < 500) return true
    } catch {
      // El servicio todavía no responde; se reintenta.
    }
    await delay(intervalMs)
  }
  return false
}

/** Primer puerto libre a partir de `start` (para no chocar con otros servicios). */
export async function findFreePort(
  start: number,
  host = '127.0.0.1',
  attempts = 20
): Promise<number> {
  for (let port = start; port < start + attempts; port += 1) {
    if (await isPortAvailable(port, host)) return port
  }
  return start
}
