import { execFile } from 'node:child_process'
import type { PortInspection, PortOwner } from '@shared/types/environment'
import { isPortAvailable } from './readiness'

/**
 * Gestor de puertos (EP-05).
 *
 * Evita conflictos entre los entornos que DevLauncher tiene en marcha:
 *
 * - Mantiene una **reserva** en memoria de los puertos asignados a cada sesión,
 *   de modo que dos proyectos nunca eligen el mismo puerto aunque el servicio
 *   todavía no esté escuchando.
 * - Inspecciona un puerto ocupado y resuelve **quién** lo ocupa (PID y nombre
 *   del ejecutable), útil para diagnosticar conflictos externos.
 *
 * Las reservas son por propietario (`<projectId>:<servicio>`), así que se
 * pueden liberar en bloque al detener un entorno.
 */

/** Puerto → propietario de la reserva. */
const reservations = new Map<number, string>()

/** Reserva un puerto para un propietario (normalmente `<projectId>:<kind>`). */
export function reservePort(port: number, owner: string): void {
  reservations.set(port, owner)
}

/** Libera un puerto; si se indica `owner`, solo cuando sea suyo. */
export function releasePort(port: number, owner?: string): void {
  if (owner === undefined || reservations.get(port) === owner) {
    reservations.delete(port)
  }
}

/** Libera todos los puertos reservados por un propietario. */
export function releasePortsOf(owner: string): void {
  for (const [port, holder] of reservations) {
    if (holder === owner) reservations.delete(port)
  }
}

/** true si DevLauncher ya reservó el puerto. */
export function isPortReserved(port: number): boolean {
  return reservations.has(port)
}

/** Puertos reservados actualmente (para diagnóstico). */
export function getReservedPorts(): number[] {
  return [...reservations.keys()]
}

/**
 * Busca el primer puerto libre a partir de `start`, saltándose los que ya
 * reservó otro entorno. Devuelve `null` si no encuentra ninguno.
 */
export async function allocatePort(
  start: number,
  owner: string,
  attempts = 20,
  host = '127.0.0.1'
): Promise<number | null> {
  for (let port = start; port < start + attempts; port += 1) {
    if (reservations.has(port)) continue
    if (await isPortAvailable(port, host)) {
      reservations.set(port, owner)
      return port
    }
  }
  return null
}

/** Ejecuta un comando y devuelve su salida (vacía si falla). */
function run(file: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => resolve(error ? '' : stdout)
    )
  })
}

function portFromAddress(address: string): number | null {
  const separator = address.lastIndexOf(':')
  if (separator === -1) return null
  const value = Number(address.slice(separator + 1))
  return Number.isInteger(value) ? value : null
}

/**
 * Localiza el PID que escucha en `port` a partir de `netstat`.
 *
 * Se identifica una escucha porque la dirección remota es comodín
 * (`0.0.0.0:0` / `[::]:0`), sin depender del idioma del sistema.
 */
export function parseListenerPid(netstatOutput: string, port: number): number | null {
  for (const raw of netstatOutput.split(/\r?\n/)) {
    const columns = raw.trim().split(/\s+/)
    if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') continue

    const localPort = portFromAddress(columns[1])
    const remotePort = portFromAddress(columns[2])
    if (localPort !== port || remotePort !== 0) continue

    const pid = Number(columns[columns.length - 1])
    if (Number.isInteger(pid) && pid > 0) return pid
  }
  return null
}

/** Fecha de creación devuelta por PowerShell (`/Date(ms)/` o ISO). */
function parseWindowsDate(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const epoch = value.match(/\/Date\((\d+)\)\//)
  if (epoch) return new Date(Number(epoch[1])).toISOString()

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export interface ProcessInfo {
  pid: number
  name: string | null
  commandLine: string | null
  /** Momento de creación del proceso, en ISO 8601. */
  startedAt: string | null
}

/** Consulta un proceso del sistema por PID (Windows). */
export async function getProcessInfo(pid: number): Promise<ProcessInfo | null> {
  if (process.platform !== 'win32') return null

  const script = [
    `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
    'if ($p) { $p | Select-Object ProcessId,Name,CreationDate,CommandLine | ConvertTo-Json -Compress }'
  ].join('; ')

  const output = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
  if (!output.trim()) return null

  try {
    const parsed = JSON.parse(output) as {
      ProcessId?: number
      Name?: string
      CreationDate?: unknown
      CommandLine?: string
    }
    if (!parsed.ProcessId) return null

    return {
      pid: parsed.ProcessId,
      name: parsed.Name ?? null,
      commandLine: parsed.CommandLine ?? null,
      startedAt: parseWindowsDate(parsed.CreationDate)
    }
  } catch {
    return null
  }
}

/** Resuelve el proceso que escucha en un puerto (Windows). */
export async function findPortOwner(port: number): Promise<PortOwner | null> {
  if (process.platform !== 'win32') return null

  const output = await run('netstat', ['-ano', '-p', 'tcp'])
  const pid = parseListenerPid(output, port)
  if (pid === null) return null

  const info = await getProcessInfo(pid)
  return { pid, name: info?.name ?? null }
}

/** Inspecciona un puerto: disponibilidad, reserva interna y proceso dueño. */
export async function inspectPort(port: number, host = '127.0.0.1'): Promise<PortInspection> {
  const available = await isPortAvailable(port, host)
  return {
    port,
    available,
    reservedByUs: reservations.has(port),
    owner: available ? null : await findPortOwner(port)
  }
}
