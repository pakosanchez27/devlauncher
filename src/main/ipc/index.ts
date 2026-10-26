import { registerAppIpcHandlers } from './app.ipc'
import { registerEnvironmentIpcHandlers } from './environment.ipc'
import { registerLauncherIpcHandlers } from './launcher.ipc'
import { registerLogsIpcHandlers } from './logs.ipc'
import { registerProjectIpcHandlers } from './project.ipc'

/**
 * Punto único de registro de todos los handlers IPC del proceso principal.
 * Añade aquí los nuevos módulos IPC a medida que crezcan las épicas.
 */
export function registerIpcHandlers(): void {
  registerAppIpcHandlers()
  registerProjectIpcHandlers()
  registerEnvironmentIpcHandlers()
  registerLauncherIpcHandlers()
  registerLogsIpcHandlers()
}
