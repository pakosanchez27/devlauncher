import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { shell } from 'electron'
import type { ExternalOpenResult } from '@shared/types/environment'
import { runCommand } from './command'

/**
 * Apertura de la aplicación en el navegador (EP-07).
 *
 * Se usa el navegador configurado en «Entorno» y, si no hay ninguno o falla, el
 * navegador predeterminado de Windows. Solo se admiten direcciones `http` y
 * `https`: el renderer nunca decide qué programa abre una ruta arbitraria.
 */

/** true si la cadena es una URL web válida (http/https). */
function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Abre una URL web en el navegador configurado o en el predeterminado. */
export async function openUrlInBrowser(
  url: string,
  configured: string | null
): Promise<ExternalOpenResult> {
  if (!isWebUrl(url)) {
    return {
      opened: false,
      program: null,
      message: `La dirección «${url}» no es una URL web válida.`
    }
  }

  if (configured && existsSync(configured)) {
    const result = await runCommand(configured, [url], 15000)
    if (result.ok) {
      const program = basename(configured)
      return { opened: true, program, message: `Aplicación abierta en ${program}.` }
    }
  }

  try {
    await shell.openExternal(url)
    return {
      opened: true,
      program: 'Navegador predeterminado',
      message: configured
        ? 'No se pudo usar el navegador configurado; la aplicación se abrió en el navegador predeterminado.'
        : 'Aplicación abierta en el navegador predeterminado.'
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    return {
      opened: false,
      program: null,
      message: `No se pudo abrir el navegador: ${detail}`
    }
  }
}
