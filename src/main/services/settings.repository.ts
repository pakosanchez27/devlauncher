import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { AppSettings } from '@shared/types/environment'

/**
 * Persistencia de las preferencias globales en `settings.json` dentro de la
 * carpeta de datos de usuario, con escritura atómica.
 */

const SETTINGS_FILE = 'settings.json'

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

export async function readSettings(): Promise<Partial<AppSettings> | null> {
  const file = settingsPath()
  try {
    const raw = await fs.readFile(file, 'utf-8')
    return JSON.parse(raw) as Partial<AppSettings>
  } catch {
    return null
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  const file = settingsPath()
  await fs.mkdir(dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(settings, null, 2), 'utf-8')
  await fs.rename(temp, file)
}
