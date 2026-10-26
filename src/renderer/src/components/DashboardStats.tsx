import type { ReactElement } from 'react'

interface DashboardStatsProps {
  running: number
  starting: number
  failed: number
  /** Servicios (PHP, Vite, WAMP) actualmente en ejecución. */
  services: number
}

const TILES: Array<{
  key: keyof DashboardStatsProps
  label: string
  hint: string
  valueClass: string
  dotClass: string
}> = [
  {
    key: 'running',
    label: 'En marcha',
    hint: 'listos para usar',
    valueClass: 'text-emerald-300',
    dotClass: 'bg-emerald-400'
  },
  {
    key: 'starting',
    label: 'Arrancando',
    hint: 'en curso',
    valueClass: 'text-amber-300',
    dotClass: 'bg-amber-400'
  },
  {
    key: 'failed',
    label: 'Con errores',
    hint: 'requieren atención',
    valueClass: 'text-red-300',
    dotClass: 'bg-red-400'
  },
  {
    key: 'services',
    label: 'Servicios',
    hint: 'procesos activos',
    valueClass: 'text-indigo-300',
    dotClass: 'bg-indigo-400'
  }
]

/** Resumen compacto del estado de los entornos. */
function DashboardStats({
  running,
  starting,
  failed,
  services
}: DashboardStatsProps): ReactElement {
  const values: Record<keyof DashboardStatsProps, number> = {
    running,
    starting,
    failed,
    services
  }

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((tile) => (
        <div
          key={tile.key}
          className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
        >
          <dt className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${tile.dotClass}`} aria-hidden="true" />
            {tile.label}
          </dt>
          <dd className={`mt-1 text-2xl font-semibold tabular-nums ${tile.valueClass}`}>
            {values[tile.key]}
          </dd>
          <p className="text-[11px] text-slate-500">{tile.hint}</p>
        </div>
      ))}
    </dl>
  )
}

export default DashboardStats
