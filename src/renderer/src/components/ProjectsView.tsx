import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { frameworkLabel } from '@shared/constants/frameworks'
import type { Framework, FrameworkDetection, Project } from '@shared/types/project'
import { frameworkBadgeClass } from '../lib/framework-colors'
import { useLaunch } from '../lib/launch-context'
import { messageFromError } from '../lib/ipc-error'
import type { ViewId } from '../lib/views'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import EmptyState from './ui/EmptyState'
import Icon from './ui/Icon'
import { useToast } from './ui/Toast'
import DashboardStats from './DashboardStats'
import PhpVersionDialog from './PhpVersionDialog'
import ProjectCard from './ProjectCard'
import type { ProjectAction } from './ProjectCard'

type FrameworkFilter = Framework | 'all'

interface ProjectsViewProps {
  onNavigate: (view: ViewId) => void
}

/** Clases de un chip del filtro: resaltado si está activo. */
function chipClasses(active: boolean, framework: FrameworkFilter): string {
  const base =
    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition'
  if (!active)
    return `${base} border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200`
  if (framework === 'all') return `${base} border-indigo-500/50 bg-indigo-500/15 text-indigo-200`
  return `${base} ${frameworkBadgeClass(framework)}`
}

/** Vista de proyectos: catálogo, estado de los entornos y acciones rápidas. */
function ProjectsView({ onNavigate }: ProjectsViewProps): ReactElement {
  const { sessions } = useLaunch()
  const { notify } = useToast()

  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState<FrameworkFilter>('all')
  const [pending, setPending] = useState<Record<string, ProjectAction>>({})
  const [adding, setAdding] = useState(false)
  const [confirmingUnknown, setConfirmingUnknown] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null)
  const [phpTarget, setPhpTarget] = useState<Project | null>(null)
  const [unknownTarget, setUnknownTarget] = useState<{
    folder: string
    detection: FrameworkDetection
  } | null>(null)

  const sessionByProject = useMemo(
    () => new Map(sessions.map((session) => [session.projectId, session])),
    [sessions]
  )

  const reload = useCallback(async (): Promise<void> => {
    try {
      setProjects(await window.api.projects.list())
      setLoadError(null)
    } catch (cause) {
      setLoadError(messageFromError(cause))
    }
  }, [])

  useEffect(() => {
    reload().finally(() => setLoading(false))
  }, [reload])

  function setPendingAction(id: string, action: ProjectAction): void {
    setPending((previous) => ({ ...previous, [id]: action }))
  }

  function clearPendingAction(id: string): void {
    setPending((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  }

  function reportError(title: string, cause: unknown): void {
    notify({ tone: 'error', title, description: messageFromError(cause) })
  }

  async function registerProject(folder: string, detection: FrameworkDetection): Promise<void> {
    const project = await window.api.projects.add({
      path: folder,
      name: detection.name ?? undefined,
      framework: detection.framework
    })
    await reload()
    notify({
      tone: 'success',
      title: 'Proyecto añadido',
      description: `${project.name} ya está en el catálogo.`
    })
  }

  async function handleAdd(): Promise<void> {
    setAdding(true)
    try {
      const folder = await window.api.projects.selectFolder()
      if (!folder) return

      const detection = await window.api.projects.detect(folder)
      if (detection.framework === 'unknown') {
        setUnknownTarget({ folder, detection })
        return
      }

      await registerProject(folder, detection)
    } catch (cause) {
      reportError('No se pudo añadir el proyecto', cause)
    } finally {
      setAdding(false)
    }
  }

  async function confirmUnknown(): Promise<void> {
    if (!unknownTarget) return
    setConfirmingUnknown(true)
    try {
      await registerProject(unknownTarget.folder, unknownTarget.detection)
      setUnknownTarget(null)
    } catch (cause) {
      reportError('No se pudo añadir el proyecto', cause)
    } finally {
      setConfirmingUnknown(false)
    }
  }

  // Arrancar/parar no bloquea el catálogo: el estado llega por eventos y así se
  // pueden lanzar varios entornos en paralelo.
  function handleLaunch(project: Project): void {
    setPendingAction(project.id, 'launch')
    window.api.launcher
      .start(project.id)
      .then((session) => {
        if (session.state === 'failed') {
          notify({
            tone: 'error',
            title: 'No se pudo iniciar el entorno',
            description: session.error ?? 'Revisa la actividad para ver el detalle.'
          })
          return
        }
        notify({
          tone: 'success',
          title: 'Entorno iniciado',
          description: `${project.name} está listo para usar.`
        })
      })
      .catch((cause: unknown) => reportError('No se pudo iniciar el entorno', cause))
      .finally(() => clearPendingAction(project.id))
  }

  function handleStop(project: Project): void {
    setPendingAction(project.id, 'stop')
    window.api.launcher
      .stop(project.id)
      .then(() => {
        notify({ tone: 'info', title: 'Entorno detenido', description: project.name })
      })
      .catch((cause: unknown) => reportError('No se pudo detener el entorno', cause))
      .finally(() => clearPendingAction(project.id))
  }

  /** Reinicio completo: detiene los servicios y vuelve a arrancar el entorno. */
  function handleRestart(project: Project): void {
    setPendingAction(project.id, 'restart')
    window.api.launcher
      .stop(project.id)
      .then(() => window.api.launcher.start(project.id))
      .then((session) => {
        if (session.state === 'failed') {
          notify({
            tone: 'error',
            title: 'No se pudo reiniciar el entorno',
            description: session.error ?? 'Revisa la actividad para ver el detalle.'
          })
          return
        }
        notify({ tone: 'success', title: 'Entorno reiniciado', description: project.name })
      })
      .catch((cause: unknown) => reportError('No se pudo reiniciar el entorno', cause))
      .finally(() => clearPendingAction(project.id))
  }

  async function handleOpenUrl(project: Project): Promise<void> {
    try {
      const result = await window.api.launcher.openUrl(project.id)
      if (!result.opened) {
        notify({
          tone: 'error',
          title: 'No se pudo abrir la aplicación',
          description: result.message
        })
      }
    } catch (cause) {
      reportError('No se pudo abrir la aplicación', cause)
    }
  }

  async function handleOpenEditor(project: Project): Promise<void> {
    try {
      const result = await window.api.projects.openEditor(project.id)
      if (!result.opened) {
        notify({ tone: 'error', title: 'No se pudo abrir el editor', description: result.message })
        return
      }
      notify({ tone: 'success', title: 'Proyecto abierto', description: result.message })
    } catch (cause) {
      reportError('No se pudo abrir el editor', cause)
    }
  }

  async function handleOpenFolder(project: Project): Promise<void> {
    try {
      await window.api.projects.open(project.id)
      await reload()
    } catch (cause) {
      reportError('No se pudo abrir la carpeta', cause)
    }
  }

  async function handleRename(id: string, name: string): Promise<void> {
    try {
      await window.api.projects.update(id, { name })
      await reload()
      notify({ tone: 'success', title: 'Proyecto renombrado', description: name })
    } catch (cause) {
      reportError('No se pudo renombrar el proyecto', cause)
    }
  }

  function handlePhpSaved(updated: Project): void {
    setProjects((previous) =>
      previous.map((project) => (project.id === updated.id ? updated : project))
    )
    setPhpTarget(null)
    notify({
      tone: 'success',
      title: 'Versión de PHP actualizada',
      description: updated.phpPath
        ? 'Se usará en el próximo arranque o reinicio del entorno.'
        : 'Este proyecto usará el PHP global de Ajustes.'
    })
  }

  async function confirmDelete(): Promise<void> {
    const project = deleteTarget
    if (!project) return

    setPendingAction(project.id, 'delete')
    try {
      const state = sessionByProject.get(project.id)?.state
      if (state === 'ready' || state === 'starting') {
        await window.api.launcher.stop(project.id)
      }
      await window.api.projects.remove(project.id)
      await reload()
      setDeleteTarget(null)
      notify({
        tone: 'success',
        title: 'Proyecto eliminado',
        description: 'La carpeta en disco no se ha tocado.'
      })
    } catch (cause) {
      reportError('No se pudo eliminar el proyecto', cause)
    } finally {
      clearPendingAction(project.id)
    }
  }

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
      const session = sessionByProject.get(project.id)
      if (!session) continue

      if (session.state === 'ready') running += 1
      else if (session.state === 'starting') starting += 1
      else if (session.state === 'failed') failed += 1

      services += session.services.filter((service) => service.status === 'running').length
    }

    return { running, starting, failed, services }
  }, [projects, sessionByProject])

  // Si el filtro activo deja de tener proyectos (p. ej. tras eliminarlos), vuelve a «Todos».
  useEffect(() => {
    if (filter !== 'all' && !counts.has(filter)) setFilter('all')
  }, [filter, counts])

  const visibleProjects =
    filter === 'all' ? projects : projects.filter((project) => project.framework === filter)

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Proyectos</h1>
          <p className="mt-1 text-sm text-slate-400">
            {loading
              ? 'Cargando catálogo…'
              : `${projects.length} proyecto${projects.length === 1 ? '' : 's'} · ${stats.running} en marcha`}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={handleAdd} loading={adding}>
          {adding ? 'Añadiendo…' : 'Añadir proyecto'}
        </Button>
      </header>

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <span className="flex items-center gap-2">
            <Icon name="alert" size={15} className="shrink-0" />
            No se pudo cargar el catálogo: {loadError}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void reload()}>
            Reintentar
          </Button>
        </div>
      )}

      {!loading && projects.length > 0 && <DashboardStats {...stats} />}

      {!loading && projects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
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
              type="button"
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
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((placeholder) => (
            <div
              key={placeholder}
              className="h-48 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40"
            />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon="projects"
          title="Aún no hay proyectos"
          description="DevLauncher arranca tus proyectos PHP y JavaScript sin escribir comandos. Añade la carpeta de un proyecto para empezar."
          steps={[
            'Añade la carpeta de tu proyecto (Laravel, CodeIgniter, React, Next.js…).',
            'Pulsa «Iniciar entorno» y espera a que todos los pasos estén en verde.',
            'Abre la aplicación en el navegador y ponte a trabajar.'
          ]}
          action={
            <Button variant="primary" icon="plus" onClick={handleAdd} loading={adding}>
              {adding ? 'Añadiendo…' : 'Añadir mi primer proyecto'}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              session={sessionByProject.get(project.id)}
              pendingAction={pending[project.id]}
              onLaunch={handleLaunch}
              onStop={handleStop}
              onRestart={handleRestart}
              onOpenUrl={(target) => void handleOpenUrl(target)}
              onOpenEditor={(target) => void handleOpenEditor(target)}
              onOpenFolder={(target) => void handleOpenFolder(target)}
              onConfigurePhp={(target) => setPhpTarget(target)}
              onShowLogs={() => onNavigate('activity')}
              onRename={(id, name) => void handleRename(id, name)}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Eliminar «${deleteTarget?.name ?? ''}»`}
        description="Se quitará del catálogo de DevLauncher. La carpeta y los archivos del proyecto no se borran."
        confirmLabel="Eliminar"
        tone="danger"
        loading={deleteTarget !== null && pending[deleteTarget.id] === 'delete'}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={unknownTarget !== null}
        title="Framework no reconocido"
        description={
          <>
            <p>{unknownTarget?.detection.reason}</p>
            <p className="mt-2">
              ¿Quieres registrar la carpeta «{unknownTarget?.folder}» de todos modos? Podrás
              iniciarla como proyecto PHP o Node según su contenido.
            </p>
          </>
        }
        confirmLabel="Registrar de todos modos"
        loading={confirmingUnknown}
        onConfirm={() => void confirmUnknown()}
        onCancel={() => setUnknownTarget(null)}
      />

      <PhpVersionDialog
        project={phpTarget}
        onClose={() => setPhpTarget(null)}
        onSaved={handlePhpSaved}
      />
    </section>
  )
}

export default ProjectsView
