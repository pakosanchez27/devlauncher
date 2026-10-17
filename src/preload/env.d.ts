import type { ElectronAPI } from '@electron-toolkit/preload'
import type { DevLauncherApi } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DevLauncherApi
  }
}
