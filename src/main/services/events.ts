import { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { LauncherEvent } from '@shared/types/launcher'

/**
 * Envía un evento del motor de automatización (EP-04) a todas las ventanas
 * abiertas. Canal de solo emisión: main → renderer.
 */
export function broadcastLauncherEvent(event: LauncherEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.LAUNCHER_EVENT, event)
  }
}
