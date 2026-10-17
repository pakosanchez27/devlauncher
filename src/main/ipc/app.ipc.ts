import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { AppInfo, PingRequest, PingResponse } from '@shared/types/ipc'
import { buildAppInfo, buildPingResponse } from '../services'

/**
 * Handlers IPC de la aplicación.
 *
 * Cada canal se registra con `ipcMain.handle` (petición/respuesta). El renderer
 * solo puede invocarlos a través de la API expuesta en el preload.
 */
export function registerAppIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_INFO, (): AppInfo => buildAppInfo())

  ipcMain.handle(IPC_CHANNELS.APP_PING, (_event, request: PingRequest): PingResponse => {
    return buildPingResponse(request)
  })
}
