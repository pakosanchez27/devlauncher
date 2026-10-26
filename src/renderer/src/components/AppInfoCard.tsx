import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { AppInfo } from '@shared/types/ipc'

const LABELS: Record<string, string> = {
  name: 'Aplicación',
  version: 'Versión',
  electron: 'Electron',
  node: 'Node.js',
  chrome: 'Chrome',
  platform: 'Plataforma'
}

/** Información del entorno anfitrión, obtenida por IPC. */
function AppInfoCard(): ReactElement {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api
      .getAppInfo()
      .then(setInfo)
      .catch((cause: unknown) => setError(String(cause)))
  }, [])

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold text-slate-100">Información de la aplicación</h2>
      <p className="mt-0.5 text-xs text-slate-400">Versiones del entorno de escritorio.</p>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      {!info && !error && <p className="mt-3 text-xs text-slate-500">Cargando…</p>}

      {info && (
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {Object.entries(info).map(([key, value]) => (
            <div key={key} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">
                {LABELS[key] ?? key}
              </dt>
              <dd className="truncate font-mono text-xs text-slate-300" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default AppInfoCard
