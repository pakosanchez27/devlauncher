import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Project } from '@shared/types/project'

/**
 * Repositorio de proyectos: persiste el catálogo en un fichero JSON dentro de
 * la carpeta de datos de usuario de la aplicación.
 *
 * Se escribe de forma atómica (fichero temporal + rename) para no corromper el
 * catálogo si la aplicación se cierra a mitad de escritura.
 */

const STORE_VERSION = 1
const STORE_FILE = 'projects.json'

interface StoreFile {
  version: number
  projects: Project[]
}

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

/** Aparta un fichero ilegible para no bloquear el arranque y permitir diagnóstico. */
async function quarantineCorruptFile(file: string): Promise<void> {
  const backup = `${file}.corrupt-${Date.now()}.bak`
  try {
    await fs.rename(file, backup)
  } catch {
    // Si no se puede mover, se ignora: el catálogo se reinicia vacío.
  }
}

/** Lee el catálogo de proyectos. Devuelve [] si aún no existe o está corrupto. */
export async function readProjects(): Promise<Project[]> {
  const file = storePath()

  let raw: string
  try {
    raw = await fs.readFile(file, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  try {
    const parsed = JSON.parse(raw) as StoreFile
    if (!parsed || !Array.isArray(parsed.projects)) return []
    // Normaliza catálogos anteriores a la versión por proyecto de PHP.
    return parsed.projects.map((project) => ({
      ...project,
      phpPath:
        typeof project.phpPath === 'string' && project.phpPath.trim()
          ? project.phpPath.trim()
          : null
    }))
  } catch {
    await quarantineCorruptFile(file)
    return []
  }
}

/** Escribe el catálogo completo de proyectos de forma atómica. */
export async function writeProjects(projects: Project[]): Promise<void> {
  const file = storePath()
  await fs.mkdir(dirname(file), { recursive: true })

  const payload: StoreFile = { version: STORE_VERSION, projects }
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf-8')
  await fs.rename(temp, file)
}
