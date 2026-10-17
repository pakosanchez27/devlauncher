/**
 * Canales IPC de DevLauncher.
 *
 * Única fuente de verdad de los nombres de canal: la usan el proceso principal
 * (handlers) y el preload (contextBridge). Nunca escribir el nombre de un canal
 * como texto literal en otro lugar.
 */
export const IPC_CHANNELS = {
  // Aplicación / diagnóstico
  APP_PING: 'app:ping',
  APP_GET_INFO: 'app:get-info',

  // Gestión de proyectos (EP-02)
  PROJECTS_LIST: 'projects:list',
  PROJECTS_SELECT_FOLDER: 'projects:select-folder',
  PROJECTS_DETECT: 'projects:detect',
  PROJECTS_ADD: 'projects:add',
  PROJECTS_UPDATE: 'projects:update',
  PROJECTS_DELETE: 'projects:delete',
  PROJECTS_OPEN: 'projects:open',

  // Verificador de entorno (EP-03)
  ENV_CHECK: 'env:check',
  ENV_CHECK_PROJECT: 'env:check-project',
  ENV_CHECK_PORTS: 'env:check-ports',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Motor de automatización (EP-04)
  LAUNCHER_START: 'launcher:start',
  LAUNCHER_STOP: 'launcher:stop',
  LAUNCHER_STATUS: 'launcher:status',
  /** Canal de solo emisión: main → renderer (progreso y logs del arranque). */
  LAUNCHER_EVENT: 'launcher:event'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
