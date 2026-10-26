import type { AppSettings, ToolId } from '@shared/types/environment'
import { readSettings, writeSettings } from './settings.repository'

/** Preferencias globales: rutas de ejecutables, WampServer y editor. */

const DEFAULT_SETTINGS: AppSettings = {
  executables: {},
  wampPath: null,
  editorPath: null,
  openEditorOnLaunch: true
}

/** Devuelve las preferencias, completando los valores por defecto. */
export async function getSettings(): Promise<AppSettings> {
  const stored = await readSettings()
  return {
    executables: { ...DEFAULT_SETTINGS.executables, ...(stored?.executables ?? {}) },
    wampPath: stored?.wampPath ?? DEFAULT_SETTINGS.wampPath,
    editorPath: stored?.editorPath ?? DEFAULT_SETTINGS.editorPath,
    openEditorOnLaunch:
      typeof stored?.openEditorOnLaunch === 'boolean'
        ? stored.openEditorOnLaunch
        : DEFAULT_SETTINGS.openEditorOnLaunch
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
    wampPath: changes.wampPath !== undefined ? changes.wampPath?.trim() || null : current.wampPath,
    editorPath:
      changes.editorPath !== undefined ? changes.editorPath?.trim() || null : current.editorPath,
    openEditorOnLaunch:
      typeof changes.openEditorOnLaunch === 'boolean'
        ? changes.openEditorOnLaunch
        : current.openEditorOnLaunch
  }

  await writeSettings(next)
  return next
}
