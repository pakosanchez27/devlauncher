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
import type { Framework } from '@shared/types/project'
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
  { port: 3000, label: 'Next.js (dev server)' },
  { port: 8000, label: 'Servidores PHP (artisan, spark, php -S)' },
  { port: 5173, label: 'Dev servers de frontend (Vite)' }
]

/** Requisito comprobable dentro de la carpeta de un proyecto. */
interface RequirementSpec {
  id: string
  label: string
  /** Ruta relativa comprobada (informativa si se usa `present`). */
  target: string
  required: boolean
  hint: string
  /** Comprobación propia; por defecto basta con que exista `target`. */
  present?: () => Promise<boolean>
}

/** Requisito simple: existe una ruta dentro del proyecto. */
function requirementAt(
  id: string,
  label: string,
  target: string,
  required: boolean,
  hint: string
): RequirementSpec {
  return { id, label, target, required, hint }
}

/** Requisitos comunes de un proyecto PHP con Composer. */
function composerRequirements(): RequirementSpec[] {
  return [
    requirementAt(
      'composerJson',
      'composer.json',
      'composer.json',
      true,
      'Sin composer.json no se pueden instalar las dependencias PHP.'
    ),
    requirementAt(
      'vendor',
      'Dependencias PHP (vendor/)',
      'vendor',
      true,
      'Ejecuta «composer install» para generar la carpeta vendor/.'
    ),
    requirementAt(
      'env',
      'Archivo .env',
      '.env',
      false,
      'Copia .env.example a .env y configura la clave de la aplicación.'
    ),
    requirementAt(
      'packageJson',
      'package.json (frontend)',
      'package.json',
      false,
      'Sin package.json no hay frontend que compilar con Vite o Encore.'
    ),
    requirementAt(
      'nodeModules',
      'Dependencias JS (node_modules/)',
      'node_modules',
      false,
      'Ejecuta «npm install» para generar la carpeta node_modules/.'
    )
  ]
}

/** Requisitos comunes de un proyecto Node. */
function nodeRequirements(): RequirementSpec[] {
  return [
    requirementAt(
      'packageJson',
      'package.json',
      'package.json',
      true,
      'Sin package.json no hay forma de arrancar el proyecto.'
    ),
    requirementAt(
      'nodeModules',
      'Dependencias JS (node_modules/)',
      'node_modules',
      true,
      'Ejecuta «npm install» para generar la carpeta node_modules/.'
    )
  ]
}

/**
 * Requisitos de cada framework (EP-10). Se comprueban al arrancar el entorno y
 * desde el panel de requisitos de cada proyecto.
 */
function requirementSpecs(projectPath: string, framework: Framework): RequirementSpec[] {
  switch (framework) {
    case 'laravel':
      return [
        requirementAt(
          'artisan',
          'Artisan (CLI de Laravel)',
          'artisan',
          true,
          'Falta el archivo artisan: no parece un proyecto Laravel completo.'
        ),
        ...composerRequirements()
      ]

    case 'codeigniter': {
      const spark = join(projectPath, 'spark')
      const application = join(projectPath, 'application')
      const system = join(projectPath, 'system')
      return [
        {
          id: 'structure',
          label: 'Estructura (spark o application/ + system/)',
          target: 'spark',
          required: true,
          hint: 'No parece un proyecto CodeIgniter: falta spark (CI4) o las carpetas application/ y system/ (CI3).',
          present: async () =>
            (await pathExists(spark)) ||
            ((await pathExists(application)) && (await pathExists(system)))
        },
        requirementAt(
          'composerJson',
          'composer.json',
          'composer.json',
          false,
          'Sin composer.json no se pueden instalar las dependencias PHP.'
        ),
        requirementAt(
          'vendor',
          'Dependencias PHP (vendor/)',
          'vendor',
          false,
          'Ejecuta «composer install» para generar la carpeta vendor/.'
        )
      ]
    }

    case 'symfony':
      return [
        requirementAt(
          'console',
          'Consola de Symfony (bin/console)',
          join('bin', 'console'),
          true,
          'Falta bin/console: no parece un proyecto Symfony completo.'
        ),
        ...composerRequirements()
      ]

    case 'wordpress':
      return [
        requirementAt(
          'wpConfig',
          'wp-config.php',
          'wp-config.php',
          true,
          'Sin wp-config.php WordPress no puede conectarse a la base de datos.'
        ),
        requirementAt(
          'wpContent',
          'Carpeta wp-content/',
          'wp-content',
          false,
          'Sin wp-content/ faltan temas y plugins (puede ser una instalación personalizada).'
        )
      ]

    case 'nextjs':
    case 'react':
    case 'vue':
    case 'node':
      return nodeRequirements()

    case 'php':
      return [
        requirementAt(
          'index',
          'index.php',
          'index.php',
          false,
          'Sin index.php en la raíz, el servidor integrado no sabrá qué servir.'
        ),
        requirementAt(
          'composerJson',
          'composer.json',
          'composer.json',
          false,
          'Sin composer.json no se pueden instalar las dependencias PHP.'
        ),
        requirementAt(
          'vendor',
          'Dependencias PHP (vendor/)',
          'vendor',
          false,
          'Ejecuta «composer install» para generar la carpeta vendor/.'
        )
      ]

    default:
      return []
  }
}

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

/** Comprueba los requisitos de un proyecto concreto según su framework. */
export async function checkProjectRequirements(
  projectPath: string,
  framework: Framework
): Promise<ProjectRequirementsReport> {
  if (!(await pathExists(projectPath))) {
    throw new Error('La carpeta del proyecto no existe.')
  }

  const specs = requirementSpecs(projectPath, framework)
  const checks: RequirementCheck[] = await Promise.all(
    specs.map(async ({ present, ...spec }) => ({
      ...spec,
      present: await (present ? present() : pathExists(join(projectPath, spec.target)))
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
