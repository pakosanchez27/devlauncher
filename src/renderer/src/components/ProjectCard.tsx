import { useState } from 'react'
import type { ReactElement } from 'react'
import { frameworkLabel } from '@shared/constants/frameworks'
import type {
  LaunchServiceKind,
  LaunchServiceStatus,
  LaunchSession,
  LaunchState
} from '@shared/types/launcher'
import type { Project } from '@shared/types/project'
import { frameworkBadgeClass } from '../lib/framework-colors'
import ProjectRequirements from './ProjectRequirements'

const STATE_LABELS: Record<LaunchState, string> = {
  idle: 'Sin arrancar',
  starting: 'Arrancando',
  ready: 'En marcha',
  failed: 'Con errores',
  stopped: 'Detenido'
}

const STATE_TEXT_CLASSES: Record<LaunchState, string> = {
  idle: 'text-slate-400',
  starting: 'text-amber-300',
  ready: 'text-emerald-300',
  failed: 'text-red-300',
  stopped: 'text-slate-400'
}

const STATE_DOT_CLASSES: Record<LaunchState, string> = {
  idle: 'bg-slate-600',
  starting: 'animate-pulse bg-amber-400',
  ready: 'bg-emerald-400',
  failed: 'bg-red-400',
  stopped: 'bg-slate-600'
}

const SERVICE_KIND_LABELS: Record<LaunchServiceKind, string> = {
  wamp: 'WAMP',
  php: 'PHP',
  vite: 'Vite'
}

const SERVICE_DOT_CLASSES: Record<LaunchServiceStatus, string> = {
  running: 'bg-emerald-400',
  stopped: 'bg-slate-600',
  failed: 'bg-red-400'
}

export type ProjectCardAction = 'stop' | 'restart'

interface ProjectCardProps {
  project: Project
  busy: boolean
  /** Sesión de arranque del proyecto (si nunca se arrancó, undefined). */
  session: LaunchSession | undefined
  /** Acción en curso sobre esta tarjeta (detener o reiniciar). */
  pendingAction: ProjectCardAction | undefined
  onLaunch: (project: Project) => void
  onStop: (project: Project) => void
  onRestart: (project: Project) => void
  onOpen: (project: Project) => void
  onRename: (id: string, name: string) => void
  onDelete: (project: Project) => void
}

/** Tarjeta del catálogo: estado, servicios, ruta y acciones principales. */
function ProjectCard({
  project,
  busy,
  session,
  pendingAction,
  onLaunch,
  onStop,
  onRestart,
  onOpen,
  onRename,
  onDelete
}: ProjectCardProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [showRequirements, setShowRequirements] = useState(false)

  const state = session?.state ?? 'idle'
  const isStarting = state === 'starting'
  const isRunning = state === 'ready' || isStarting
  const isRestarting = pendingAction === 'restart'
  const isStopping = pendingAction === 'stop'
  const services = session && session.state !== 'stopped' ? session.services : []

  function startEditing(): void {
    setDraftName(project.name)
    setEditing(true)
  }

  function commit(): void {
    const name = draftName.trim()
    if (name && name !== project.name) onRename(project.id, name)
    setEditing(false)
  }

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-5 transition hover:border-slate-700">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`flex items-center gap-2 text-[11px] uppercase tracking-wide ${STATE_TEXT_CLASSES[state]}`}
        >
          <span className={`h-2 w-2 rounded-full ${STATE_DOT_CLASSES[state]}`} />
          {STATE_LABELS[state]}
        </span>
        <span
          className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${frameworkBadgeClass(project.framework)}`}
        >
          {frameworkLabel(project.framework)}
        </span>
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
              if (event.key === 'Escape') setEditing(false)
            }}
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus:border-indigo-500"
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium text-slate-100" title={project.name}>
              {project.name}
            </h3>
            {!project.detected && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                sin detectar
              </span>
            )}
          </div>
        )}
        <p className="mt-1 truncate font-mono text-xs text-slate-500" title={project.path}>
          {project.path}
        </p>
      </div>

      {services.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {services.map((service) => (
            <li
              key={service.id}
              title={`${service.label}${service.pid !== null ? ` · PID ${service.pid}` : ''}`}
              className="flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-300"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${SERVICE_DOT_CLASSES[service.status]}`} />
              {SERVICE_KIND_LABELS[service.kind]}
              {service.ports.length > 0 && (
                <span className="font-mono text-slate-500">:{service.ports.join(', :')}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {state === 'failed' && session?.error && (
        <p className="line-clamp-2 text-xs text-red-300" title={session.error}>
          {session.error}
        </p>
      )}

      <div className="mt-auto flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          {isRunning ? (
            <button
              onClick={() => onStop(project)}
              disabled={busy || isStarting || isStopping || isRestarting}
              className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:border-red-500 disabled:opacity-50"
            >
              {isStopping ? 'Deteniendo…' : isStarting ? 'Arrancando…' : '■ Detener entorno'}
            </button>
          ) : (
            <button
              onClick={() => onLaunch(project)}
              disabled={busy || isRestarting}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
            >
              ▶ Iniciar entorno
            </button>
          )}
          <button
            onClick={() => onRestart(project)}
            disabled={busy || isStarting || isRestarting}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
          >
            {isRestarting ? 'Reiniciando…' : '↻ Reiniciar'}
          </button>
          {state === 'ready' && session?.urls.app && (
            <a
              href={session.urls.app}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-indigo-800/60 bg-indigo-950/30 px-3 py-1.5 text-xs text-indigo-300 transition hover:border-indigo-500"
            >
              Abrir aplicación
            </a>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
          <button
            onClick={() => onOpen(project)}
            disabled={busy || isRestarting}
            className="transition hover:text-slate-200 disabled:opacity-50"
          >
            Abrir carpeta
          </button>
          <button
            onClick={() => setShowRequirements((value) => !value)}
            disabled={busy || isRestarting}
            className="transition hover:text-slate-200 disabled:opacity-50"
          >
            {showRequirements ? 'Ocultar requisitos' : 'Requisitos'}
          </button>
          <button
            onClick={startEditing}
            disabled={busy || isRestarting}
            className="transition hover:text-slate-200 disabled:opacity-50"
          >
            Renombrar
          </button>
          <button
            onClick={() => onDelete(project)}
            disabled={busy || isRestarting}
            className="text-red-300 transition hover:text-red-200 disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>

      {showRequirements && <ProjectRequirements projectPath={project.path} />}
    </article>
  )
}

export default ProjectCard
