import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type {
  AppSettings,
  EnvironmentReport,
  PortStatus,
  ProjectRequirementsReport,
  RequirementCheck,
  ToolId,
  ToolSource,
  ToolStatus,
  WampStatus
} from '@shared/types/environment'
import { executableName, runCommand } from './command'
import { inspectPort } from './ports.service'
import { getSettings } from './settings.service'

/**
 * Verificador de entorno (EP-03): detección de herramientas, requisitos de
 * proyecto y disponibilidad de puertos.
 */

interface ToolDefinition {
  id: ToolId
  label: string
  base: string
  args: string[]
  required: boolean
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: 'php', label: 'PHP', base: 'php', args: ['-v'], required: true },
  { id: 'node', label: 'Node.js', base: 'node', args: ['-v'], required: true },
  { id: 'npm', label: 'npm', base: 'npm', args: ['-v'], required: true },
  { id: 'composer', label: 'Composer', base: 'composer', args: ['--version'], required: true },
  { id: 'mysql', label: 'MySQL', base: 'mysql', args: ['--version'], required: false }
]

/** Ubicaciones habituales de WampServer en Windows. */
const WAMP_CANDIDATES = ['C:\\wamp64', 'C:\\wamp', 'C:\\wamp32']

const DEFAULT_PORTS: Array<{ port: number; label: string }> = [
  { port: 3306, label: 'MySQL' },
  { port: 8000, label: 'Laravel (artisan serve)' },
  { port: 5173, label: 'Vite (dev server)' }
]

const PROJECT_REQUIREMENTS: Array<Omit<RequirementCheck, 'present'>> = [
  {
    id: 'artisan',
    label: 'Artisan (CLI de Laravel)',
    target: 'artisan',
    required: true,
    hint: 'Falta el archivo artisan: no parece un proyecto Laravel completo.'
  },
  {
    id: 'composerJson',
    label: 'composer.json',
    target: 'composer.json',
    required: true,
    hint: 'Sin composer.json no se pueden instalar las dependencias PHP.'
  },
  {
    id: 'vendor',
    label: 'Dependencias PHP (vendor/)',
    target: 'vendor',
    required: true,
    hint: 'Ejecuta «composer install» para generar la carpeta vendor/.'
  },
  {
    id: 'env',
    label: 'Archivo .env',
    target: '.env',
    required: false,
    hint: 'Copia .env.example a .env y configura la clave de la aplicación.'
  },
  {
    id: 'packageJson',
    label: 'package.json (frontend)',
    target: 'package.json',
    required: false,
    hint: 'Sin package.json no hay frontend que compilar con Vite.'
  },
  {
    id: 'nodeModules',
    label: 'Dependencias JS (node_modules/)',
    target: 'node_modules',
    required: false,
    hint: 'Ejecuta «npm install» para generar la carpeta node_modules/.'
  }
]

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

/** Busca el ejecutable dentro del subdirectorio de versión más reciente. */
async function findLatestExecutable(baseDir: string, relativeExe: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true })
    const versionDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse()

    for (const dir of versionDirs) {
      const candidate = join(baseDir, dir, relativeExe)
      if (await pathExists(candidate)) return candidate
    }
  } catch {
    return null
  }
  return null
}

/** Detecta una instalación de WampServer y localiza PHP y MySQL dentro de ella. */
export async function detectWampServer(settings: AppSettings): Promise<WampStatus> {
  const candidates = [settings.wampPath, ...WAMP_CANDIDATES].filter((value): value is string =>
    Boolean(value)
  )

  for (const root of candidates) {
    if (!(await pathExists(join(root, 'wampmanager.exe')))) continue

    return {
      installed: true,
      path: root,
      phpPath: await findLatestExecutable(join(root, 'bin', 'php'), 'php.exe'),
      mysqlPath: await findLatestExecutable(join(root, 'bin', 'mysql'), join('bin', 'mysql.exe'))
    }
  }

  return { installed: false, path: null, phpPath: null, mysqlPath: null }
}

/** Extrae una versión legible de la salida de un comando. */
function extractVersion(output: string): string | null {
  const firstLine = output
    .split(/\r?\n/)
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (!firstLine) return null
  const match = firstLine.match(/\d+\.\d+(\.\d+)?([-.][\w.]+)?/)
  return match ? match[0] : firstLine.slice(0, 60)
}

function toStatus(
  definition: ToolDefinition,
  available: boolean,
  version: string | null,
  path: string | null,
  source: ToolSource,
  message: string
): ToolStatus {
  return {
    id: definition.id,
    label: definition.label,
    available,
    version,
    path,
    source,
    required: definition.required,
    message
  }
}

/** Detecta una herramienta: ruta configurada → WampServer → PATH. */
async function probeTool(
  definition: ToolDefinition,
  settings: AppSettings,
  wamp: WampStatus
): Promise<ToolStatus> {
  const configured = settings.executables[definition.id]
  if (configured) {
    const result = await runCommand(configured, definition.args)
    if (result.ok) {
      return toStatus(
        definition,
        true,
        extractVersion(result.output),
        configured,
        'configured',
        'Detectado en la ruta configurada.'
      )
    }
    // Si la ruta configurada falla, se sigue con la detección automática.
  }

  const wampPath =
    definition.id === 'php' ? wamp.phpPath : definition.id === 'mysql' ? wamp.mysqlPath : null
  if (wampPath) {
    const result = await runCommand(wampPath, definition.args)
    if (result.ok) {
      return toStatus(
        definition,
        true,
        extractVersion(result.output),
        wampPath,
        'wamp',
        'Detectado dentro de WampServer.'
      )
    }
  }

  const fromPath = executableName(definition.base)
  const result = await runCommand(fromPath, definition.args)
  if (result.ok) {
    return toStatus(
      definition,
      true,
      extractVersion(result.output),
      fromPath,
      'path',
      'Detectado en el PATH del sistema.'
    )
  }

  return toStatus(
    definition,
    false,
    null,
    configured ?? null,
    'none',
    configured
      ? 'La ruta configurada no es válida o no se pudo ejecutar.'
      : 'No se encontró en el PATH del sistema.'
  )
}

/** Resuelve la ruta de un ejecutable concreto (configurada → WampServer → PATH). */
export async function resolveExecutable(id: ToolId): Promise<ToolStatus> {
  const definition = TOOL_DEFINITIONS.find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`Herramienta desconocida: ${id}`)

  const settings = await getSettings()
  const wamp = await detectWampServer(settings)
  return probeTool(definition, settings, wamp)
}

/** Comprueba todas las herramientas y el estado de WampServer. */
export async function checkEnvironment(): Promise<EnvironmentReport> {
  const settings = await getSettings()
  const wamp = await detectWampServer(settings)
  const tools = await Promise.all(TOOL_DEFINITIONS.map((def) => probeTool(def, settings, wamp)))

  return {
    tools,
    wamp,
    missing: tools.filter((tool) => tool.required && !tool.available).map((tool) => tool.label),
    generatedAt: new Date().toISOString()
  }
}

/** Comprueba los requisitos de un proyecto concreto. */
export async function checkProjectRequirements(
  projectPath: string
): Promise<ProjectRequirementsReport> {
  if (!(await pathExists(projectPath))) {
    throw new Error('La carpeta del proyecto no existe.')
  }

  const checks: RequirementCheck[] = await Promise.all(
    PROJECT_REQUIREMENTS.map(async (requirement) => ({
      ...requirement,
      present: await pathExists(join(projectPath, requirement.target))
    }))
  )

  return {
    projectPath,
    checks,
    missing: checks.filter((check) => check.required && !check.present).map((check) => check.label)
  }
}

/** Comprueba la disponibilidad de los puertos habituales del stack. */
export async function checkPorts(): Promise<{ ports: PortStatus[]; generatedAt: string }> {
  const ports = await Promise.all(
    DEFAULT_PORTS.map(async ({ port, label }): Promise<PortStatus> => {
      const inspection = await inspectPort(port)
      return {
        port,
        label,
        available: inspection.available,
        reservedByUs: inspection.reservedByUs,
        owner: inspection.owner
      }
    })
  )

  return { ports, generatedAt: new Date().toISOString() }
}
