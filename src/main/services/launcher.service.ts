import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { frameworkLabel } from '@shared/constants/frameworks'
import type {
  LaunchServiceStatus,
  LaunchSession,
  LaunchStep,
  LaunchStepId,
  LaunchStepState
} from '@shared/types/launcher'
import type { Project } from '@shared/types/project'
import {
  checkProjectRequirements,
  detectWampServer,
  resolveExecutable
} from './environment.service'
import { broadcastLauncherEvent } from './events'
import {
  getManagedProcess,
  spawnDetached,
  startManagedProcess,
  stopManagedProcess
} from './process.service'
import { readProjects } from './project.repository'
import { delay, findFreePort, isPortOpen, waitForHttp, waitForPort } from './readiness'
import { getSettings } from './settings.service'

/**
 * Motor de automatización (EP-04).
 *
 * Arranca el entorno de un proyecto Laravel con un solo paso, en orden y
 * comprobando que cada servicio quede listo:
 *
 *   1. Requisitos del proyecto (artisan, composer.json, vendor/).
 *   2. Base de datos: arranca WampServer/MySQL solo si no está ya en marcha.
 *   3. `php artisan serve` en un puerto libre, esperando a que responda.
 *   4. `npm run dev` si el proyecto usa Vite, esperando su URL.
 */

const DB_DEFAULT_PORT = 3306
const APP_PORT_START = 8000
const VITE_PORT = 5173

const DB_TIMEOUT = 30000
const PHP_TIMEOUT = 25000
const VITE_TIMEOUT = 60000

interface PackageJsonLike {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** Única sesión de arranque activa (el MVP arranca un entorno a la vez). */
let session: LaunchSession | null = null
let starting = false

function broadcastSession(): void {
  if (session) broadcastLauncherEvent({ type: 'session', session })
}

function setStep(id: LaunchStepId, state: LaunchStepState, message: string): void {
  const step = session?.steps.find((candidate) => candidate.id === id)
  if (!step) return
  step.state = state
  step.message = message
  broadcastSession()
}

function markService(id: string, status: LaunchServiceStatus): void {
  const service = session?.services.find((candidate) => candidate.id === id)
  if (service) service.status = status
  broadcastSession()
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return null
  }
}

/** Lee un archivo .env y devuelve sus claves (ignora comentarios y comillas). */
async function readEnvFile(file: string): Promise<Record<string, string>> {
  try {
    const content = await fs.readFile(file, 'utf-8')
    const values: Record<string, string> = {}

    for (const raw of content.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const separator = line.indexOf('=')
      if (separator === -1) continue

      const key = line.slice(0, separator).trim()
      let value = line.slice(separator + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      values[key] = value
    }
    return values
  } catch {
    return {}
  }
}

/** true si el proyecto tiene un script «dev» que usa Vite. */
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

/** Espera a que un proceso gestionado deje el servicio listo (o se caiga antes). */
async function waitForService(
  serviceId: string,
  check: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    const process = getManagedProcess(serviceId)
    if (process && process.status !== 'running') return false
    await delay(300)
  }
  return false
}

async function runRequirementsStep(project: Project): Promise<boolean> {
  setStep('requirements', 'running', 'Comprobando requisitos del proyecto…')

  if (project.framework !== 'laravel') {
    setStep(
      'requirements',
      'failed',
      `El motor del MVP arranca proyectos Laravel. Este se detectó como ${frameworkLabel(
        project.framework
      )}; su arranque llegará con la compatibilidad de frameworks (EP-10).`
    )
    return false
  }

  const report = await checkProjectRequirements(project.path)
  if (report.missing.length > 0) {
    setStep(
      'requirements',
      'failed',
      `Faltan requisitos obligatorios: ${report.missing.join(', ')}.`
    )
    return false
  }

  setStep('requirements', 'ready', 'artisan, composer.json y vendor/ presentes.')
  return true
}

async function runDatabaseStep(project: Project): Promise<boolean> {
  setStep('database', 'running', 'Comprobando la base de datos…')

  const env = await readEnvFile(join(project.path, '.env'))
  const connection = (env.DB_CONNECTION ?? 'mysql').toLowerCase()
  if (connection === 'sqlite') {
    setStep('database', 'skipped', 'El proyecto usa SQLite: no necesita servidor de base de datos.')
    return true
  }

  const port = Number(env.DB_PORT) || DB_DEFAULT_PORT
  if (await isPortOpen(port)) {
    setStep('database', 'ready', `MySQL ya está escuchando en el puerto ${port}.`)
    return true
  }

  const wamp = await detectWampServer(await getSettings())
  if (!wamp.installed || !wamp.path) {
    setStep(
      'database',
      'failed',
      `Nada escucha en el puerto ${port} y no se encontró WampServer. Arráncalo manualmente o configura su ruta en «Entorno».`
    )
    return false
  }

  setStep('database', 'running', `MySQL no responde; iniciando WampServer (${wamp.path})…`)
  spawnDetached(join(wamp.path, 'wampmanager.exe'), [], wamp.path)

  if (!(await waitForPort(port, '127.0.0.1', DB_TIMEOUT))) {
    setStep(
      'database',
      'failed',
      `WampServer se lanzó pero MySQL no respondió en el puerto ${port} (30 s).`
    )
    return false
  }

  setStep('database', 'ready', `WampServer iniciado; MySQL escuchando en el puerto ${port}.`)
  return true
}

async function runPhpStep(project: Project): Promise<boolean> {
  setStep('php', 'running', 'Localizando PHP…')

  const php = await resolveExecutable('php')
  if (!php.available || !php.path) {
    setStep('php', 'failed', 'No se encontró PHP. Configúralo en el panel «Entorno».')
    return false
  }

  const port = await findFreePort(APP_PORT_START)
  setStep('php', 'running', `Ejecutando php artisan serve en el puerto ${port}…`)

  const service = startManagedProcess({
    projectId: project.id,
    kind: 'php',
    label: 'Laravel (artisan serve)',
    command: php.path,
    args: ['artisan', 'serve', '--host=127.0.0.1', `--port=${port}`],
    cwd: project.path
  })

  const current = session
  if (!current) return false
  current.services.push({
    id: service.id,
    kind: 'php',
    label: service.label,
    status: 'running',
    pid: service.pid,
    startedAt: service.startedAt
  })
  broadcastSession()

  const url = `http://127.0.0.1:${port}`
  const ready = await waitForService(service.id, () => isPortOpen(port), PHP_TIMEOUT)
  if (!ready) {
    await stopManagedProcess(service.id)
    markService(service.id, 'failed')
    setStep('php', 'failed', 'El servidor PHP no respondió a tiempo. Revisa la salida del proceso.')
    return false
  }

  // Confirmación HTTP (mejor esfuerzo): que realmente sirva la aplicación.
  await waitForHttp(url, 5000)

  current.urls.app = url
  setStep('php', 'ready', `Aplicación disponible en ${url}`)
  broadcastSession()
  return true
}

async function runViteStep(project: Project): Promise<boolean> {
  if (!(await usesViteDevServer(project.path))) {
    setStep('vite', 'skipped', 'El proyecto no usa Vite: no hace falta compilar el frontend.')
    return true
  }

  setStep('vite', 'running', 'Localizando npm…')
  const npm = await resolveExecutable('npm')
  if (!npm.available || !npm.path) {
    setStep('vite', 'failed', 'No se encontró npm. Configúralo en el panel «Entorno».')
    return false
  }

  setStep('vite', 'running', 'Ejecutando npm run dev…')

  const captured: { url: string | null } = { url: null }
  const service = startManagedProcess({
    projectId: project.id,
    kind: 'vite',
    label: 'Vite (npm run dev)',
    command: npm.path,
    args: ['run', 'dev'],
    cwd: project.path,
    onLine: (line) => {
      const match = line.match(/Local:\s+(https?:\/\/[^\s]+)/i)
      if (match && !captured.url) captured.url = match[1].replace(/\/+$/, '')
    }
  })

  const current = session
  if (!current) return false
  current.services.push({
    id: service.id,
    kind: 'vite',
    label: service.label,
    status: 'running',
    pid: service.pid,
    startedAt: service.startedAt
  })
  broadcastSession()

  const ready = await waitForService(
    service.id,
    async () => Boolean(captured.url) || (await isPortOpen(VITE_PORT)),
    VITE_TIMEOUT
  )
  if (!ready) {
    await stopManagedProcess(service.id)
    markService(service.id, 'failed')
    setStep('vite', 'failed', 'Vite no arrancó a tiempo. Revisa la salida del proceso.')
    return false
  }

  const url = captured.url ?? `http://localhost:${VITE_PORT}`
  current.urls.vite = url
  setStep('vite', 'ready', `Servidor de Vite disponible en ${url}`)
  broadcastSession()
  return true
}

async function stopSessionServices(): Promise<void> {
  const current = session
  if (!current) return
  for (const service of current.services) {
    if (service.status !== 'running') continue
    await stopManagedProcess(service.id)
    service.status = 'stopped'
  }
  broadcastSession()
}

/** Devuelve la sesión de arranque actual (o null si nunca se arrancó nada). */
export function getLaunchSession(): LaunchSession | null {
  return session
}

/** Arranca el entorno de un proyecto con el orden y las comprobaciones de EP-04. */
export async function startProjectEnvironment(projectId: string): Promise<LaunchSession> {
  if (starting) throw new Error('Ya se está arrancando un entorno. Espera a que termine.')

  const project = (await readProjects()).find((candidate) => candidate.id === projectId)
  if (!project) throw new Error('El proyecto no existe.')

  starting = true
  try {
    // El MVP arranca un entorno a la vez: se detiene el anterior si seguía vivo.
    if (session) await stopProjectEnvironment()

    const current: LaunchSession = {
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      state: 'starting',
      steps: [
        { id: 'requirements', label: 'Requisitos del proyecto', state: 'pending', message: '' },
        {
          id: 'database',
          label: 'Base de datos (WampServer/MySQL)',
          state: 'pending',
          message: ''
        },
        { id: 'php', label: 'Servidor PHP (artisan serve)', state: 'pending', message: '' },
        { id: 'vite', label: 'Servidor Vite (npm run dev)', state: 'pending', message: '' }
      ] satisfies LaunchStep[],
      services: [],
      urls: { app: null, vite: null },
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null
    }
    session = current
    broadcastSession()

    if (await runRequirementsStep(project)) {
      if (await runDatabaseStep(project)) {
        if (await runPhpStep(project)) {
          await runViteStep(project)
        }
      }
    }

    const failedStep = current.steps.find((step) => step.state === 'failed')
    if (failedStep) {
      current.state = 'failed'
      current.error = failedStep.message
      await stopSessionServices()
    } else {
      current.state = 'ready'
    }

    current.finishedAt = new Date().toISOString()
    broadcastSession()
    return current
  } finally {
    starting = false
  }
}

/** Detiene el entorno en marcha (procesos PHP/Vite iniciados por el motor). */
export async function stopProjectEnvironment(): Promise<LaunchSession | null> {
  if (!session) return null

  await stopSessionServices()
  for (const step of session.steps) {
    if (step.state === 'running') step.state = 'pending'
  }
  session.state = 'stopped'
  session.finishedAt = new Date().toISOString()
  broadcastSession()
  return session
}
