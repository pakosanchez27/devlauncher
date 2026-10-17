import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { AppInfo } from '@shared/types/ipc'

/** Muestra, vía IPC, la información del entorno anfitrión. */
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
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 className="mb-4 text-lg font-semibold">Entorno detectado (vía IPC)</h2>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!info && !error && <p className="text-sm text-slate-400">Cargando…</p>}

      {info && (
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {Object.entries(info).map(([key, value]) => (
            <div key={key} className="flex flex-col">
              <dt className="text-xs uppercase tracking-wide text-slate-500">{key}</dt>
              <dd className="font-mono text-sm text-slate-200">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

export default AppInfoCard
