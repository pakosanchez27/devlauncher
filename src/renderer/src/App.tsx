import type { ReactElement } from 'react'
import AppInfoCard from './components/AppInfoCard'
import PingPanel from './components/PingPanel'
import ProjectManager from './components/ProjectManager'
import EnvironmentSection from './components/EnvironmentSection'
import LauncherPanel from './components/LauncherPanel'

/** Vista raíz del MVP: proyectos, verificador de entorno y diagnóstico. */
function App(): ReactElement {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-12">
        <header className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500 text-2xl font-bold">
            D
          </div>
          <div>
            <h1 className="text-2xl font-semibold">DevLauncher</h1>
            <p className="text-sm text-slate-400">Base del MVP · Electron + React + TypeScript</p>
          </div>
        </header>

        <ProjectManager />
        <LauncherPanel />
        <EnvironmentSection />

        <details className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
          <summary className="cursor-pointer text-sm text-slate-400">
            Diagnóstico del entorno
          </summary>
          <div className="mt-4 flex flex-col gap-6">
            <AppInfoCard />
            <PingPanel />
          </div>
        </details>

        <footer className="text-xs text-slate-500">EP-04 · Motor de automatización</footer>
      </div>
    </div>
  )
}

export default App
