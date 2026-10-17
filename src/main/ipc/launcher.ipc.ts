import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { LaunchSession } from '@shared/types/launcher'
import {
  getLaunchSession,
  startProjectEnvironment,
  stopProjectEnvironment
} from '../services/launcher.service'

/** Handlers IPC del motor de automatización (EP-04). */
export function registerLauncherIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LAUNCHER_START, (_event, projectId: string): Promise<LaunchSession> =>
    startProjectEnvironment(projectId)
  )

  ipcMain.handle(IPC_CHANNELS.LAUNCHER_STOP, (): Promise<LaunchSession | null> =>
    stopProjectEnvironment()
  )

  ipcMain.handle(IPC_CHANNELS.LAUNCHER_STATUS, (): LaunchSession | null => getLaunchSession())
}
