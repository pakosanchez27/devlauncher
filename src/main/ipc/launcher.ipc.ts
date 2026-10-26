import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { LaunchSession, ManagedProcessInfo } from '@shared/types/launcher'
import type { ExternalOpenResult } from '@shared/types/environment'
import {
  getLaunchSessions,
  openProjectUrl,
  startProjectEnvironment,
  stopProjectEnvironment,
  stopServiceProcess
} from '../services/launcher.service'
import { listManagedProcesses } from '../services/process.service'

/** Handlers IPC del motor de automatización y del gestor de procesos (EP-04/EP-05). */
export function registerLauncherIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_START, (_event, projectId: string): Promise<LaunchSession> =>
    startProjectEnvironment(projectId)
  )

  ipcMain.handle(
    IPC_CHANNELS.LAUNCHER_STOP,
    (_event, projectId?: string): Promise<LaunchSession[]> => stopProjectEnvironment(projectId)
  )

  ipcMain.handle(
    IPC_CHANNELS.LAUNCHER_STOP_SERVICE,
    (_event, serviceId: string): Promise<ManagedProcessInfo | null> => stopServiceProcess(serviceId)
  )

  ipcMain.handle(IPC_CHANNELS.LAUNCHER_STATUS, (): LaunchSession[] => getLaunchSessions())

  ipcMain.handle(IPC_CHANNELS.LAUNCHER_PROCESSES, (): ManagedProcessInfo[] =>
    listManagedProcesses()
  )

  ipcMain.handle(
    IPC_CHANNELS.LAUNCHER_OPEN_URL,
    (_event, projectId: string): Promise<ExternalOpenResult> => openProjectUrl(projectId)
  )
}
