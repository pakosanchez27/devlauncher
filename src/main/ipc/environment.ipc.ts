import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type {
  AppSettings,
  EnvironmentReport,
  PhpInstallation,
  PortInspection,
  PortsReport,
  ProjectRequirementsReport
} from '@shared/types/environment'
import type { Framework } from '@shared/types/project'
import {
  checkEnvironment,
  checkPorts,
  checkProjectRequirements,
  inspectPhp,
  listPhpInstallations
} from '../services/environment.service'
import { inspectPort } from '../services/ports.service'
import { detectFramework } from '../services/project.service'
import { getSettings, updateSettings } from '../services/settings.service'

/** Handlers IPC del verificador de entorno y de las preferencias globales. */
export function registerEnvironmentIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.ENV_CHECK, (): Promise<EnvironmentReport> => checkEnvironment())

  // El framework es opcional: si no lo envía el renderer se detecta al vuelo.
  ipcMain.handle(
    IPC_CHANNELS.ENV_CHECK_PROJECT,
    async (
      _event,
      projectPath: string,
      framework?: Framework
    ): Promise<ProjectRequirementsReport> => {
      const target = framework ?? (await detectFramework(projectPath)).framework
      return checkProjectRequirements(projectPath, target)
    }
  )

  ipcMain.handle(IPC_CHANNELS.ENV_CHECK_PORTS, (): Promise<PortsReport> => checkPorts())

  ipcMain.handle(IPC_CHANNELS.ENV_INSPECT_PORT, (_event, port: number): Promise<PortInspection> =>
    inspectPort(port)
  )

  ipcMain.handle(IPC_CHANNELS.ENV_LIST_PHP, (): Promise<PhpInstallation[]> =>
    listPhpInstallations()
  )

  ipcMain.handle(IPC_CHANNELS.ENV_INSPECT_PHP, (_event, path: string): Promise<PhpInstallation> =>
    inspectPhp(path)
  )

  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, (): Promise<AppSettings> => getSettings())

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_UPDATE,
    (_event, changes: Partial<AppSettings>): Promise<AppSettings> => updateSettings(changes)
  )
}
