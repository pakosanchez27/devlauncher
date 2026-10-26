import type { LaunchServiceKind, LaunchState, LaunchStepState } from '@shared/types/launcher'
import type { BadgeTone } from '../components/ui/Badge'

/** Nombre legible del estado de un entorno. */
export const LAUNCH_STATE_LABELS: Record<LaunchState, string> = {
  idle: 'Sin arrancar',
  starting: 'Arrancando',
  ready: 'En marcha',
  failed: 'Con errores',
  stopped: 'Detenido'
}

/** Tono del estado de un entorno. */
export const LAUNCH_STATE_TONES: Record<LaunchState, BadgeTone> = {
  idle: 'neutral',
  starting: 'warning',
  ready: 'success',
  failed: 'danger',
  stopped: 'neutral'
}

/** Nombre legible del estado de un paso del arranque. */
export const STEP_LABELS: Record<LaunchStepState, string> = {
  pending: 'Pendiente',
  running: 'En curso',
  ready: 'Listo',
  skipped: 'Omitido',
  failed: 'Fallo'
}

/** Nombre corto de cada tipo de servicio. */
export const SERVICE_KIND_LABELS: Record<LaunchServiceKind, string> = {
  wamp: 'WAMP',
  php: 'PHP',
  node: 'Node',
  vite: 'Vite'
}
