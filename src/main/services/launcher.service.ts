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
import type { ExternalOpenResult } from '@shared/types/environment'
import {
  checkProjectRequirements,
  detectWampServer,
  isWampRunning,
  resolveExecutable
} from './environment.service'
import { openProjectInEditor } from './editor.service'
import { openUrlInBrowser } from './browser.service'
import { broadcastLauncherEvent } from './events'
import { APP_PORT_START, VITE_PORT, buildLaunchPlan, type LaunchPlan } from './launch-plan'
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
import { delay, isPortAvailable, isPortOpen, waitForHttp } from './readiness'
import { getSettings } from './settings.service'

/**
 * Motor de automatización (EP-04), gestor de entornos (EP-05) y compatibilidad
 * de frameworks (EP-10).
 *
 * Arranca el entorno de un proyecto en el orden que dicta su plan de arranque
 * (`launch-plan.ts`), comprobando que cada servicio quede listo antes de pasar
 * al siguiente:
 *
 *   1. Requisitos del proyecto, propios de su framework.
 *   2. Editor: abre la carpeta del proyecto en VS Code (o el configurado).
 *   3. Base de datos: arranca WampServer/MySQL solo si el proyecto la necesita
 *      y nada escucha ya en su puerto.
 *   4. Servidor principal: `artisan serve`, `spark serve`, `php -S` o
 *      `npm run dev`.
 *   5. Frontend: `npm run dev` con Vite, si es un proyecto PHP que lo declara.
 *
 * Puede haber varios entornos en marcha a la vez. Cada uno tiene su sesión y
 * sus puertos reservados, de modo que dos proyectos nunca chocan entre sí.
 */

const DB_DEFAULT_PORT = 3306

/** Arranque en frío de WampServer: servicios de MySQL/Apache en Windows. */
const DB_TIMEOUT = 60000
/** WAMP ya está abierto: si MySQL no escucha, se le da un margen corto. */
const DB_WAIT_RUNNING = 15000
/** Servidores PHP: arrancan rápido. */
const SERVER_TIMEOUT = 25000
/** Dev servers de Node: instalación/compilación inicial más lenta. */
const NODE_TIMEOUT = 60000
/** Servidor de Vite del frontend de un proyecto PHP. */
const FRONTEND_TIMEOUT = 60000

/** Sesiones de arranque por proyecto (EP-05 permite varias a la vez). */
const sessions = new Map<string, LaunchSession>()
/** Proyectos cuyo arranque está en curso (evita arranques duplicados). */
const starting = new Set<string>()
/** Proyectos cuyo arranque el usuario canceló mientras estaba en curso. */
const cancelled = new Set<string>()
/** Arranques de MySQL en curso por puerto (varios entornos pueden esperar). */
const databaseStartups = new Map<number, Promise<boolean>>()

/** Puerto de la sesión al que pertenece un servicio: el principal o el frontend. */
type PortSlot = 'app' | 'frontend'

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
function portOwner(projectId: string, slot: PortSlot): string {
  return `${projectId}:${slot}`
}

/** Slot de puertos que ocupa un servicio según su tipo. */
function slotOf(kind: ManagedProcessInfo['kind']): PortSlot {
  return kind === 'vite' ? 'frontend' : 'app'
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

/**
 * Puerto de MySQL de una instalación de WordPress, leído de `wp-config.php`
 * (`DB_HOST` admite `localhost` o `localhost:3307`).
 */
async function readWordPressPort(projectPath: string): Promise<number> {
  try {
    const content = await fs.readFile(join(projectPath, 'wp-config.php'), 'utf-8')
    const host = content.match(/DB_HOST['"]?\s*,\s*['"]([^'"]+)['"]/)?.[1]
    const port = host?.split(':')[1]
    return Number(port) || DB_DEFAULT_PORT
  } catch {
    return DB_DEFAULT_PORT
  }
}

/**
 * Extrae la URL local que anuncia un servidor de desarrollo. Vite imprime
 * «➜ Local: http://localhost:5173/» y Next.js «- Local: http://localhost:3000»;
 * se acepta también cualquier URL local con puerto por si el formato cambia.
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

/** Mensaje de fallo de un servicio con su código de salida y sus últimas líneas. */
function failureMessage(label: string, exitCode: number | null, log: string[]): string {
  const tail = log.slice(-2).join(' · ').slice(0, 240)
  const headline =
    exitCode !== null
      ? `${label} terminó inesperadamente (código ${exitCode}).`
      : `${label} no arrancó a tiempo.`
  return `${headline} Revisa la salida del proceso.${tail ? ` Últimas líneas: ${tail}` : ''}`
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
  slot: PortSlot,
  port: number | null,
  owner: string
): void {
  if (port !== null) releasePort(port, owner)
  if (slot === 'app' && session.ports.app === port) session.ports.app = null
  if (slot === 'frontend' && session.ports.vite === port) session.ports.vite = null

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
  setStep(session, slot === 'app' ? 'server' : 'frontend', 'failed', message)
  session.state = 'failed'
  session.error = message
  session.finishedAt = new Date().toISOString()
  broadcastSession(session)
}

async function runRequirementsStep(
  session: LaunchSession,
  project: Project,
  plan: LaunchPlan
): Promise<boolean> {
  setStep(session, 'requirements', 'running', 'Comprobando requisitos del proyecto…')

  if (!plan.supported) {
    setStep(session, 'requirements', 'failed', plan.reason)
    return false
  }

  const report = await checkProjectRequirements(project.path, project.framework)
  if (report.missing.length > 0) {
    setStep(
      session,
      'requirements',
      'failed',
      `Faltan requisitos obligatorios: ${report.missing.join(', ')}.`
    )
    return false
  }

  setStep(
    session,
    'requirements',
    'ready',
    `Requisitos de ${frameworkLabel(project.framework)} presentes.`
  )
  return true
}

/**
 * Abre el proyecto en el editor configurado. No bloquea el arranque: si el
 * editor no se encuentra, el paso queda informado y el entorno sigue.
 */
async function runEditorStep(session: LaunchSession, project: Project): Promise<void> {
  if (!session.steps.some((step) => step.id === 'editor')) return

  const settings = await getSettings()
  if (!settings.openEditorOnLaunch) {
    setStep(
      session,
      'editor',
      'skipped',
      'La apertura automática del editor está desactivada en «Entorno».'
    )
    return
  }

  setStep(session, 'editor', 'running', 'Abriendo el proyecto en el editor…')
  const result = await openProjectInEditor(project.path, settings.editorPath)
  setStep(session, 'editor', result.opened ? 'ready' : 'skipped', result.message)
}

/** Resuelve el puerto de base de datos que necesita el proyecto. */
async function resolveDatabasePort(
  project: Project,
  plan: LaunchPlan
): Promise<{ port: number } | { skip: string }> {
  if (plan.database.source === 'none') return { skip: plan.database.reason }

  if (plan.database.source === 'wordpress') {
    return { port: await readWordPressPort(project.path) }
  }

  const env = await readEnvFile(join(project.path, '.env'))
  const connection = (env.DB_CONNECTION ?? 'mysql').toLowerCase()
  if (connection === 'sqlite') {
    return { skip: 'El proyecto usa SQLite: no necesita servidor de base de datos.' }
  }
  return { port: Number(env.DB_PORT) || DB_DEFAULT_PORT }
}

/** true si algo escucha en el puerto, tanto en IPv4 como en IPv6 (WAMP usa ambos). */
async function isDatabaseListening(port: number): Promise<boolean> {
  if (await isPortOpen(port, '127.0.0.1')) return true
  return isPortOpen(port, 'localhost')
}

/** Espera a que MySQL escuche en el puerto (WAMP puede tardar en arrancar). */
async function waitForDatabase(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isDatabaseListening(port)) return true
    await delay(300)
  }
  return false
}

/**
 * Lanza WampServer en segundo plano. `wampmanager.exe` pide permisos de
 * administrador (necesarios para arrancar los servicios de Apache y MySQL), así
 * que Windows puede mostrar su aviso de control de cuentas de usuario.
 */
function startWampServer(wampPath: string): void {
  spawnDetached(join(wampPath, 'wampmanager.exe'), [], wampPath)
}

async function runDatabaseStep(
  session: LaunchSession,
  project: Project,
  plan: LaunchPlan
): Promise<boolean> {
  setStep(session, 'database', 'running', 'Comprobando la base de datos…')

  const resolved = await resolveDatabasePort(project, plan)
  if ('skip' in resolved) {
    setStep(session, 'database', 'skipped', resolved.skip)
    return true
  }

  const port = resolved.port
  const wamp = await detectWampServer(await getSettings())
  const wampPath = wamp.installed ? wamp.path : null
  const wampRunning = wamp.installed ? await isWampRunning() : false

  // MySQL puede seguir escuchando con la bandeja de WAMP cerrada: se abre igual
  // para que el usuario lo encuentre donde espera, sin bloquear el arranque.
  if (await isDatabaseListening(port)) {
    if (wampPath && !wampRunning) {
      startWampServer(wampPath)
      setStep(
        session,
        'database',
        'ready',
        `MySQL ya está escuchando en el puerto ${port}. Se abrió WampServer.`
      )
    } else {
      setStep(session, 'database', 'ready', `MySQL ya está escuchando en el puerto ${port}.`)
    }
    return true
  }

  if (!wampPath) {
    setStep(
      session,
      'database',
      'failed',
      `Nada escucha en el puerto ${port} y no se encontró WampServer. Arráncalo manualmente o configura su ruta en «Entorno».`
    )
    return false
  }

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
      wampRunning
        ? `WampServer está abierto pero MySQL no responde; esperando al puerto ${port}…`
        : `MySQL no responde; iniciando WampServer (${wampPath}). Acepta el aviso de permisos de Windows si aparece…`
    )
    if (!wampRunning) startWampServer(wampPath)

    startup = waitForDatabase(port, wampRunning ? DB_WAIT_RUNNING : DB_TIMEOUT).finally(() =>
      databaseStartups.delete(port)
    )
    databaseStartups.set(port, startup)
  }

  if (!(await startup)) {
    const stillRunning = await isWampRunning()
    setStep(
      session,
      'database',
      'failed',
      stillRunning
        ? `WampServer está abierto pero MySQL no escucha en el puerto ${port}. Revisa el icono de WAMP: MySQL puede estar detenido o usar otro puerto.`
        : `WampServer no llegó a arrancar (permisos de administrador denegados o instalación incompleta). Ábrelo manualmente y vuelve a intentarlo.`
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

/**
 * Arranca el servidor principal del proyecto: el que manda su framework
 * (`artisan serve`, `spark serve`, `php -S`) o el dev server de Node
 * (`npm run dev`), según el plan.
 */
async function runServerStep(
  session: LaunchSession,
  project: Project,
  plan: LaunchPlan
): Promise<boolean> {
  if (!plan.supported) return false
  const server = plan.server

  setStep(session, 'server', 'running', `Localizando ${server.tool === 'php' ? 'PHP' : 'npm'}…`)

  const executable = await resolveExecutable(server.tool)
  if (!executable.available || !executable.path) {
    setStep(
      session,
      'server',
      'failed',
      `No se encontró ${server.tool === 'php' ? 'PHP' : 'npm'}. Configúralo en el panel «Entorno».`
    )
    return false
  }

  const owner = portOwner(project.id, 'app')
  let port: number | null = null

  // Los servidores PHP aceptan el puerto en los argumentos. Los dev servers de
  // Node eligen el suyo: se reserva el que anuncien al arrancar.
  if (server.allocatesPort) {
    setStep(session, 'server', 'running', 'Buscando un puerto libre…')
    port = await allocatePort(APP_PORT_START, owner)
    if (port === null) {
      setStep(
        session,
        'server',
        'failed',
        `No hay puertos libres entre ${APP_PORT_START} y ${APP_PORT_START + 19}.`
      )
      return false
    }
    session.ports.app = port
  }

  const args = server.args(port ?? 0)
  const commandLine = [executable.path, ...args].join(' ')
  setStep(session, 'server', 'running', `Ejecutando ${commandLine}…`)

  const captured: { url: string | null } = { url: null }
  let serviceId: string | null = null

  const service = startManagedProcess({
    projectId: project.id,
    projectPath: project.path,
    kind: server.kind,
    label: server.label,
    command: executable.path,
    args,
    cwd: project.path,
    ports: port !== null ? [port] : [],
    onLine: (line) => {
      if (!captured.url) captured.url = parseLocalUrl(line)
    },
    onExit: () => {
      if (serviceId) {
        handleUnexpectedExit(session, serviceId, 'app', port ?? session.ports.app, owner)
      }
    }
  })
  serviceId = service.id

  session.services.push({
    id: service.id,
    kind: service.kind,
    label: service.label,
    status: 'running',
    pid: service.pid,
    ports: port !== null ? [port] : [],
    startedAt: service.startedAt
  })
  broadcastSession(session)

  const ready = await waitForService(
    project.id,
    service.id,
    async () => {
      if (captured.url) return true
      if (port !== null) return isPortOpen(port)
      if (server.defaultPort === null) return false
      return (
        (await isPortOpen(server.defaultPort)) ||
        (await isPortOpen(server.defaultPort, 'localhost'))
      )
    },
    server.kind === 'node' ? NODE_TIMEOUT : SERVER_TIMEOUT
  )

  if (!ready) {
    const exitCode = getManagedProcess(service.id)?.exitCode ?? null
    await stopManagedProcess(service.id)
    if (port !== null) {
      releasePort(port, owner)
      session.ports.app = null
    }
    markService(session, service.id, 'failed')
    if (!cancelled.has(project.id)) {
      setStep(
        session,
        'server',
        'failed',
        failureMessage(server.label, exitCode, getManagedProcessLog(service.id))
      )
    }
    return false
  }

  const url =
    captured.url ??
    (port !== null
      ? `http://127.0.0.1:${port}`
      : `http://localhost:${server.defaultPort ?? VITE_PORT}`)

  // Confirmación HTTP (mejor esfuerzo): que el servidor PHP sirva la aplicación.
  if (server.kind === 'php') await waitForHttp(url, 5000)

  const actualPort = Number(new URL(url).port) || port || server.defaultPort
  if (actualPort !== null && !isPortReserved(actualPort)) reservePort(actualPort, owner)

  session.ports.app = actualPort
  const managedService = session.services.find((candidate) => candidate.id === service.id)
  if (managedService && actualPort !== null) managedService.ports = [actualPort]

  session.urls.app = url
  setStep(session, 'server', 'ready', `Aplicación disponible en ${url}`)
  broadcastSession(session)
  return true
}

/** Arranca el servidor de desarrollo del frontend (Vite) de un proyecto PHP. */
async function runFrontendStep(
  session: LaunchSession,
  project: Project,
  plan: LaunchPlan
): Promise<boolean> {
  if (!plan.supported || !plan.frontend) return true
  const frontend = plan.frontend

  setStep(session, 'frontend', 'running', 'Localizando npm…')
  const npm = await resolveExecutable('npm')
  if (!npm.available || !npm.path) {
    setStep(session, 'frontend', 'failed', 'No se encontró npm. Configúralo en el panel «Entorno».')
    return false
  }

  const args = frontend.args(VITE_PORT)
  setStep(session, 'frontend', 'running', `Ejecutando ${frontend.label}…`)

  const owner = portOwner(project.id, 'frontend')
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
    label: frontend.label,
    command: npm.path,
    args,
    cwd: project.path,
    onLine: (line) => {
      if (captured.url) return
      const url = parseLocalUrl(line)
      if (url) captured.url = url
    },
    onExit: () => {
      if (serviceId) {
        handleUnexpectedExit(session, serviceId, 'frontend', session.ports.vite, owner)
      }
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
    FRONTEND_TIMEOUT
  )
  if (!ready) {
    // Se conserva el motivo real (código de salida y últimas líneas) para que el
    // fallo no sea un «no arrancó a tiempo» sin contexto.
    const exitCode = getManagedProcess(service.id)?.exitCode ?? null
    await stopManagedProcess(service.id)
    releasePort(VITE_PORT, owner)
    markService(session, service.id, 'failed')
    if (!cancelled.has(project.id)) {
      setStep(
        session,
        'frontend',
        'failed',
        failureMessage(frontend.label, exitCode, getManagedProcessLog(service.id))
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
  setStep(session, 'frontend', 'ready', `Servidor de Vite disponible en ${url}`)
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

  releasePortsOf(portOwner(session.projectId, 'app'))
  releasePortsOf(portOwner(session.projectId, 'frontend'))
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

/**
 * Abre en el navegador la aplicación de un entorno en marcha (EP-07). Se usa la
 * URL del servidor principal y, si el proyecto solo tiene frontend, la de Vite.
 */
export async function openProjectUrl(projectId: string): Promise<ExternalOpenResult> {
  const session = sessions.get(projectId)
  const url = session?.urls.app ?? session?.urls.vite ?? null
  if (!url) {
    throw new Error('El entorno no tiene una URL disponible: inícialo primero.')
  }

  const settings = await getSettings()
  return openUrlInBrowser(url, settings.browserPath)
}

/** Detiene un servicio concreto y actualiza su sesión. */
export async function stopServiceProcess(serviceId: string): Promise<ManagedProcessInfo | null> {
  const processInfo = getManagedProcess(serviceId)
  if (!processInfo) throw new Error('El proceso no existe o ya ha terminado.')

  const session = sessions.get(processInfo.projectId)
  await stopManagedProcess(serviceId)

  if (session) {
    markService(session, serviceId, 'stopped')
    const slot = slotOf(processInfo.kind)
    const owner = portOwner(session.projectId, slot)

    if (processInfo.ports[0] !== undefined) releasePort(processInfo.ports[0], owner)

    if (slot === 'app') {
      session.ports.app = null
      session.urls.app = null
    } else {
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

/** Ejecuta los pasos del plan en orden, deteniéndose en el primero que falle. */
async function runLaunchPlan(
  session: LaunchSession,
  project: Project,
  plan: LaunchPlan
): Promise<void> {
  const aborted = (): boolean => cancelled.has(project.id)

  if (aborted() || !(await runRequirementsStep(session, project, plan))) return
  await runEditorStep(session, project)
  if (
    aborted() ||
    (plan.database.source !== 'none' && !(await runDatabaseStep(session, project, plan)))
  ) {
    return
  }
  if (aborted() || !(await runServerStep(session, project, plan))) return
  if (!aborted() && plan.supported && plan.frontend) {
    await runFrontendStep(session, project, plan)
  }
}

/** Arranca el entorno de un proyecto siguiendo el plan de su framework. */
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
    const plan = await buildLaunchPlan(project)

    const ports: LaunchPorts = { app: null, vite: null }
    const stepDefinitions: Array<{ id: LaunchStepId; label: string }> = plan.supported
      ? plan.steps
      : [{ id: 'requirements', label: 'Requisitos del proyecto' }]

    const session: LaunchSession = {
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      state: 'starting',
      steps: stepDefinitions.map(({ id, label }): LaunchStep => ({
        id,
        label,
        state: 'pending',
        message: ''
      })),
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
      await runLaunchPlan(session, project, plan)
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
