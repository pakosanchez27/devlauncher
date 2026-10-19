import { execFile, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import type { LaunchServiceKind, ManagedProcessInfo } from '@shared/types/launcher'
import { broadcastLauncherEvent } from './events'
import {
  readPersistedProcesses,
  writePersistedProcesses,
  type PersistedProcess
} from './process.repository'
import { getProcessInfo } from './ports.service'

/**
 * Gestor de procesos de larga duración (EP-04 / EP-05).
 *
 * `artisan serve` y `npm run dev` no terminan: se lanzan con `spawn`, se
 * registran y se pueden detener (incluido su árbol de procesos, que en Windows
 * requiere `taskkill /T`). El registro se persiste para poder limpiar procesos
 * huérfanos tras un cierre anómalo. También expone un lanzador "desprendido"
 * para programas externos que no deben quedar bajo nuestro control
 * (WampServer).
 */

export type ManagedProcess = ManagedProcessInfo

interface ManagedProcessInternal extends ManagedProcess {
  projectPath: string
  child: ChildProcess | null
  log: string[]
  /** true cuando la parada la pedimos nosotros (no es un fallo). */
  stopping: boolean
}

export interface StartProcessOptions {
  projectId: string
  projectPath: string
  kind: LaunchServiceKind
  label: string
  command: string
  args?: string[]
  cwd?: string
  /** Puertos reservados para este proceso. */
  ports?: number[]
  /** Se invoca con cada línea de salida (stdout + stderr). */
  onLine?: (line: string) => void
  /** Se invoca cuando el proceso termina (después de actualizar su estado). */
  onExit?: (code: number | null) => void
}

const MAX_LOG_LINES = 400
/** Cuánto puede diferir la fecha real de creación del PID de la registrada. */
const ORPHAN_TOLERANCE_MS = 15000
/** Los procesos terminados se conservan un rato para poder consultarlos. */
const STOPPED_RETENTION_MS = 10 * 60 * 1000

const registry = new Map<string, ManagedProcessInternal>()
let persistQueue: Promise<void> = Promise.resolve()

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
    ports: [...internal.ports],
    status: internal.status,
    startedAt: internal.startedAt,
    exitCode: internal.exitCode
  }
}

function emitProcess(internal: ManagedProcessInternal): void {
  broadcastLauncherEvent({ type: 'process', process: toPublic(internal) })
}

/** Guarda una instantánea de los procesos vivos (escrituras en serie). */
function persistSnapshot(): void {
  const snapshot: PersistedProcess[] = [...registry.values()]
    .filter((process) => process.status === 'running' && process.pid !== null)
    .map((process) => ({
      id: process.id,
      projectId: process.projectId,
      projectPath: process.projectPath,
      kind: process.kind,
      pid: process.pid,
      command: process.command,
      startedAt: process.startedAt,
      ports: [...process.ports]
    }))

  persistQueue = persistQueue
    .then(() => writePersistedProcesses(snapshot))
    .catch(() => {
      // Persistir es best-effort: no debe interrumpir el arranque.
    })
}

/** Elimina del registro los procesos terminados hace mucho tiempo. */
function pruneRegistry(): void {
  const cutoff = Date.now() - STOPPED_RETENTION_MS
  for (const [id, process] of registry) {
    if (process.status === 'running') continue
    if (Date.parse(process.startedAt) < cutoff) registry.delete(id)
  }
}

/** Lanza un proceso de larga duración y lo registra. */
export function startManagedProcess(options: StartProcessOptions): ManagedProcess {
  pruneRegistry()

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
    projectPath: options.projectPath,
    kind: options.kind,
    label: options.label,
    command: commandLine,
    pid: child.pid ?? null,
    ports: options.ports ?? [],
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
    persistSnapshot()
    emitProcess(internal)
    options.onExit?.(null)
  })

  child.once('exit', (code) => {
    internal.exitCode = code
    internal.status = internal.stopping ? 'stopped' : code === 0 ? 'stopped' : 'failed'
    internal.child = null
    persistSnapshot()
    emitProcess(internal)
    options.onExit?.(code)
  })

  persistSnapshot()
  emitProcess(internal)
  return toPublic(internal)
}

/** Detiene un proceso gestionado y todo su árbol. */
export async function stopManagedProcess(id: string): Promise<void> {
  const internal = registry.get(id)
  if (!internal) return

  if (!internal.child) {
    if (internal.status === 'running') {
      internal.status = 'stopped'
      persistSnapshot()
      emitProcess(internal)
    }
    return
  }

  internal.stopping = true
  const pid = internal.child.pid
  await killTree(pid)
  internal.status = 'stopped'
  internal.child = null
  persistSnapshot()
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
  await persistQueue
}

/** Devuelve un proceso gestionado por su id. */
export function getManagedProcess(id: string): ManagedProcess | null {
  const internal = registry.get(id)
  return internal ? toPublic(internal) : null
}

/** Lista todos los procesos gestionados (los vivos primero). */
export function listManagedProcesses(): ManagedProcess[] {
  return [...registry.values()].map(toPublic).sort((a, b) => {
    const running = Number(b.status === 'running') - Number(a.status === 'running')
    if (running !== 0) return running
    return b.startedAt.localeCompare(a.startedAt)
  })
}

/** Devuelve las últimas líneas de salida de un proceso. */
export function getManagedProcessLog(id: string): string[] {
  return [...(registry.get(id)?.log ?? [])]
}

/**
 * Mata los procesos que quedaron vivos de una ejecución anterior (cierre
 * anómalo). Solo actúa cuando el PID sigue existiendo y su fecha de creación
 * coincide con la registrada, para no matar un proceso ajeno que reutilizó el
 * PID. Devuelve cuántos procesos se limpiaron.
 */
export async function cleanupOrphanedProcesses(): Promise<number> {
  const persisted = await readPersistedProcesses()
  if (persisted.length === 0) return 0

  let cleaned = 0
  for (const entry of persisted) {
    if (!entry.pid) continue

    const info = await getProcessInfo(entry.pid)
    if (!info?.startedAt) continue

    const recorded = Date.parse(entry.startedAt)
    const actual = Date.parse(info.startedAt)
    if (!Number.isFinite(recorded) || !Number.isFinite(actual)) continue
    if (Math.abs(actual - recorded) > ORPHAN_TOLERANCE_MS) continue

    await killTree(entry.pid)
    cleaned += 1
  }

  await writePersistedProcesses([])
  return cleaned
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
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true, timeout: 10000 },
        () => resolve()
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
