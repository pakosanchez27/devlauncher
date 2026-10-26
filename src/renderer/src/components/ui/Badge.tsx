import type { ReactElement, ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

const TONES: Record<BadgeTone, string> = {
  neutral: 'border-slate-700 bg-slate-800/50 text-slate-300',
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  danger: 'border-red-500/30 bg-red-500/10 text-red-300',
  info: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  accent: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
}

const DOTS: Record<BadgeTone, string> = {
  neutral: 'bg-slate-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  info: 'bg-sky-400',
  accent: 'bg-indigo-400'
}

interface BadgeProps {
  tone?: BadgeTone
  /** Muestra un punto de color antes del texto. */
  dot?: boolean
  className?: string
  children: ReactNode
}

/** Etiqueta compacta para estados, frameworks y contadores. */
function Badge({
  tone = 'neutral',
  dot = false,
  className = '',
  children
}: BadgeProps): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONES[tone]} ${className}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${DOTS[tone]}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

export default Badge
