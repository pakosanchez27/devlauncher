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
  /** Copia texto al portapapeles del sistema (EP-08). */
  APP_COPY_TEXT: 'app:copy-text',

  // Gestión de proyectos (EP-02)
  PROJECTS_LIST: 'projects:list',
  PROJECTS_SELECT_FOLDER: 'projects:select-folder',
  /** Elige el ejecutable de PHP de un proyecto concreto. */
  PROJECTS_SELECT_PHP: 'projects:select-php',
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
  /** Instalaciones de PHP disponibles para asignar a un proyecto. */
  ENV_LIST_PHP: 'env:list-php',
  /** Valida una ruta de PHP y devuelve su versión. */
  ENV_INSPECT_PHP: 'env:inspect-php',
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
  LAUNCHER_EVENT: 'launcher:event',

  // Registros y diagnóstico (EP-08)
  /** Guarda un registro en un archivo elegido por el usuario. */
  LOGS_EXPORT: 'logs:export'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]
