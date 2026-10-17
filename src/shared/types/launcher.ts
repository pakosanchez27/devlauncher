/**
 * Contratos del motor de automatización (EP-04).
 *
 * El motor arranca el entorno de un proyecto Laravel de forma ordenada:
 * comprueba requisitos → asegura la base de datos → `php artisan serve` →
 * `npm run dev` (si el proyecto usa Vite). Compartido entre main, preload y
 * renderer.
 */

/** Pasos del arranque ordenado. */
export type LaunchStepId = 'requirements' | 'database' | 'php' | 'vite'

/** Estado de un paso del arranque. */
export type LaunchStepState = 'pending' | 'running' | 'ready' | 'skipped' | 'failed'

/** Paso del arranque ordenado. */
export interface LaunchStep {
  id: LaunchStepId
  label: string
  state: LaunchStepState
  /** Explicación legible del resultado del paso. */
  message: string
}

/** Servicios que el motor puede dejar en ejecución. */
export type LaunchServiceKind = 'wamp' | 'php' | 'vite'

/** Estado de un servicio gestionado. */
export type LaunchServiceStatus = 'running' | 'stopped' | 'failed'

/** Servicio en ejecución asociado a una sesión de arranque. */
export interface LaunchService {
  id: string
  kind: LaunchServiceKind
  label: string
  status: LaunchServiceStatus
  /** Identificador del proceso del sistema (null si no se pudo obtener). */
  pid: number | null
  startedAt: string
}

/** Información de un proceso gestionado por el motor (uso interno/eventos). */
export interface ManagedProcessInfo {
  id: string
  projectId: string
  kind: LaunchServiceKind
  label: string
  /** Línea de comando completa, tal como se ejecutó. */
  command: string
  pid: number | null
  status: LaunchServiceStatus
  startedAt: string
  exitCode: number | null
}

/** Estado global de una sesión de arranque. */
export type LaunchState = 'idle' | 'starting' | 'ready' | 'failed' | 'stopped'

/** Sesión de arranque del entorno de un proyecto. */
export interface LaunchSession {
  projectId: string
  projectName: string
  projectPath: string
  state: LaunchState
  steps: LaunchStep[]
  services: LaunchService[]
  /** URL de la aplicación (artisan serve) y del servidor Vite, si están listos. */
  urls: { app: string | null; vite: string | null }
  startedAt: string | null
  finishedAt: string | null
  /** Mensaje del fallo, si la sesión terminó en error. */
  error: string | null
}

/** Eventos que el proceso principal envía al renderer durante el arranque. */
export type LauncherEvent =
  | { type: 'session'; session: LaunchSession }
  | { type: 'log'; processId: string; projectId: string; line: string }
  | { type: 'process'; process: ManagedProcessInfo }
