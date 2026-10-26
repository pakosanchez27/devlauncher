import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { frameworkLabel } from '@shared/constants/frameworks'
import type { LaunchSession } from '@shared/types/launcher'
import type { Project } from '@shared/types/project'
import { frameworkBadgeClass } from '../lib/framework-colors'
import { LAUNCH_STATE_LABELS, LAUNCH_STATE_TONES, SERVICE_KIND_LABELS } from '../lib/launch-labels'
import Badge from './ui/Badge'
import Button from './ui/Button'
import Icon from './ui/Icon'
import ProjectRequirements from './ProjectRequirements'

export type ProjectAction = 'launch' | 'stop' | 'restart' | 'delete'

const MENU_ITEM =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-800 hover:text-slate-100'

interface ProjectCardProps {
  project: Project
  /** Sesión de arranque del proyecto (si nunca se arrancó, undefined). */
  session: LaunchSession | undefined
  /** Acción en curso sobre esta tarjeta. */
  pendingAction: ProjectAction | undefined
  onLaunch: (project: Project) => void
  onStop: (project: Project) => void
  onRestart: (project: Project) => void
  onOpenUrl: (project: Project) => void
  onOpenEditor: (project: Project) => void
  onOpenFolder: (project: Project) => void
  onShowLogs: (project: Project) => void
  onRename: (id: string, name: string) => void
  onDelete: (project: Project) => void
}

/** Tarjeta del catálogo: estado, servicios, ruta y acciones principales. */
function ProjectCard({
  project,
  session,
  pendingAction,
  onLaunch,
  onStop,
  onRestart,
  onOpenUrl,
  onOpenEditor,
  onOpenFolder,
  onShowLogs,
  onRename,
  onDelete
}: ProjectCardProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [showRequirements, setShowRequirements] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const state = session?.state ?? 'idle'
  const isStarting = state === 'starting'
  const isReady = state === 'ready'
  const busy = pendingAction !== undefined
  const services = session && session.state !== 'stopped' ? session.services : []
  // Proyectos solo de frontend (Vite) no tienen servidor principal: se abre Vite.
  const appUrl = isReady ? (session?.urls.app ?? session?.urls.vite ?? null) : null

  const currentStep = session?.steps.find((step) => step.state === 'running')
  const totalSteps = session?.steps.length ?? 0
  const doneSteps =
    session?.steps.filter((step) => step.state === 'ready' || step.state === 'skipped').length ?? 0
  const progress = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0

  useEffect(() => {
    if (!menuOpen) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  function startEditing(): void {
    setMenuOpen(false)
    setDraftName(project.name)
    setEditing(true)
  }

  function commit(): void {
    const name = draftName.trim()
    if (name && name !== project.name) onRename(project.id, name)
    setEditing(false)
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-4 transition hover:border-slate-700">
      <div className="flex items-start justify-between gap-2">
        <Badge tone={LAUNCH_STATE_TONES[state]} dot>
          {LAUNCH_STATE_LABELS[state]}
        </Badge>

        <div className="flex items-center gap-1.5">
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${frameworkBadgeClass(project.framework)}`}
          >
            {frameworkLabel(project.framework)}
          </span>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-label={`Más acciones de ${project.name}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
            >
              <Icon name="dots" size={16} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-40 rounded-lg border border-slate-700 bg-slate-900 p-1 shadow-xl shadow-slate-950/60"
              >
                <button type="button" role="menuitem" onClick={startEditing} className={MENU_ITEM}>
                  <Icon name="pencil" size={14} />
                  Renombrar
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onDelete(project)
                  }}
                  className={`${MENU_ITEM} text-red-300 hover:bg-red-950/40 hover:text-red-200`}
                >
                  <Icon name="trash" size={14} />
                  Eliminar
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit()
              if (event.key === 'Escape') {
                // Evita que el blur guarde el nombre descartado.
                setDraftName(project.name)
                setEditing(false)
              }
            }}
            aria-label="Nombre del proyecto"
            className="w-full rounded-md border border-indigo-500/60 bg-slate-950 px-2 py-1 text-sm font-medium text-slate-100 outline-none"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100" title={project.name}>
              {project.name}
            </h3>
            {!project.detected && (
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                sin detectar
              </span>
            )}
          </div>
        )}
        <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={project.path}>
          {project.path}
        </p>
      </div>

      {isStarting && session && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-amber-200">
            <Icon name="spinner" size={13} className="shrink-0 animate-spin" />
            <span className="truncate">
              {currentStep ? currentStep.label : 'Preparando el entorno…'}
            </span>
            {totalSteps > 0 && (
              <span className="ml-auto shrink-0 text-[11px] tabular-nums text-amber-300/70">
                {doneSteps}/{totalSteps}
              </span>
            )}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-amber-500/15">
            <div
              className="h-full rounded-full bg-amber-400 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {currentStep?.message && (
            <p className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-amber-200/70">
              {currentStep.message}
            </p>
          )}
        </div>
      )}

      {services.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {services.map((service) => (
            <li
              key={service.id}
              title={`${service.label}${service.pid !== null ? ` · PID ${service.pid}` : ''}`}
              className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-300"
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  service.status === 'running'
                    ? 'bg-emerald-400'
                    : service.status === 'failed'
                      ? 'bg-red-400'
                      : 'bg-slate-500'
                }`}
                aria-hidden="true"
              />
              {SERVICE_KIND_LABELS[service.kind]}
              {service.ports.length > 0 && (
                <span className="font-mono text-slate-500">:{service.ports.join(', :')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {state === 'failed' && session?.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
          <div className="flex items-start gap-2 text-xs text-red-300">
            <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
            <p className="line-clamp-3 leading-relaxed">{session.error}</p>
          </div>
          <button
            type="button"
            onClick={() => onShowLogs(project)}
            className="mt-1.5 text-[11px] font-medium text-red-300 underline-offset-2 hover:underline"
          >
            Ver actividad y registro
          </button>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          {isReady ? (
            <>
              {appUrl && (
                <Button
                  variant="primary"
                  size="sm"
                  icon="browser"
                  onClick={() => onOpenUrl(project)}
                  title={appUrl}
                >
                  Abrir aplicación
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                icon="stop"
                onClick={() => onStop(project)}
                loading={pendingAction === 'stop'}
              >
                {pendingAction === 'stop' ? 'Deteniendo…' : 'Detener'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon="restart"
                onClick={() => onRestart(project)}
                disabled={busy}
                aria-label="Reiniciar entorno"
                title="Reiniciar entorno"
              />
            </>
          ) : isStarting ? (
            <Button variant="secondary" size="sm" loading disabled>
              Arrancando…
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              icon={state === 'failed' ? 'restart' : 'play'}
              onClick={() => onLaunch(project)}
              loading={pendingAction === 'launch'}
            >
              {pendingAction === 'launch'
                ? 'Iniciando…'
                : state === 'failed'
                  ? 'Reintentar'
                  : 'Iniciar entorno'}
            </Button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" icon="code" onClick={() => onOpenEditor(project)}>
            Editor
          </Button>
          <Button variant="ghost" size="sm" icon="folder" onClick={() => onOpenFolder(project)}>
            Carpeta
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="info"
            onClick={() => setShowRequirements((value) => !value)}
            aria-expanded={showRequirements}
          >
            {showRequirements ? 'Ocultar requisitos' : 'Requisitos'}
          </Button>
        </div>
      </div>

      {showRequirements && (
        <ProjectRequirements projectPath={project.path} framework={project.framework} />
      )}
    </article>
  )
}

export default ProjectCard
