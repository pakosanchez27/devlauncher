import { useState } from 'react'
import type { ReactElement } from 'react'
import { frameworkLabel } from '@shared/constants/frameworks'
import type { LaunchState } from '@shared/types/launcher'
import type { Project } from '@shared/types/project'
import { frameworkBadgeClass } from '../lib/framework-colors'
import ProjectRequirements from './ProjectRequirements'

interface ProjectItemProps {
  project: Project
  busy: boolean
  /** Estado del entorno del proyecto (si nunca se arrancó, undefined). */
  launchState: LaunchState | undefined
  onLaunch: (project: Project) => void
  onStop: (project: Project) => void
  onOpen: (project: Project) => void
  onRename: (id: string, name: string) => void
  onDelete: (project: Project) => void
}

/** Fila del catálogo: nombre editable, ruta, requisitos y acciones. */
function ProjectItem({
  project,
  busy,
  launchState,
  onLaunch,
  onStop,
  onOpen,
  onRename,
  onDelete
}: ProjectItemProps): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(project.name)
  const [showRequirements, setShowRequirements] = useState(false)

  function startEditing(): void {
    setDraftName(project.name)
    setEditing(true)
  }

  function commit(): void {
    const name = draftName.trim()
    if (name && name !== project.name) onRename(project.id, name)
    setEditing(false)
  }

  const isStarting = launchState === 'starting'
  const isRunning = launchState === 'ready' || isStarting

  return (
    <li className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
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
              <span className="truncate font-medium text-slate-100">{project.name}</span>
              <span
                className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${frameworkBadgeClass(project.framework)}`}
              >
                {frameworkLabel(project.framework)}
              </span>
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

        <div className="flex shrink-0 flex-wrap gap-2">
          {isRunning ? (
            <button
              onClick={() => onStop(project)}
              disabled={busy || isStarting}
              className="rounded-lg border border-red-800/60 px-3 py-1.5 text-xs font-medium text-red-300 transition hover:border-red-500 disabled:opacity-50"
            >
              {isStarting ? 'Arrancando…' : '■ Detener entorno'}
            </button>
          ) : (
            <button
              onClick={() => onLaunch(project)}
              disabled={busy}
              className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-emerald-400 disabled:opacity-50"
            >
              ▶ Iniciar entorno
            </button>
          )}
          <button
            onClick={() => onOpen(project)}
            disabled={busy}
            className="rounded-lg border border-emerald-800/60 px-3 py-1.5 text-xs text-emerald-300 transition hover:border-emerald-500 disabled:opacity-50"
          >
            Abrir carpeta
          </button>
          <button
            onClick={() => setShowRequirements((value) => !value)}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
          >
            {showRequirements ? 'Ocultar requisitos' : 'Requisitos'}
          </button>
          <button
            onClick={startEditing}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
          >
            Renombrar
          </button>
          <button
            onClick={() => onDelete(project)}
            disabled={busy}
            className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-600 disabled:opacity-50"
          >
            Eliminar
          </button>
        </div>
      </div>

      {showRequirements && <ProjectRequirements projectPath={project.path} />}
    </li>
  )
}

export default ProjectItem
