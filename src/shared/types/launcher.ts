/**
 * Contratos del motor de automatización (EP-04), de su gestor de procesos y
 * puertos (EP-05) y de la compatibilidad de frameworks (EP-10).
 *
 * El motor arranca el entorno de un proyecto de forma ordenada: comprueba
 * requisitos → abre el proyecto en el editor → asegura la base de datos (si
 * aplica) → servidor principal (`artisan serve`, `spark serve`, `php -S` o
 * `npm run dev`) → servidor de desarrollo del frontend (Vite) cuando es un
 * proyecto PHP con frontend. El plan concreto depende del framework detectado.
 * Puede haber varios entornos en marcha a la vez, cada uno con su propia
 * sesión. Compartido entre main, preload y renderer.
 */

/** Pasos del arranque ordenado. */
export type LaunchStepId = 'requirements' | 'editor' | 'database' | 'server' | 'frontend'

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

/**
 * Servicios que el motor puede dejar en ejecución: `php` (servidor principal
 * de un proyecto PHP), `node` (servidor de desarrollo de un proyecto JS) y
 * `vite` (servidor de desarrollo del frontend de un proyecto PHP).
 */
export type LaunchServiceKind = 'wamp' | 'php' | 'node' | 'vite'

/** Estado de un servicio gestionado. */
export type LaunchServiceStatus = 'running' | 'stopped' | 'failed'

/** Puertos asignados a una sesión de arranque. */
export interface LaunchPorts {
  app: number | null
  vite: number | null
}

/** Servicio en ejecución asociado a una sesión de arranque. */
export interface LaunchService {
  id: string
  kind: LaunchServiceKind
  label: string
  status: LaunchServiceStatus
  /** Identificador del proceso del sistema (null si no se pudo obtener). */
  pid: number | null
  /** Puertos que ocupa el servicio. */
  ports: number[]
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
  /** Puertos reservados para este proceso. */
  ports: number[]
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
  /** Puertos asignados a la aplicación y a Vite. */
  ports: LaunchPorts
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
