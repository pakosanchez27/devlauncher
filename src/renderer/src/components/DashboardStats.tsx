import type { ReactElement } from 'react'

interface DashboardStatsProps {
  total: number
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
}> = [
  { key: 'total', label: 'Proyectos', hint: 'registrados', valueClass: 'text-slate-100' },
  { key: 'running', label: 'En marcha', hint: 'entornos activos', valueClass: 'text-emerald-300' },
  { key: 'starting', label: 'Arrancando', hint: 'en curso', valueClass: 'text-amber-300' },
  { key: 'failed', label: 'Con errores', hint: 'requieren atención', valueClass: 'text-red-300' },
  { key: 'services', label: 'Servicios', hint: 'procesos activos', valueClass: 'text-indigo-300' }
]

/** Resumen del catálogo: proyectos registrados y estado de sus entornos. */
function DashboardStats({
  total,
  running,
  starting,
  failed,
  services
}: DashboardStatsProps): ReactElement {
  const values: Record<string, number> = { total, running, starting, failed, services }

  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map((tile) => (
        <div
          key={tile.key}
          className="rounded-2xl border border-slate-800 bg-slate-900/40 px-4 py-3"
        >
          <dt className="text-xs uppercase tracking-wide text-slate-500">{tile.label}</dt>
          <dd className={`mt-1 text-2xl font-semibold ${tile.valueClass}`}>{values[tile.key]}</dd>
          <p className="text-[11px] text-slate-500">{tile.hint}</p>
        </div>
      ))}
    </dl>
  )
}

export default DashboardStats
