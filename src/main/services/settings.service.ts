import type { AppSettings, ToolId } from '@shared/types/environment'
import { readSettings, writeSettings } from './settings.repository'

/** Preferencias globales: rutas de ejecutables y ruta de WampServer. */

const DEFAULT_SETTINGS: AppSettings = {
  executables: {},
  wampPath: null
}

/** Devuelve las preferencias, completando los valores por defecto. */
export async function getSettings(): Promise<AppSettings> {
  const stored = await readSettings()
  return {
    executables: { ...DEFAULT_SETTINGS.executables, ...(stored?.executables ?? {}) },
    wampPath: stored?.wampPath ?? DEFAULT_SETTINGS.wampPath
  }
}

/**
 * Actualiza las preferencias. Una ruta de ejecutable vacía elimina la
 * configuración manual de esa herramienta (vuelve a la detección automática).
 */
export async function updateSettings(changes: Partial<AppSettings>): Promise<AppSettings> {
  const current = await getSettings()
  const executables: Partial<Record<ToolId, string>> = { ...current.executables }

  if (changes.executables) {
    for (const [key, value] of Object.entries(changes.executables)) {
      const id = key as ToolId
      if (typeof value === 'string' && value.trim()) executables[id] = value.trim()
      else delete executables[id]
    }
  }

  const next: AppSettings = {
    executables,
    wampPath: changes.wampPath !== undefined ? changes.wampPath?.trim() || null : current.wampPath
  }

  await writeSettings(next)
  return next
}
