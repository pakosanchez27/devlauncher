/**
 * Contratos del verificador de entorno (EP-03).
 *
 * Compartidos entre el proceso principal, el preload y el renderer.
 */

/** Herramientas externas que DevLauncher puede detectar. */
export type ToolId = 'php' | 'node' | 'npm' | 'composer' | 'mysql'

/** Origen de la ruta de un ejecutable detectado. */
export type ToolSource = 'configured' | 'project' | 'wamp' | 'path' | 'none'

/** Estado de una herramienta externa. */
export interface ToolStatus {
  id: ToolId
  label: string
  available: boolean
  /** Versión detectada (primera línea de la salida), si la hay. */
  version: string | null
  /** Ejecutable usado para la detección. */
  path: string | null
  source: ToolSource
  /** true si es imprescindible para ejecutar un proyecto Laravel. */
  required: boolean
  /** Mensaje legible (motivo del fallo o confirmación). */
  message: string
}

/** Estado de una instalación de WampServer. */
export interface WampStatus {
  installed: boolean
  path: string | null
  phpPath: string | null
  mysqlPath: string | null
}

/** Origen de una instalación de PHP detectada. */
export type PhpSource = 'wamp' | 'configured' | 'path' | 'custom'

/** Instalación de PHP que se puede asignar a un proyecto. */
export interface PhpInstallation {
  /** Ruta del ejecutable (absoluta siempre que se pueda resolver). */
  path: string
  /** Versión detectada, si se pudo leer. */
  version: string | null
  /** De dónde procede la instalación. */
  source: PhpSource
  /** true si es el PHP global que usa DevLauncher. */
  isGlobal: boolean
}

/** Comprobación de un requisito dentro de la carpeta de un proyecto. */
export interface RequirementCheck {
  id: string
  label: string
  /** Ruta relativa comprobada dentro del proyecto. */
  target: string
  present: boolean
  required: boolean
  /** Qué hacer si falta. */
  hint: string
}

/** Proceso del sistema que ocupa un puerto. */
export interface PortOwner {
  pid: number
  /** Nombre del ejecutable (p. ej. `node.exe`), si se pudo resolver. */
  name: string | null
}

/** Estado de un puerto TCP. */
export interface PortStatus {
  port: number
  label: string
  available: boolean
  /** true si DevLauncher tiene el puerto reservado para un entorno suyo. */
  reservedByUs: boolean
  /** Proceso que escucha en el puerto, si está ocupado. */
  owner: PortOwner | null
}

/** Inspección puntual de un puerto (EP-05). */
export interface PortInspection {
  port: number
  available: boolean
  /** true si el puerto está reservado por un entorno de DevLauncher. */
  reservedByUs: boolean
  owner: PortOwner | null
}

/** Informe global del entorno. */
export interface EnvironmentReport {
  tools: ToolStatus[]
  wamp: WampStatus
  /** Etiquetas de herramientas obligatorias no disponibles. */
  missing: string[]
  generatedAt: string
}

/** Informe de requisitos de un proyecto concreto. */
export interface ProjectRequirementsReport {
  projectPath: string
  checks: RequirementCheck[]
  /** Etiquetas de requisitos obligatorios que faltan. */
  missing: string[]
}

/** Informe de disponibilidad de puertos. */
export interface PortsReport {
  ports: PortStatus[]
  generatedAt: string
}

/** Preferencias globales de DevLauncher. */
export interface AppSettings {
  /** Rutas de ejecutables indicadas manualmente (tienen prioridad). */
  executables: Partial<Record<ToolId, string>>
  /** Ruta raíz de WampServer, si se quiere forzar. */
  wampPath: string | null
  /** Editor con el que abrir los proyectos (null = detección automática). */
  editorPath: string | null
  /** Navegador con el que abrir la aplicación (null = navegador predeterminado). */
  browserPath: string | null
  /** true para abrir el proyecto en el editor al arrancar su entorno. */
  openEditorOnLaunch: boolean
}

/** Resultado de abrir un recurso externo: editor o navegador (EP-07). */
export interface ExternalOpenResult {
  /** true si el recurso se abrió. */
  opened: boolean
  /** Programa usado, si se pudo abrir (p. ej. «Visual Studio Code»). */
  program: string | null
  /** Explicación legible del resultado. */
  message: string
}
