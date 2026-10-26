import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { ProjectRequirementsReport } from '@shared/types/environment'
import type { Framework } from '@shared/types/project'
import { messageFromError } from '../lib/ipc-error'
import Badge from './ui/Badge'
import Icon from './ui/Icon'

interface ProjectRequirementsProps {
  projectPath: string
  framework: Framework
}

/** Comprobación de los requisitos de un proyecto según su framework. */
function ProjectRequirements({ projectPath, framework }: ProjectRequirementsProps): ReactElement {
  const [report, setReport] = useState<ProjectRequirementsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)

    window.api.environment
      .checkProject(projectPath, framework)
      .then((result) => {
        if (active) setReport(result)
      })
      .catch((cause: unknown) => {
        if (active) setError(messageFromError(cause))
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [projectPath, framework])

  if (loading) {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-400">
        <Icon name="spinner" size={13} className="animate-spin" />
        Comprobando requisitos…
      </p>
    )
  }
  if (error) {
    return (
      <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
        {error}
      </p>
    )
  }
  if (!report) {
    return <p className="mt-3 text-xs text-slate-500">Sin datos de requisitos.</p>
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Requisitos</p>
        {report.missing.length === 0 ? (
          <Badge tone="success">Todo listo</Badge>
        ) : (
          <Badge tone="warning">
            {report.missing.length} pendiente{report.missing.length === 1 ? '' : 's'}
          </Badge>
        )}
      </div>

      {report.missing.length > 0 && (
        <p className="mt-2 text-xs text-amber-300">
          Faltan requisitos obligatorios: {report.missing.join(', ')}.
        </p>
      )}

      <ul className="mt-2 flex flex-col gap-1.5">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-xs">
            <Icon
              name={check.present ? 'check' : 'x'}
              size={13}
              className={`mt-0.5 shrink-0 ${check.present ? 'text-emerald-400' : 'text-red-400'}`}
            />
            <span className="min-w-0">
              <span className="text-slate-200">{check.label}</span>
              {check.required && <span className="ml-1 text-slate-500">(obligatorio)</span>}
              {!check.present && check.hint && (
                <span className="mt-0.5 block text-slate-500">{check.hint}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ProjectRequirements
