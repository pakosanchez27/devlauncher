import type { ReactElement } from 'react'
import AppInfoCard from './components/AppInfoCard'
import PingPanel from './components/PingPanel'
import ProjectDashboard from './components/ProjectDashboard'
import EnvironmentSection from './components/EnvironmentSection'
import LauncherPanel from './components/LauncherPanel'
import PortsPanel from './components/PortsPanel'

/** Dashboard (EP-06): proyectos, entornos en marcha, procesos y diagnóstico. */
function App(): ReactElement {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-500 text-2xl font-bold">
              D
            </div>
            <div>
              <h1 className="text-2xl font-semibold">DevLauncher</h1>
              <p className="text-sm text-slate-400">
                Lanzador de proyectos · Electron + React + TypeScript
              </p>
            </div>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs text-slate-400">
            EP-06 · Dashboard e interfaz gráfica
          </span>
        </header>

        <ProjectDashboard />
        <LauncherPanel />
        <PortsPanel />
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

        <footer className="text-xs text-slate-500">EP-06 · Dashboard e interfaz gráfica</footer>
      </div>
    </div>
  )
}

export default App
