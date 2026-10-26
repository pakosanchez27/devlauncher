import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { frameworkLabel } from '@shared/constants/frameworks'
import type { LaunchStepId } from '@shared/types/launcher'
import type { Framework, Project } from '@shared/types/project'

/**
 * Plan de arranque por framework (EP-10).
 *
 * Traduce el tipo de proyecto detectado a los pasos que hay que ejecutar y al
 * comando concreto de cada servicio:
 *
 * - **PHP con servidor propio**: `artisan serve` (Laravel) o `spark serve`
 *   (CodeIgniter 4).
 * - **PHP sin servidor propio**: el servidor integrado de PHP
 *   (`php -S 127.0.0.1:<puerto>`) sirviendo el document root adecuado.
 * - **Node**: `npm run dev`, que anuncia su URL (Vite, Next.js, Nuxt…).
 * - **Frontend de un proyecto PHP**: `npm run dev` con Vite, si el proyecto lo
 *   declara.
 *
 * El plan es la única fuente de verdad: el motor no decide nada por framework,
 * solo ejecuta lo que aquí se describe.
 */

/** Puerto inicial donde se buscan puertos libres para servidores PHP. */
export const APP_PORT_START = 8000
/** Puerto habitual del servidor de Vite (y de otros dev servers de frontend). */
export const VITE_PORT = 5173
/** Puerto habitual de Next.js. */
export const NEXT_PORT = 3000

/** Comando que ejecuta un servicio, con el puerto ya resuelto. */
export interface LaunchCommand {
  /** Ejecutable que hay que resolver antes de lanzar el proceso. */
  tool: 'php' | 'npm'
  /** Nombre visible del servicio y del paso. */
  label: string
  /** Argumentos del comando; `port` es el puerto asignado (0 si no aplica). */
  args: (port: number) => string[]
}

/** Servidor principal del proyecto. */
export interface ServerCommand extends LaunchCommand {
  kind: 'php' | 'node'
  /** true si DevLauncher elige el puerto libre y lo pasa en los argumentos. */
  allocatesPort: boolean
  /** Puerto con el que arranca el servidor por su cuenta (solo Node). */
  defaultPort: number | null
}

/** De dónde se saca la configuración de base de datos del proyecto. */
export type DatabaseSource = 'dotenv' | 'wordpress' | 'none'

export interface DatabasePlan {
  source: DatabaseSource
  /** Motivo legible cuando el proyecto no necesita base de datos. */
  reason: string
}

interface PlanBase {
  framework: Framework
  steps: Array<{ id: LaunchStepId; label: string }>
  database: DatabasePlan
}

export type LaunchPlan =
  | (PlanBase & {
      supported: true
      server: ServerCommand
      frontend: LaunchCommand | null
    })
  | (PlanBase & {
      supported: false
      /** Motivo por el que el framework no se puede arrancar. */
      reason: string
    })

const STEPS = {
  requirements: 'Requisitos del proyecto',
  database: 'Base de datos (WampServer/MySQL)',
  server: 'Servidor principal'
} as const satisfies Record<Exclude<LaunchStepId, 'frontend'>, string>

const FRONTEND_STEP = {
  id: 'frontend',
  label: 'Servidor Vite (npm run dev)'
} as const

const NO_DATABASE: Record<'node' | 'php' | 'unknown', string> = {
  node: 'Los proyectos Node no declaran una base de datos que DevLauncher deba arrancar.',
  php: 'No se detectó configuración de base de datos para este proyecto.',
  unknown: 'Tipo de proyecto no reconocido.'
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return null
  }
}

/** Campos de package.json que usa el plan (scripts y dependencias). */
interface PackageJsonLike {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** true si el proyecto tiene un script «dev» que levanta un servidor Vite. */
async function usesViteDevServer(projectPath: string): Promise<boolean> {
  const packageJson = await readJson<PackageJsonLike>(join(projectPath, 'package.json'))
  const devScript = packageJson?.scripts?.dev
  if (typeof devScript !== 'string' || !devScript.trim()) return false

  const dependencies = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  }
  return 'vite' in dependencies || devScript.toLowerCase().includes('vite')
}

/**
 * Document root del servidor integrado de PHP: `public/` cuando existe (Laravel,
 * Symfony, CodeIgniter 4, Bedrock) y la raíz del proyecto en el resto.
 */
async function resolveDocroot(projectPath: string): Promise<string> {
  return (await pathExists(join(projectPath, 'public'))) ? 'public' : '.'
}

/** Comando del servidor integrado de PHP sirviendo `docroot`. */
function phpBuiltInServer(docroot: string, label: string): ServerCommand {
  return {
    tool: 'php',
    kind: 'php',
    label,
    allocatesPort: true,
    defaultPort: null,
    args: (port) => ['-S', `127.0.0.1:${port}`, '-t', docroot]
  }
}

/**
 * Nombre del script de arranque de un proyecto Node. Se aceptan los nombres
 * habituales: `dev` (Vite, Next, Nuxt), `start` (Create React App) y `serve`
 * (Vue CLI).
 */
async function findNodeScript(projectPath: string): Promise<string | null> {
  const packageJson = await readJson<PackageJsonLike>(join(projectPath, 'package.json'))
  const scripts = packageJson?.scripts ?? {}

  for (const name of ['dev', 'start', 'serve']) {
    if (typeof scripts[name] === 'string' && scripts[name].trim()) return name
  }
  return null
}

/**
 * Dev server de un proyecto Node: `npm run dev` (o `start`/`serve`). El puerto
 * lo elige el servidor; `defaultPort` solo se usa como comprobación de respaldo
 * cuando no anuncia su URL.
 */
async function nodeDevServer(
  projectPath: string,
  framework: Framework
): Promise<ServerCommand | null> {
  const script = await findNodeScript(projectPath)
  if (!script) return null

  const vite = await usesViteDevServer(projectPath)
  const defaultPort =
    framework === 'nextjs' ? NEXT_PORT : vite ? VITE_PORT : framework === 'vue' ? 8080 : NEXT_PORT

  return {
    tool: 'npm',
    kind: 'node',
    label: `${frameworkLabel(framework)} (npm run ${script})`,
    allocatesPort: false,
    defaultPort,
    args: () => ['run', script]
  }
}

function unsupported(framework: Framework, reason: string): LaunchPlan {
  return {
    framework,
    steps: [],
    database: { source: 'none', reason: NO_DATABASE.unknown },
    supported: false,
    reason
  }
}

/** Construye el plan de arranque de un proyecto según su framework. */
export async function buildLaunchPlan(project: Project): Promise<LaunchPlan> {
  const requirementsStep = { id: 'requirements' as const, label: STEPS.requirements }

  switch (project.framework) {
    case 'laravel': {
      const vite = await usesViteDevServer(project.path)
      return {
        framework: project.framework,
        supported: true,
        steps: [
          requirementsStep,
          { id: 'database', label: STEPS.database },
          { id: 'server', label: 'Servidor PHP (artisan serve)' },
          ...(vite ? [FRONTEND_STEP] : [])
        ],
        server: {
          tool: 'php',
          kind: 'php',
          label: 'Laravel (artisan serve)',
          allocatesPort: true,
          defaultPort: null,
          args: (port) => ['artisan', 'serve', '--host=127.0.0.1', `--port=${port}`]
        },
        frontend: vite
          ? { tool: 'npm', label: 'Vite (npm run dev)', args: () => ['run', 'dev'] }
          : null,
        database: { source: 'dotenv', reason: '' }
      }
    }

    case 'codeigniter': {
      const usesSpark = await pathExists(join(project.path, 'spark'))
      const docroot = await resolveDocroot(project.path)
      return {
        framework: project.framework,
        supported: true,
        steps: [
          requirementsStep,
          { id: 'database', label: STEPS.database },
          {
            id: 'server',
            label: usesSpark ? 'Servidor PHP (spark serve)' : 'Servidor PHP (servidor integrado)'
          }
        ],
        server: usesSpark
          ? {
              tool: 'php',
              kind: 'php',
              label: 'CodeIgniter (spark serve)',
              allocatesPort: true,
              defaultPort: null,
              args: (port) => ['spark', 'serve', '--host', '127.0.0.1', '--port', String(port)]
            }
          : phpBuiltInServer(docroot, 'CodeIgniter (PHP integrado)'),
        frontend: null,
        database: { source: 'dotenv', reason: '' }
      }
    }

    case 'symfony': {
      const vite = await usesViteDevServer(project.path)
      const docroot = await resolveDocroot(project.path)
      return {
        framework: project.framework,
        supported: true,
        steps: [
          requirementsStep,
          { id: 'database', label: STEPS.database },
          { id: 'server', label: 'Servidor PHP (servidor integrado)' },
          ...(vite ? [FRONTEND_STEP] : [])
        ],
        server: phpBuiltInServer(docroot, 'Symfony (PHP integrado)'),
        frontend: vite
          ? { tool: 'npm', label: 'Vite (npm run dev)', args: () => ['run', 'dev'] }
          : null,
        database: { source: 'dotenv', reason: '' }
      }
    }

    case 'wordpress': {
      const docroot = await resolveDocroot(project.path)
      return {
        framework: project.framework,
        supported: true,
        steps: [
          requirementsStep,
          { id: 'database', label: STEPS.database },
          { id: 'server', label: 'Servidor PHP (servidor integrado)' }
        ],
        server: phpBuiltInServer(docroot, 'WordPress (PHP integrado)'),
        frontend: null,
        database: { source: 'wordpress', reason: '' }
      }
    }

    case 'nextjs':
    case 'react':
    case 'vue':
    case 'node': {
      const server = await nodeDevServer(project.path, project.framework)
      if (!server) {
        return unsupported(
          project.framework,
          'El package.json del proyecto no define un script de arranque («dev», «start» ni «serve»).'
        )
      }

      return {
        framework: project.framework,
        supported: true,
        steps: [requirementsStep, { id: 'server', label: STEPS.server }],
        server,
        frontend: null,
        database: { source: 'none', reason: NO_DATABASE.node }
      }
    }

    case 'php': {
      const docroot = await resolveDocroot(project.path)
      return {
        framework: project.framework,
        supported: true,
        steps: [requirementsStep, { id: 'server', label: 'Servidor PHP (servidor integrado)' }],
        server: phpBuiltInServer(docroot, 'PHP (servidor integrado)'),
        frontend: null,
        database: { source: 'none', reason: NO_DATABASE.php }
      }
    }

    default:
      return unsupported(
        project.framework,
        'No se reconoció el tipo de proyecto, así que no se sabe cómo arrancarlo. Añade composer.json o package.json a la carpeta (o registra el proyecto con el framework correcto).'
      )
  }
}
