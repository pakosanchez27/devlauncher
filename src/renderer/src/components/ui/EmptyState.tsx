import type { ReactElement, ReactNode } from 'react'
import Icon from './Icon'
import type { IconName } from './Icon'

interface EmptyStateProps {
  icon: IconName
  title: string
  description: string
  /** Pasos numerados que explican cómo empezar. */
  steps?: string[]
  action?: ReactNode
}

/** Estado vacío con explicación y, opcionalmente, los pasos para empezar. */
function EmptyState({ icon, title, description, steps, action }: EmptyStateProps): ReactElement {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/20 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/80 text-slate-400">
        <Icon name={icon} size={22} />
      </div>
      <h2 className="mt-4 text-base font-semibold text-slate-100">{title}</h2>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-400">{description}</p>

      {steps && steps.length > 0 && (
        <ol className="mt-6 w-full max-w-md space-y-2 text-left">
          {steps.map((step, index) => (
            <li
              key={step}
              className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-3 py-2.5"
            >
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-[11px] font-semibold text-indigo-300">
                {index + 1}
              </span>
              <span className="text-sm text-slate-300">{step}</span>
            </li>
          ))}
        </ol>
      )}

      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

export default EmptyState
