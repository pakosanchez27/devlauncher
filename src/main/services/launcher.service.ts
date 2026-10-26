import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { frameworkLabel } from '@shared/constants/frameworks'
import type {
  LaunchPorts,
  LaunchSession,
  LaunchStep,
  LaunchStepId,
  LaunchStepState,
  ManagedProcessInfo
} from '@shared/types/launcher'
import type { Project } from '@shared/types/project'
import {
  checkProjectRequirements,
  detectWampServer,
  resolveExecutable
} from './environment.service'
import { broadcastLauncherEvent } from './events'
import {
  allocatePort,
  isPortReserved,
  releasePort,
  releasePortsOf,
  reservePort
} from './ports.service'
import {
  getManagedProcess,
  getManagedProcessLog,
  spawnDetached,
  startManagedProcess,
  stopManagedProcess
} from './process.service'
import { readProjects } from './project.repository'
import { delay, isPortAvailable, isPortOpen, waitForHttp, waitForPort } from './readiness'
import { getSettings } from './settings.service'

/**
 * Motor de automatización (EP-04) y gestor de entornos (EP-05).
 *
 * Arranca el entorno de un proyecto Laravel con un solo paso, en orden y
 * comprobando que cada servicio quede listo:
 *
 *   1. Requisitos del proyecto (artisan, composer.json, vendor/).
 *   2. Base de datos: arranca WampServer/MySQL solo si no está ya en marcha.
 *   3. `php artisan serve` en un puerto libre, esperando a que responda.
 *   4. `npm run dev` si el proyecto usa Vite, esperando su URL.
 *
 * Puede haber varios entornos en marcha a la vez. Cada uno tiene su sesión y
 * sus puertos reservados, de modo que dos proyectos nunca chocan entre sí.
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

/** Sesiones de arranque por proyecto (EP-05 permite varias a la vez). */
const sessions = new Map<string, LaunchSession>()
/** Proyectos cuyo arranque está en curso (evita arranques duplicados). */
const starting = new Set<string>()
/** Proyectos cuyo arranque el usuario canceló mientras estaba en curso. */
const cancelled = new Set<string>()
/** Arranques de MySQL en curso por puerto (varios entornos pueden esperar). */
const databaseStartups = new Map<number, Promise<boolean>>()

function broadcastSession(session: LaunchSession): void {
  broadcastLauncherEvent({ type: 'session', session })
}

function setStep(
  session: LaunchSession,
  id: LaunchStepId,
  state: LaunchStepState,
  message: string
): void {
  const step = session.steps.find((candidate) => candidate.id === id)
  if (!step) return
  step.state = state
  step.message = message
  broadcastSession(session)
}

function markService(
  session: LaunchSession,
  id: string,
  status: 'running' | 'stopped' | 'failed'
): void {
  const service = session.services.find((candidate) => candidate.id === id)
  if (service) service.status = status
}

/** Propietario de la reserva de puertos de un servicio de la sesión. */
function portOwner(projectId: string, kind: 'php' | 'vite'): string {
  return `${projectId}:${kind}`
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

/**
 * Extrae la URL local que anuncia un servidor de desarrollo. Vite imprime
 * «➜ Local: http://localhost:5173/», pero puede añadir colores o partir la
 * línea, así que se acepta también cualquier URL local con puerto.
 */
function parseLocalUrl(line: string): string | null {
  const announced = line.match(/Local:\s*(https?:\/\/\S+)/i)?.[1]
  const candidate =
    announced ?? line.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/i)?.[0]
  if (!candidate) return null

  try {
    const url = new URL(candidate.replace(/[),.;]+$/, ''))
    if (!url.port) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

/** Espera a que un proceso gestionado deje el servicio listo (o se caiga antes). */
async function waitForService(
  projectId: string,
  serviceId: string,
  check: () => Promise<boolean>,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    if (cancelled.has(projectId)) return false
    const process = getManagedProcess(serviceId)
    if (process && process.status !== 'running') return false
    await delay(300)
  }
  return false
}

/**
 * Reacciona a la caída inesperada de un servicio ya listo: marca la sesión
 * como fallida y libera su puerto. Si el proceso lo paramos nosotros, no hace
 * nada.
 */
function handleUnexpectedExit(
  session: LaunchSession,
  serviceId: string,
  kind: 'php' | 'vite',
  port: number | null,
  owner: string
): void {
  if (port !== null) releasePort(port, owner)
  if (kind === 'php' && session.ports.app === port) session.ports.app = null
  if (kind === 'vite' && session.ports.vite === port) session.ports.vite = null

  const managed = getManagedProcess(serviceId)
  if (!managed || managed.status === 'stopped') return

  markService(session, serviceId, 'failed')

  // Durante el arranque, el propio flujo de pasos informa del fallo.
  if (session.state !== 'ready') {
    broadcastSession(session)
    return
  }

  const message = `El servicio «${managed.label}» se detuvo inesperadamente (código ${
    managed.exitCode ?? 'desconocido'
  }).`
  setStep(session, kind, 'failed', message)
  session.state = 'failed'
  session.error = message
  session.finishedAt = new Date().toISOString()
  broadcastSession(session)
}

async function runRequirementsStep(session: LaunchSession, project: Project): Promise<boolean> {
  setStep(session, 'requirements', 'running', 'Comprobando requisitos del proyecto…')

  if (project.framework !== 'laravel') {
    setStep(
      session,
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
      session,
      'requirements',
      'failed',
      `Faltan requisitos obligatorios: ${report.missing.join(', ')}.`
    )
    return false
  }

  setStep(session, 'requirements', 'ready', 'artisan, composer.json y vendor/ presentes.')
  return true
}

async function runDatabaseStep(session: LaunchSession, project: Project): Promise<boolean> {
  setStep(session, 'database', 'running', 'Comprobando la base de datos…')

  const env = await readEnvFile(join(project.path, '.env'))
  const connection = (env.DB_CONNECTION ?? 'mysql').toLowerCase()
  if (connection === 'sqlite') {
    setStep(
      session,
      'database',
      'skipped',
      'El proyecto usa SQLite: no necesita servidor de base de datos.'
    )
    return true
  }

  const port = Number(env.DB_PORT) || DB_DEFAULT_PORT
  if (await isPortOpen(port)) {
    setStep(session, 'database', 'ready', `MySQL ya está escuchando en el puerto ${port}.`)
    return true
  }

  const wamp = await detectWampServer(await getSettings())
  if (!wamp.installed || !wamp.path) {
    setStep(
      session,
      'database',
      'failed',
      `Nada escucha en el puerto ${port} y no se encontró WampServer. Arráncalo manualmente o configura su ruta en «Entorno».`
    )
    return false
  }

  const wampPath = wamp.path

  // Varios entornos pueden necesitar MySQL a la vez: se arranca una sola vez y
  // el resto espera al mismo arranque en lugar de lanzar WampServer en paralelo.
  let startup = databaseStartups.get(port)
  if (startup) {
    setStep(session, 'database', 'running', `Esperando a que MySQL arranque en el puerto ${port}…`)
  } else {
    setStep(
      session,
      'database',
      'running',
      `MySQL no responde; iniciando WampServer (${wampPath})…`
    )
    startup = (async (): Promise<boolean> => {
      spawnDetached(join(wampPath, 'wampmanager.exe'), [], wampPath)
      return waitForPort(port, '127.0.0.1', DB_TIMEOUT)
    })().finally(() => databaseStartups.delete(port))
    databaseStartups.set(port, startup)
  }

  if (!(await startup)) {
    setStep(
      session,
      'database',
      'failed',
      `WampServer se lanzó pero MySQL no respondió en el puerto ${port} (30 s).`
    )
    return false
  }

  setStep(
    session,
    'database',
    'ready',
    `WampServer iniciado; MySQL escuchando en el puerto ${port}.`
  )
  return true
}

async function runPhpStep(session: LaunchSession, project: Project): Promise<boolean> {
  setStep(session, 'php', 'running', 'Localizando PHP…')

  const php = await resolveExecutable('php')
  if (!php.available || !php.path) {
    setStep(session, 'php', 'failed', 'No se encontró PHP. Configúralo en el panel «Entorno».')
    return false
  }

  setStep(session, 'php', 'running', 'Buscando un puerto libre…')
  const owner = portOwner(project.id, 'php')
  const port = await allocatePort(APP_PORT_START, owner)
  if (port === null) {
    setStep(
      session,
      'php',
      'failed',
      `No hay puertos libres entre ${APP_PORT_START} y ${APP_PORT_START + 19}.`
    )
    return false
  }
  session.ports.app = port

  setStep(session, 'php', 'running', `Ejecutando php artisan serve en el puerto ${port}…`)

  let serviceId: string | null = null
  const service = startManagedProcess({
    projectId: project.id,
    projectPath: project.path,
    kind: 'php',
    label: 'Laravel (artisan serve)',
    command: php.path,
    args: ['artisan', 'serve', '--host=127.0.0.1', `--port=${port}`],
    cwd: project.path,
    ports: [port],
    onExit: () => {
      if (serviceId) handleUnexpectedExit(session, serviceId, 'php', port, owner)
    }
  })
  serviceId = service.id

  session.services.push({
    id: service.id,
    kind: 'php',
    label: service.label,
    status: 'running',
    pid: service.pid,
    ports: [port],
    startedAt: service.startedAt
  })
  broadcastSession(session)

  const url = `http://127.0.0.1:${port}`
  const ready = await waitForService(project.id, service.id, () => isPortOpen(port), PHP_TIMEOUT)
  if (!ready) {
    await stopManagedProcess(service.id)
    releasePort(port, owner)
    session.ports.app = null
    markService(session, service.id, 'failed')
    if (!cancelled.has(project.id)) {
      setStep(
        session,
        'php',
        'failed',
        'El servidor PHP no respondió a tiempo. Revisa la salida del proceso.'
      )
    }
    return false
  }

  // Confirmación HTTP (mejor esfuerzo): que realmente sirva la aplicación.
  await waitForHttp(url, 5000)

  session.urls.app = url
  setStep(session, 'php', 'ready', `Aplicación disponible en ${url}`)
  broadcastSession(session)
  return true
}

async function runViteStep(session: LaunchSession, project: Project): Promise<boolean> {
  if (!(await usesViteDevServer(project.path))) {
    setStep(
      session,
      'vite',
      'skipped',
      'El proyecto no usa Vite: no hace falta compilar el frontend.'
    )
    return true
  }

  setStep(session, 'vite', 'running', 'Localizando npm…')
  const npm = await resolveExecutable('npm')
  if (!npm.available || !npm.path) {
    setStep(session, 'vite', 'failed', 'No se encontró npm. Configúralo en el panel «Entorno».')
    return false
  }

  setStep(session, 'vite', 'running', 'Ejecutando npm run dev…')

  const owner = portOwner(project.id, 'vite')
  const captured: { url: string | null } = { url: null }

  // Si el 5173 está libre se reserva ya; si lo ocupa otro entorno, Vite elegirá
  // otro puerto y solo se dará por listo cuando anuncie su URL.
  const preferredFree = !isPortReserved(VITE_PORT) && (await isPortAvailable(VITE_PORT))
  if (preferredFree) reservePort(VITE_PORT, owner)

  let serviceId: string | null = null
  const service = startManagedProcess({
    projectId: project.id,
    projectPath: project.path,
    kind: 'vite',
    label: 'Vite (npm run dev)',
    command: npm.path,
    args: ['run', 'dev'],
    cwd: project.path,
    onLine: (line) => {
      if (captured.url) return
      const url = parseLocalUrl(line)
      if (url) captured.url = url
    },
    onExit: () => {
      if (serviceId) handleUnexpectedExit(session, serviceId, 'vite', session.ports.vite, owner)
    }
  })
  serviceId = service.id

  session.services.push({
    id: service.id,
    kind: 'vite',
    label: service.label,
    status: 'running',
    pid: service.pid,
    ports: [],
    startedAt: service.startedAt
  })
  broadcastSession(session)

  const ready = await waitForService(
    project.id,
    service.id,
    async () =>
      Boolean(captured.url) ||
      (preferredFree &&
        ((await isPortOpen(VITE_PORT)) || (await isPortOpen(VITE_PORT, 'localhost')))),
    VITE_TIMEOUT
  )
  if (!ready) {
    // Se conserva el motivo real (código de salida y últimas líneas) para que el
    // fallo no sea un «no arrancó a tiempo» sin contexto.
    const exitCode = getManagedProcess(service.id)?.exitCode ?? null
    await stopManagedProcess(service.id)
    releasePort(VITE_PORT, owner)
    markService(session, service.id, 'failed')
    if (!cancelled.has(project.id)) {
      const tail = getManagedProcessLog(service.id).slice(-2).join(' · ').slice(0, 240)
      const headline =
        exitCode !== null
          ? `Vite terminó inesperadamente (código ${exitCode}).`
          : 'Vite no arrancó a tiempo.'
      setStep(
        session,
        'vite',
        'failed',
        `${headline} Revisa la salida del proceso.${tail ? ` Últimas líneas: ${tail}` : ''}`
      )
    }
    return false
  }

  const url = captured.url ?? `http://localhost:${VITE_PORT}`
  const vitePort = Number(new URL(url).port) || VITE_PORT
  if (vitePort !== VITE_PORT) {
    releasePort(VITE_PORT, owner)
    if (!isPortReserved(vitePort)) reservePort(vitePort, owner)
  }
  session.ports.vite = vitePort
  const viteService = session.services.find((candidate) => candidate.id === service.id)
  if (viteService) viteService.ports = [vitePort]

  session.urls.vite = url
  setStep(session, 'vite', 'ready', `Servidor de Vite disponible en ${url}`)
  broadcastSession(session)
  return true
}

/** Detiene los servicios vivos de una sesión y libera sus puertos. */
async function stopSessionServices(session: LaunchSession): Promise<void> {
  for (const service of session.services) {
    if (service.status !== 'running') continue
    await stopManagedProcess(service.id)
    service.status = 'stopped'
  }

  releasePortsOf(portOwner(session.projectId, 'php'))
  releasePortsOf(portOwner(session.projectId, 'vite'))
  session.ports = { app: null, vite: null }
  broadcastSession(session)
}

/** Devuelve todas las sesiones de arranque (la más reciente primero). */
export function getLaunchSessions(): LaunchSession[] {
  return [...sessions.values()].sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
}

/** Devuelve la sesión de un proyecto, si existe. */
export function getLaunchSession(projectId: string): LaunchSession | null {
  return sessions.get(projectId) ?? null
}

/** Detiene un servicio concreto y actualiza su sesión. */
export async function stopServiceProcess(serviceId: string): Promise<ManagedProcessInfo | null> {
  const processInfo = getManagedProcess(serviceId)
  if (!processInfo) throw new Error('El proceso no existe o ya ha terminado.')

  const session = sessions.get(processInfo.projectId)
  await stopManagedProcess(serviceId)

  if (session) {
    markService(session, serviceId, 'stopped')

    if (processInfo.kind === 'php') {
      if (processInfo.ports[0] !== undefined) {
        releasePort(processInfo.ports[0], portOwner(session.projectId, 'php'))
      }
      session.ports.app = null
      session.urls.app = null
    }

    if (processInfo.kind === 'vite') {
      if (processInfo.ports[0] !== undefined) {
        releasePort(processInfo.ports[0], portOwner(session.projectId, 'vite'))
      }
      session.ports.vite = null
      session.urls.vite = null
    }

    if (!session.services.some((service) => service.status === 'running')) {
      session.state = 'stopped'
      session.finishedAt = new Date().toISOString()
    }
    broadcastSession(session)
  }

  return getManagedProcess(serviceId)
}

async function stopSession(session: LaunchSession): Promise<void> {
  if (session.state === 'starting') cancelled.add(session.projectId)

  await stopSessionServices(session)
  for (const step of session.steps) {
    if (step.state === 'running') step.state = 'pending'
  }
  session.state = 'stopped'
  session.finishedAt = new Date().toISOString()
  broadcastSession(session)
}

/**
 * Detiene el entorno de un proyecto (o todos si se omite `projectId`).
 * Devuelve las sesiones afectadas.
 */
export async function stopProjectEnvironment(projectId?: string): Promise<LaunchSession[]> {
  const targets = projectId ? [sessions.get(projectId)] : [...sessions.values()]
  const existing = targets.filter((session): session is LaunchSession => Boolean(session))
  await Promise.all(existing.map((session) => stopSession(session)))
  return existing
}

/** Arranca el entorno de un proyecto con el orden y las comprobaciones de EP-04. */
export async function startProjectEnvironment(projectId: string): Promise<LaunchSession> {
  if (starting.has(projectId)) {
    throw new Error('El entorno de este proyecto ya se está arrancando.')
  }

  const current = sessions.get(projectId)
  if (current && (current.state === 'starting' || current.state === 'ready')) {
    throw new Error(`El entorno de «${current.projectName}» ya está en marcha.`)
  }

  const project = (await readProjects()).find((candidate) => candidate.id === projectId)
  if (!project) throw new Error('El proyecto no existe.')

  starting.add(projectId)
  cancelled.delete(projectId)

  try {
    const ports: LaunchPorts = { app: null, vite: null }
    const session: LaunchSession = {
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
      ports,
      urls: { app: null, vite: null },
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null
    }
    sessions.set(projectId, session)
    broadcastSession(session)

    try {
      if (!cancelled.has(projectId) && (await runRequirementsStep(session, project))) {
        if (!cancelled.has(projectId) && (await runDatabaseStep(session, project))) {
          if (!cancelled.has(projectId) && (await runPhpStep(session, project))) {
            if (!cancelled.has(projectId)) await runViteStep(session, project)
          }
        }
      }
    } catch (cause) {
      // Cualquier excepción inesperada deja la sesión en error y sin procesos.
      const message =
        cause instanceof Error ? cause.message : 'Error inesperado al arrancar el entorno.'
      const runningStep = session.steps.find((step) => step.state === 'running')
      if (runningStep) {
        runningStep.state = 'failed'
        runningStep.message = message
      }
      session.state = 'failed'
      session.error = message
      await stopSessionServices(session)
    }

    if (cancelled.has(projectId)) {
      // La parada ya actualizó la sesión; solo se limpian los fallos derivados.
      for (const step of session.steps) {
        if (step.state === 'failed') {
          step.state = 'pending'
          step.message = ''
        }
      }
      session.error = null
      session.state = 'stopped'
    } else if (session.state !== 'failed') {
      const failedStep = session.steps.find((step) => step.state === 'failed')
      if (failedStep) {
        session.state = 'failed'
        session.error = failedStep.message
        await stopSessionServices(session)
      } else {
        session.state = 'ready'
      }
    }

    session.finishedAt = new Date().toISOString()
    broadcastSession(session)
    return session
  } finally {
    starting.delete(projectId)
    cancelled.delete(projectId)
  }
}
