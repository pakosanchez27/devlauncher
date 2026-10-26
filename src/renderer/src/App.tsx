import { useState } from 'react'
import type { ReactElement } from 'react'
import { LaunchProvider } from './lib/launch-context'
import type { ViewId } from './lib/views'
import Sidebar from './components/layout/Sidebar'
import ActivityView from './components/ActivityView'
import ProjectsView from './components/ProjectsView'
import SettingsView from './components/SettingsView'
import { ToastProvider } from './components/ui/Toast'

/** Estructura de la aplicación: navegación lateral y vista activa. */
function App(): ReactElement {
  const [view, setView] = useState<ViewId>('projects')

  return (
    <ToastProvider>
      <LaunchProvider>
        <div className="flex h-screen overflow-hidden bg-slate-950 text-slate-200">
          <Sidebar view={view} onChange={setView} />
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
              {view === 'projects' && <ProjectsView onNavigate={setView} />}
              {view === 'activity' && <ActivityView onNavigate={setView} />}
              {view === 'settings' && <SettingsView />}
            </div>
          </main>
        </div>
      </LaunchProvider>
    </ToastProvider>
  )
}

export default App
