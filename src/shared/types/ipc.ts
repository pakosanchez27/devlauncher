/**
 * Contratos de datos de los canales IPC.
 *
 * Se comparten entre el proceso principal, el preload y el renderer para que la
 * comunicación esté tipada de extremo a extremo.
 */

/** Petición enviada por el renderer al canal `app:ping`. */
export interface PingRequest {
  message: string
}

/** Respuesta devuelta por el proceso principal al canal `app:ping`. */
export interface PingResponse {
  reply: string
  timestamp: string
  runtime: string
}

/** Información del entorno anfitrión devuelta por el canal `app:get-info`. */
export interface AppInfo {
  name: string
  version: string
  electron: string
  node: string
  chrome: string
  platform: string
}

/** Petición para guardar la salida de un proceso en un archivo (EP-08). */
export interface ExportLogsRequest {
  /** Nombre propuesto en el diálogo de guardado. */
  suggestedName: string
  /** Contenido completo del registro. */
  content: string
}

/** Resultado de exportar un registro. */
export interface ExportLogsResult {
  saved: boolean
  /** Ruta del archivo cuando el usuario confirmó el guardado. */
  path?: string
}
