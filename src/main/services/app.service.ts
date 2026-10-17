import { app } from 'electron'
import os from 'node:os'
import type { AppInfo, PingRequest, PingResponse } from '@shared/types/ipc'

/**
 * Servicios de la aplicación. Toda la lógica de negocio del proceso principal
 * vive aquí, separada de los handlers IPC y de la creación de ventanas.
 */

/** Recopila información del entorno anfitrión para mostrarla en la UI. */
export function buildAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${os.type()} ${os.release()} (${process.arch})`
  }
}

/** Respuesta de eco usada para verificar el canal IPC extremo a extremo. */
export function buildPingResponse(request: PingRequest): PingResponse {
  const message = request?.message?.trim() || '(sin mensaje)'
  return {
    reply: `pong: ${message}`,
    timestamp: new Date().toISOString(),
    runtime: `Electron ${process.versions.electron}`
  }
}
