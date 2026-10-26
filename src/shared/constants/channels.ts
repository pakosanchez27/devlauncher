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
  /** Abre el proyecto en el editor configurado (EP-07). */
  PROJECTS_OPEN_EDITOR: 'projects:open-editor',

  // Verificador de entorno (EP-03)
  ENV_CHECK: 'env:check',
  ENV_CHECK_PROJECT: 'env:check-project',
  ENV_CHECK_PORTS: 'env:check-ports',
  /** Inspección de un puerto concreto, con el proceso que lo ocupa (EP-05). */
  ENV_INSPECT_PORT: 'env:inspect-port',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // Motor de automatización (EP-04) y gestor de procesos (EP-05)
  LAUNCHER_START: 'launcher:start',
  /** Detiene un entorno concreto (projectId) o todos si se omite. */
  LAUNCHER_STOP: 'launcher:stop',
  /** Detiene un único servicio gestionado. */
  LAUNCHER_STOP_SERVICE: 'launcher:stop-service',
  LAUNCHER_STATUS: 'launcher:status',
  /** Procesos gestionados (activos e histórico reciente). */
  LAUNCHER_PROCESSES: 'launcher:processes',
  /** Abre la aplicación de un entorno en el navegador (EP-07). */
  LAUNCHER_OPEN_URL: 'launcher:open-url',
  /** Canal de solo emisión: main → renderer (progreso y logs del arranque). */
  LAUNCHER_EVENT: 'launcher:event'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
