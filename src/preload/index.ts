import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { AppInfo, PingRequest, PingResponse } from '@shared/types/ipc'
import type {
  FrameworkDetection,
  Project,
  ProjectDraft,
  ProjectUpdate
} from '@shared/types/project'
import type {
  AppSettings,
  EnvironmentReport,
  PortInspection,
  PortsReport,
  ProjectRequirementsReport
} from '@shared/types/environment'
import type { LauncherEvent, LaunchSession, ManagedProcessInfo } from '@shared/types/launcher'

/**
 * API expuesta al renderer. Es una superficie blanca y tipada: el renderer
 * nunca accede directamente a `ipcRenderer`, solo a estos métodos.
 */
const api = {
  ping: (request: PingRequest): Promise<PingResponse> =>
    ipcRenderer.invoke(IPC_CHANNELS.APP_PING, request),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_INFO),

  projects: {
    list: (): Promise<Project[]> => ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_LIST),
    selectFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_SELECT_FOLDER),
    detect: (folderPath: string): Promise<FrameworkDetection> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_DETECT, folderPath),
    add: (draft: ProjectDraft): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_ADD, draft),
    update: (id: string, changes: ProjectUpdate): Promise<Project> =>
      ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_UPDATE, id, changes),
    remove: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_DELETE, id),
    open: (id: string): Promise<Project> => ipcRenderer.invoke(IPC_CHANNELS.PROJECTS_OPEN, id)
  },

  environment: {
    check: (): Promise<EnvironmentReport> => ipcRenderer.invoke(IPC_CHANNELS.ENV_CHECK),
    checkProject: (projectPath: string): Promise<ProjectRequirementsReport> =>
      ipcRenderer.invoke(IPC_CHANNELS.ENV_CHECK_PROJECT, projectPath),
    checkPorts: (): Promise<PortsReport> => ipcRenderer.invoke(IPC_CHANNELS.ENV_CHECK_PORTS),
    inspectPort: (port: number): Promise<PortInspection> =>
      ipcRenderer.invoke(IPC_CHANNELS.ENV_INSPECT_PORT, port)
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    update: (changes: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, changes)
  },

  launcher: {
    start: (projectId: string): Promise<LaunchSession> =>
      ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_START, projectId),
    /** Detiene un entorno concreto o todos si se omite `projectId`. */
    stop: (projectId?: string): Promise<LaunchSession[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_STOP, projectId),
    stopService: (serviceId: string): Promise<ManagedProcessInfo | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_STOP_SERVICE, serviceId),
    status: (): Promise<LaunchSession[]> => ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_STATUS),
    processes: (): Promise<ManagedProcessInfo[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.LAUNCHER_PROCESSES),
    /** Se suscribe a los eventos del motor; devuelve la función para cancelarla. */
    onEvent: (listener: (event: LauncherEvent) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, payload: LauncherEvent): void => listener(payload)
      ipcRenderer.on(IPC_CHANNELS.LAUNCHER_EVENT, handler)
      return () => {
        ipcRenderer.removeListener(IPC_CHANNELS.LAUNCHER_EVENT, handler)
      }
    }
  }
}

export type DevLauncherApi = typeof api

// Con `contextIsolation: true` la API se inyecta mediante el puente seguro.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error('No se pudo exponer la API segura mediante contextBridge:', error)
  }
} else {
  // Reserva para entornos sin aislamiento de contexto (no recomendado).
  window.electron = electronAPI
  window.api = api
}
