import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '@shared/constants/channels'
import type { ExportLogsRequest, ExportLogsResult } from '@shared/types/ipc'

/**
 * Exportación de registros (EP-08).
 *
 * El renderer conserva la salida en memoria; para compartirla o analizarla
 * fuera de la aplicación se guarda en un archivo mediante el diálogo nativo.
 * El contenido se valida y se limita su tamaño para no bloquear el proceso
 * principal con una escritura desmesurada.
 */

const MAX_EXPORT_BYTES = 5 * 1024 * 1024

/** Limpia un nombre propuesto para que sea válido en Windows. */
function safeFileName(value: string): string {
  const base = value
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\p{Cc}/gu, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
  if (!base) return 'devlauncher-registro.log'
  return /\.(log|txt)$/i.test(base) ? base : `${base}.log`
}

export function registerLogsIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.LOGS_EXPORT,
    async (event, request: ExportLogsRequest): Promise<ExportLogsResult> => {
      if (
        !request ||
        typeof request.suggestedName !== 'string' ||
        typeof request.content !== 'string'
      ) {
        throw new Error('La solicitud de exportación no es válida.')
      }

      if (Buffer.byteLength(request.content, 'utf8') > MAX_EXPORT_BYTES) {
        throw new Error('El registro es demasiado grande para exportarlo.')
      }

      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        title: 'Guardar registro',
        defaultPath: join(app.getPath('downloads'), safeFileName(request.suggestedName)),
        filters: [
          { name: 'Archivo de registro', extensions: ['log', 'txt'] },
          { name: 'Todos los archivos', extensions: ['*'] }
        ]
      }
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options)

      if (result.canceled || !result.filePath) return { saved: false }

      await writeFile(result.filePath, request.content, 'utf8')
      return { saved: true, path: result.filePath }
    }
  )
}
