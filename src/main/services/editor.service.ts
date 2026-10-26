import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { shell } from 'electron'
import type { ExternalOpenResult } from '@shared/types/environment'
import { runCommand } from './command'

/**
 * Apertura del proyecto en el editor (EP-12).
 *
 * Al arrancar el entorno, DevLauncher abre la carpeta del proyecto para que se
 * pueda trabajar mientras los servicios levantan. El orden de preferencia es:
 *
 *   1. La ruta configurada en «Entorno» (sirve para VS Code, Cursor, etc.).
 *   2. Visual Studio Code en el PATH (`code.cmd`).
 *   3. La instalación habitual de VS Code en Windows.
 *   4. El explorador de Windows con la carpeta abierta (último recurso).
 *
 * Nunca lanza una excepción: un editor que no se puede abrir no debe impedir
 * que el entorno arranque.
 */

/** Instalaciones habituales de Visual Studio Code en Windows. */
function vscodeCandidates(): string[] {
  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : null,
    process.env.ProgramFiles ?? null,
    process.env['ProgramFiles(x86)'] ?? null
  ].filter((root): root is string => Boolean(root))

  return roots.map((root) => join(root, 'Microsoft VS Code', 'bin', 'code.cmd'))
}

/** Nombre legible del editor a partir de su ejecutable. */
function editorLabel(executable: string): string {
  const file = basename(executable).toLowerCase()
  if (file.startsWith('code') || file === 'code.cmd') return 'Visual Studio Code'
  if (file.startsWith('cursor')) return 'Cursor'
  return basename(executable)
}

/** Busca Visual Studio Code en el PATH (`code.cmd`, el lanzador de la CLI). */
async function findEditorOnPath(): Promise<string | null> {
  const probe =
    process.platform === 'win32'
      ? await runCommand('where.exe', ['code.cmd'])
      : await runCommand('which', ['code'])

  if (!probe.ok) return null
  const first = probe.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
  return first ?? null
}

/** Resuelve el ejecutable del editor: configurado → PATH → instalación típica. */
async function resolveEditor(configured: string | null): Promise<string | null> {
  if (configured && existsSync(configured)) return configured

  const fromPath = await findEditorOnPath()
  if (fromPath) return fromPath

  return vscodeCandidates().find((candidate) => existsSync(candidate)) ?? null
}

/**
 * Abre la carpeta de un proyecto en el editor configurado (o en VS Code) y, si
 * no hay editor, en el explorador de Windows.
 */
export async function openProjectInEditor(
  projectPath: string,
  configured: string | null
): Promise<ExternalOpenResult> {
  if (!existsSync(projectPath)) {
    return {
      opened: false,
      program: null,
      message: 'La carpeta del proyecto ya no existe; no se pudo abrir el editor.'
    }
  }

  const editor = await resolveEditor(configured)
  if (editor) {
    const result = await runCommand(editor, [projectPath], 15000)
    if (result.ok) {
      return {
        opened: true,
        program: editorLabel(editor),
        message: `Proyecto abierto en ${editorLabel(editor)}.`
      }
    }
  }

  // Sin editor disponible (o si falló): al menos se abre la carpeta.
  const failure = await shell.openPath(projectPath)
  if (!failure) {
    return {
      opened: true,
      program: 'Explorador de Windows',
      message:
        'No se encontró Visual Studio Code; se abrió la carpeta en el Explorador. Indica tu editor en «Entorno».'
    }
  }

  return {
    opened: false,
    program: null,
    message: `No se pudo abrir el proyecto en el editor: ${failure}`
  }
}
