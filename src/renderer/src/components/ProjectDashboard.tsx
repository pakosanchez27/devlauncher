import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { frameworkLabel } from '@shared/constants/frameworks'
import type { LaunchSession } from '@shared/types/launcher'
import type { Framework, Project } from '@shared/types/project'
import DashboardStats from './DashboardStats'
import ProjectCard from './ProjectCard'
import type { ProjectCardAction } from './ProjectCard'
import { frameworkBadgeClass } from '../lib/framework-colors'
import { messageFromError } from '../lib/ipc-error'

type FrameworkFilter = Framework | 'all'

/** Clases de un chip del filtro: resaltado si está activo. */
function chipClasses(active: boolean, framework: FrameworkFilter): string {
  const base = 'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition'
  if (!active) return `${base} border-slate-700 text-slate-400 hover:border-slate-500`
  if (framework === 'all') return `${base} border-indigo-500/60 bg-indigo-500/15 text-indigo-200`
  return `${base} ${frameworkBadgeClass(framework)}`
}

/**
 * Dashboard (EP-06): resumen del catálogo y tarjetas de proyecto con su
 * tecnología, ruta, estado del entorno y acciones rápidas.
 */
function ProjectDashboard(): ReactElement {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FrameworkFilter>('all')
  const [sessions, setSessions] = useState<Record<string, LaunchSession>>({})
  const [pending, setPending] = useState<Record<string, ProjectCardAction>>({})

  const reload = useCallback(async (): Promise<void> => {
    setProjects(await window.api.projects.list())
  }, [])

  useEffect(() => {
    reload()
      .catch((cause: unknown) => setError(messageFromError(cause)))
      .finally(() => setLoading(false))
  }, [reload])

  // Estado de cada entorno: la sesión llega por eventos y alimenta la tarjeta.
  useEffect(() => {
    let active = true

    window.api.launcher
      .status()
      .then((current) => {
        if (!active) return
        setSessions(Object.fromEntries(current.map((session) => [session.projectId, session])))
      })
      .catch((cause: unknown) => setError(messageFromError(cause)))

    const unsubscribe = window.api.launcher.onEvent((event) => {
      if (event.type !== 'session') return
      setSessions((previous) => ({
        ...previous,
        [event.session.projectId]: event.session
      }))
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const counts = useMemo(() => {
    const map = new Map<Framework, number>()
    for (const project of projects)
      map.set(project.framework, (map.get(project.framework) ?? 0) + 1)
    return map
  }, [projects])

  const stats = useMemo(() => {
    let running = 0
    let starting = 0
    let failed = 0
    let services = 0

    for (const project of projects) {
      const session = sessions[project.id]
      if (!session) continue

      if (session.state === 'ready') running += 1
      else if (session.state === 'starting') starting += 1
      else if (session.state === 'failed') failed += 1

      services += session.services.filter((service) => service.status === 'running').length
    }

    return { total: projects.length, running, starting, failed, services }
  }, [projects, sessions])

  // Si el filtro activo deja de tener proyectos (p. ej. tras eliminarlos), vuelve a «Todos».
  useEffect(() => {
    if (filter !== 'all' && !counts.has(filter)) setFilter('all')
  }, [filter, counts])

  const visibleProjects =
    filter === 'all' ? projects : projects.filter((project) => project.framework === filter)

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setBusy(false)
    }
  }

  function handleAdd(): void {
    void run(async () => {
      const folder = await window.api.projects.selectFolder()
      if (!folder) return

      const detection = await window.api.projects.detect(folder)
      if (detection.framework === 'unknown') {
        const proceed = window.confirm(
          `No se reconoció el tipo de proyecto en "${folder}".\n\n${detection.reason}\n\n¿Quieres registrarlo de todos modos?`
        )
        if (!proceed) return
      }

      await window.api.projects.add({
        path: folder,
        name: detection.name ?? undefined,
        framework: detection.framework
      })
      await reload()
    })
  }

  // Arrancar/parar no bloquea el catálogo: el estado llega por eventos y así se
  // pueden lanzar varios entornos en paralelo.
  function handleLaunch(project: Project): void {
    setError(null)
    window.api.launcher
      .start(project.id)
      .catch((cause: unknown) => setError(messageFromError(cause)))
  }

  function handleStop(project: Project): void {
    setError(null)
    setPending((previous) => ({ ...previous, [project.id]: 'stop' }))
    window.api.launcher
      .stop(project.id)
      .catch((cause: unknown) => setError(messageFromError(cause)))
      .finally(() => clearPending(project.id))
  }

  function clearPending(projectId: string): void {
    setPending((previous) => {
      const next = { ...previous }
      delete next[projectId]
      return next
    })
  }

  /** Reinicio completo: detiene los servicios y vuelve a arrancar el entorno. */
  async function handleRestart(project: Project): Promise<void> {
    setError(null)
    setPending((previous) => ({ ...previous, [project.id]: 'restart' }))
    try {
      await window.api.launcher.stop(project.id)
      await window.api.launcher.start(project.id)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      clearPending(project.id)
    }
  }

  function handleOpen(project: Project): void {
    void run(async () => {
      await window.api.projects.open(project.id)
      await reload()
    })
  }

  /** Abre la aplicación del entorno en el navegador configurado (EP-07). */
  function handleOpenUrl(project: Project): void {
    void run(async () => {
      const result = await window.api.launcher.openUrl(project.id)
      if (!result.opened) setError(result.message)
    })
  }

  /** Acceso rápido al código: abre el proyecto en el editor (EP-07). */
  function handleOpenEditor(project: Project): void {
    void run(async () => {
      const result = await window.api.projects.openEditor(project.id)
      if (!result.opened) setError(result.message)
    })
  }

  function handleRename(id: string, name: string): void {
    void run(async () => {
      await window.api.projects.update(id, { name })
      await reload()
    })
  }

  function handleDelete(project: Project): void {
    const confirmed = window.confirm(
      `¿Eliminar "${project.name}" del catálogo?\n\nEl proyecto en disco no se borra.`
    )
    if (!confirmed) return

    void run(async () => {
      // Un proyecto eliminado no debe dejar su entorno corriendo.
      const state = sessions[project.id]?.state
      if (state === 'ready' || state === 'starting') {
        await window.api.launcher.stop(project.id)
      }
      await window.api.projects.remove(project.id)
      await reload()
    })
  }

  return (
    <section className="flex flex-col gap-5">
      <DashboardStats {...stats} />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Proyectos</h2>
            <p className="text-sm text-slate-400">
              Catálogo persistente de proyectos (Laravel, CodeIgniter, React…).
            </p>
          </div>
          <button
            onClick={handleAdd}
            disabled={busy}
            className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
          >
            {busy ? 'Procesando…' : 'Añadir proyecto'}
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {!loading && projects.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            <button
              onClick={() => setFilter('all')}
              className={chipClasses(filter === 'all', 'all')}
            >
              Todos
              <span className="rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-300">
                {projects.length}
              </span>
            </button>
            {[...counts.entries()].map(([framework, count]) => (
              <button
                key={framework}
                onClick={() => setFilter(framework)}
                className={chipClasses(filter === framework, framework)}
              >
                {frameworkLabel(framework)}
                <span className="rounded-full bg-slate-800/60 px-1.5 text-[10px]">{count}</span>
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((placeholder) => (
              <div
                key={placeholder}
                className="h-44 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
            Aún no has añadido proyectos. Pulsa «Añadir proyecto» para seleccionar una carpeta.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                busy={busy}
                session={sessions[project.id]}
                pendingAction={pending[project.id]}
                onLaunch={handleLaunch}
                onStop={handleStop}
                onRestart={handleRestart}
                onOpen={handleOpen}
                onOpenUrl={handleOpenUrl}
                onOpenEditor={handleOpenEditor}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default ProjectDashboard
