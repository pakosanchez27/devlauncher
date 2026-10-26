import type { ReactElement } from 'react'
import { useLaunch } from '../../lib/launch-context'
import type { ViewId } from '../../lib/views'
import Icon from '../ui/Icon'
import type { IconName } from '../ui/Icon'

interface SidebarProps {
  view: ViewId
  onChange: (view: ViewId) => void
}

const NAV: Array<{ id: ViewId; label: string; icon: IconName }> = [
  { id: 'projects', label: 'Proyectos', icon: 'projects' },
  { id: 'activity', label: 'Actividad', icon: 'activity' },
  { id: 'settings', label: 'Ajustes', icon: 'settings' }
]

/** Barra lateral: marca, navegación y estado en vivo de los entornos. */
function Sidebar({ view, onChange }: SidebarProps): ReactElement {
  const { sessions } = useLaunch()

  const activeSessions = sessions.filter(
    (session) => session.state === 'ready' || session.state === 'starting'
  )
  const services = sessions.reduce(
    (total, session) =>
      total +
      (session.state === 'ready'
        ? session.services.filter((service) => service.status === 'running').length
        : 0),
    0
  )

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-slate-800/80 bg-slate-950 px-3 py-5">
      <div className="mb-7 flex items-center gap-3 px-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-lg font-bold text-white shadow-lg shadow-indigo-500/20">
          D
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-slate-100">DevLauncher</p>
          <p className="truncate text-[11px] text-slate-500">Tus proyectos, listos</p>
        </div>
      </div>

      <nav className="flex flex-col gap-1" aria-label="Secciones">
        {NAV.map((item) => {
          const isActive = view === item.id
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                isActive
                  ? 'bg-indigo-500/15 text-indigo-200'
                  : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              <Icon
                name={item.icon}
                size={18}
                className={
                  isActive ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300'
                }
              />
              <span className="flex-1 text-sm font-medium">{item.label}</span>
              {item.id === 'activity' && activeSessions.length > 0 && (
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                  {activeSessions.length}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <p className="flex items-center gap-2 text-[11px] font-medium text-slate-300">
          <span
            className={`h-1.5 w-1.5 rounded-full ${activeSessions.length > 0 ? 'bg-emerald-400' : 'bg-slate-600'}`}
            aria-hidden="true"
          />
          {activeSessions.length > 0
            ? `${activeSessions.length} entorno${activeSessions.length === 1 ? '' : 's'} activo${activeSessions.length === 1 ? '' : 's'}`
            : 'Sin entornos activos'}
        </p>
        <p className="mt-1 text-[11px] text-slate-500">
          {services > 0
            ? `${services} servicio${services === 1 ? '' : 's'} en ejecución`
            : 'Nada ejecutándose ahora'}
        </p>
      </div>
    </aside>
  )
}

export default Sidebar
