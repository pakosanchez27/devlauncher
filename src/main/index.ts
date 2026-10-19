import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { cleanupOrphanedProcesses, stopAllManagedProcesses } from './services/process.service'

/** Crea la ventana principal de DevLauncher con la configuración de seguridad. */
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'DevLauncher',
    backgroundColor: '#020617',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Seguridad: sin acceso a Node en el renderer, contexto aislado y
      // comunicación exclusivamente a través del contextBridge del preload.
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // En desarrollo carga el servidor de Vite; en producción, el HTML compilado.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Dos instancias de DevLauncher se pisarían los procesos y los puertos: solo
// una puede ejecutarse; la segunda trae al frente la ventana existente.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.devlauncher.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Si la ejecución anterior terminó de forma anómala, pueden quedar procesos
    // (artisan serve, Vite) ocupando sus puertos: se limpian antes de mostrar la UI.
    await cleanupOrphanedProcesses()

    registerIpcHandlers()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  // Al cerrar DevLauncher no se dejan procesos huérfanos (artisan serve, Vite…).
  // Se espera a que `taskkill` termine antes de salir de verdad.
  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    void stopAllManagedProcesses().finally(() => app.quit())
  })
}
