import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { LaunchServiceKind, ManagedProcessInfo } from '@shared/types/launcher'
import { broadcastLauncherEvent } from './events'

/**
 * Gestor de procesos de larga duración (EP-04).
 *
 * `artisan serve` y `npm run dev` no terminan: se lanzan con `spawn`, se
 * registran y se pueden detener (incluido su árbol de procesos, que en Windows
 * requiere `taskkill /T`). También expone un lanzador "desprendido" para
 * programas externos que no deben quedar bajo nuestro control (WampServer).
 */

export type ManagedProcess = ManagedProcessInfo

interface ManagedProcessInternal extends ManagedProcess {
  child: ChildProcess | null
  log: string[]
  /** true cuando la parada la pedimos nosotros (no es un fallo). */
  stopping: boolean
}

export interface StartProcessOptions {
  projectId: string
  kind: LaunchServiceKind
  label: string
  command: string
  args?: string[]
  cwd?: string
  /** Se invoca con cada línea de salida (stdout + stderr). */
  onLine?: (line: string) => void
  /** Se invoca cuando el proceso termina. */
  onExit?: (code: number | null) => void
}

const MAX_LOG_LINES = 400
const registry = new Map<string, ManagedProcessInternal>()

function quote(token: string): string {
  return /\s/.test(token) ? `"${token}"` : token
}

function toPublic(internal: ManagedProcessInternal): ManagedProcess {
  return {
    id: internal.id,
    projectId: internal.projectId,
    kind: internal.kind,
    label: internal.label,
    command: internal.command,
    pid: internal.pid,
    status: internal.status,
    startedAt: internal.startedAt,
    exitCode: internal.exitCode
  }
}

function emitProcess(internal: ManagedProcessInternal): void {
  broadcastLauncherEvent({ type: 'process', process: toPublic(internal) })
}

/** Lanza un proceso de larga duración y lo registra. */
export function startManagedProcess(options: StartProcessOptions): ManagedProcess {
  const commandLine = [options.command, ...(options.args ?? [])].map(quote).join(' ')

  const child = spawn(commandLine, {
    cwd: options.cwd,
    // `shell` es imprescindible en Windows para resolver lanzadores .cmd/.bat
    // (npm) y para que `taskkill /T` pueda matar todo el árbol de procesos.
    shell: true,
    windowsHide: true,
    env: process.env
  })

  const internal: ManagedProcessInternal = {
    id: randomUUID(),
    projectId: options.projectId,
    kind: options.kind,
    label: options.label,
    command: commandLine,
    pid: child.pid ?? null,
    status: 'running',
    startedAt: new Date().toISOString(),
    exitCode: null,
    child,
    log: [],
    stopping: false
  }
  registry.set(internal.id, internal)

  const handleChunk = (chunk: Buffer | string): void => {
    for (const raw of chunk.toString().split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '')
      if (!line) continue
      internal.log.push(line)
      if (internal.log.length > MAX_LOG_LINES) internal.log.shift()
      options.onLine?.(line)
      broadcastLauncherEvent({
        type: 'log',
        processId: internal.id,
        projectId: internal.projectId,
        line
      })
    }
  }

  child.stdout?.on('data', handleChunk)
  child.stderr?.on('data', handleChunk)

  child.once('error', (error) => {
    internal.status = 'failed'
    internal.exitCode = null
    internal.child = null
    internal.log.push(`[error] ${error.message}`)
    broadcastLauncherEvent({
      type: 'log',
      processId: internal.id,
      projectId: internal.projectId,
      line: `[error] ${error.message}`
    })
    emitProcess(internal)
    options.onExit?.(null)
  })

  child.once('exit', (code) => {
    internal.exitCode = code
    internal.status = internal.stopping ? 'stopped' : code === 0 ? 'stopped' : 'failed'
    internal.child = null
    emitProcess(internal)
    options.onExit?.(code)
  })

  emitProcess(internal)
  return toPublic(internal)
}

/** Detiene un proceso gestionado y todo su árbol. */
export async function stopManagedProcess(id: string): Promise<void> {
  const internal = registry.get(id)
  if (!internal || !internal.child) return

  internal.stopping = true
  const pid = internal.child.pid
  await killTree(pid)
  internal.status = 'stopped'
  internal.child = null
  emitProcess(internal)
}

/** Detiene todos los procesos gestionados de un proyecto. */
export async function stopManagedProcessesForProject(projectId: string): Promise<void> {
  const ids = [...registry.values()]
    .filter((process) => process.projectId === projectId && process.status === 'running')
    .map((process) => process.id)
  await Promise.all(ids.map((id) => stopManagedProcess(id)))
}

/** Detiene todos los procesos gestionados (se usa al cerrar la aplicación). */
export async function stopAllManagedProcesses(): Promise<void> {
  const ids = [...registry.values()]
    .filter((process) => process.status === 'running')
    .map((process) => process.id)
  await Promise.all(ids.map((id) => stopManagedProcess(id)))
}

/** Devuelve un proceso gestionado por su id. */
export function getManagedProcess(id: string): ManagedProcess | null {
  const internal = registry.get(id)
  return internal ? toPublic(internal) : null
}

/** Devuelve las últimas líneas de salida de un proceso. */
export function getManagedProcessLog(id: string): string[] {
  return [...(registry.get(id)?.log ?? [])]
}

/**
 * Lanza un programa externo sin registrarlo (WampServer). Se desprende del
 * proceso de Electron para no cerrarlo al salir de DevLauncher.
 */
export function spawnDetached(command: string, args: string[] = [], cwd?: string): void {
  const commandLine = [command, ...args].map(quote).join(' ')
  const child = spawn(commandLine, {
    cwd,
    shell: true,
    windowsHide: true,
    detached: true,
    stdio: 'ignore'
  })
  child.unref()
}

/** Mata un proceso y su árbol (Windows necesita `taskkill /T /F`). */
function killTree(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve()

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () =>
        resolve()
      )
    })
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // El proceso ya no existe.
  }
  return Promise.resolve()
}
