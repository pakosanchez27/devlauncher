import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type {
  FrameworkDetection,
  Project,
  ProjectDraft,
  ProjectUpdate
} from '@shared/types/project'
import type { ExternalOpenResult } from '@shared/types/environment'
import {
  addProject,
  deleteProject,
  detectFramework,
  getProjects,
  openProject,
  openProjectInEditorById,
  updateProject
} from '../services/project.service'

/**
 * Handlers IPC de gestión de proyectos.
 *
 * El diálogo nativo del explorador de Windows se abre siempre en el proceso
 * principal; el renderer nunca accede al sistema de archivos directamente.
 */
export function registerProjectIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.PROJECTS_LIST, (): Promise<Project[]> => getProjects())

  ipcMain.handle(IPC_CHANNELS.PROJECTS_SELECT_FOLDER, async (event): Promise<string | null> => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Selecciona la carpeta del proyecto',
      buttonLabel: 'Seleccionar carpeta',
      properties: ['openDirectory' as const]
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS_DETECT,
    (_event, folderPath: string): Promise<FrameworkDetection> => detectFramework(folderPath)
  )

  ipcMain.handle(IPC_CHANNELS.PROJECTS_ADD, (_event, draft: ProjectDraft): Promise<Project> =>
    addProject(draft)
  )

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS_UPDATE,
    (_event, id: string, changes: ProjectUpdate): Promise<Project> => updateProject(id, changes)
  )

  ipcMain.handle(IPC_CHANNELS.PROJECTS_DELETE, (_event, id: string): Promise<void> =>
    deleteProject(id)
  )

  ipcMain.handle(IPC_CHANNELS.PROJECTS_OPEN, (_event, id: string): Promise<Project> =>
    openProject(id)
  )

  ipcMain.handle(
    IPC_CHANNELS.PROJECTS_OPEN_EDITOR,
    (_event, id: string): Promise<ExternalOpenResult> => openProjectInEditorById(id)
  )
}
