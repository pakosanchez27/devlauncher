import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { ProjectRequirementsReport } from '@shared/types/environment'
import type { Framework } from '@shared/types/project'
import { messageFromError } from '../lib/ipc-error'

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

  if (loading) return <p className="text-xs text-slate-500">Comprobando requisitos…</p>
  if (error) return <p className="text-xs text-red-400">{error}</p>
  if (!report) return <p className="text-xs text-slate-500">Sin datos.</p>

  return (
    <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
      {report.missing.length > 0 && (
        <p className="mb-2 text-xs text-amber-300">
          Faltan requisitos obligatorios: {report.missing.join(', ')}.
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2 text-xs">
            <span className={check.present ? 'text-emerald-400' : 'text-red-400'}>
              {check.present ? '✓' : '✕'}
            </span>
            <span className="min-w-0">
              <span className="text-slate-200">{check.label}</span>
              {check.required && <span className="ml-1 text-slate-600">(obligatorio)</span>}
              {!check.present && <span className="block text-slate-500">{check.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default ProjectRequirements
