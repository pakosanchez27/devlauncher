import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type {
  AppSettings,
  EnvironmentReport,
  PortInspection,
  PortsReport,
  ProjectRequirementsReport
} from '@shared/types/environment'
import {
  checkEnvironment,
  checkPorts,
  checkProjectRequirements
} from '../services/environment.service'
import { inspectPort } from '../services/ports.service'
import { getSettings, updateSettings } from '../services/settings.service'

/** Handlers IPC del verificador de entorno y de las preferencias globales. */
export function registerEnvironmentIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ENV_CHECK, (): Promise<EnvironmentReport> => checkEnvironment())

  ipcMain.handle(
    IPC_CHANNELS.ENV_CHECK_PROJECT,
    (_event, projectPath: string): Promise<ProjectRequirementsReport> =>
      checkProjectRequirements(projectPath)
  )

  ipcMain.handle(IPC_CHANNELS.ENV_CHECK_PORTS, (): Promise<PortsReport> => checkPorts())

  ipcMain.handle(IPC_CHANNELS.ENV_INSPECT_PORT, (_event, port: number): Promise<PortInspection> =>
    inspectPort(port)
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): Promise<AppSettings> => getSettings())

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    (_event, changes: Partial<AppSettings>): Promise<AppSettings> => updateSettings(changes)
  )
}
