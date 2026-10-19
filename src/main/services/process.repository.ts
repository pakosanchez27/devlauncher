import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { LaunchServiceKind } from '@shared/types/launcher'

/**
 * Persistencia del registro de procesos gestionados (EP-05).
 *
 * Sirve para reconciliar procesos huérfanos: si DevLauncher se cierra de forma
 * anómala, `artisan serve` y Vite pueden sobrevivir y seguir ocupando sus
 * puertos. Al arrancar se comparan los PID guardados con los procesos reales y
 * se matan solo los que siguen vivos y coinciden en fecha de creación.
 */

const STORE_FILE = 'processes.json'
const STORE_VERSION = 1

export interface PersistedProcess {
  id: string
  projectId: string
  projectPath: string
  kind: LaunchServiceKind
  pid: number | null
  command: string
  startedAt: string
  ports: number[]
}

interface StoreFile {
  version: number
  processes: PersistedProcess[]
}

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

/** Lee los procesos persistidos. Devuelve [] si no existe o está corrupto. */
export async function readPersistedProcesses(): Promise<PersistedProcess[]> {
  try {
    const raw = await fs.readFile(storePath(), 'utf-8')
    const parsed = JSON.parse(raw) as StoreFile
    if (!parsed || !Array.isArray(parsed.processes)) return []
    return parsed.processes
  } catch {
    return []
  }
}

/** Guarda el registro completo de forma atómica. */
export async function writePersistedProcesses(processes: PersistedProcess[]): Promise<void> {
  const file = storePath()
  await fs.mkdir(dirname(file), { recursive: true })

  const payload: StoreFile = { version: STORE_VERSION, processes }
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(temp, file)
}
