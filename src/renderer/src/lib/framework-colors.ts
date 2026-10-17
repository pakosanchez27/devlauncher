import type { Framework } from '@shared/types/project'

/**
 * Color distintivo de cada framework para las etiquetas del catálogo.
 *
 * Las clases se escriben completas (no se construyen dinámicamente) para que
 * Tailwind pueda detectarlas al compilar. El color está inspirado en la marca
 * de cada framework.
 */
const FRAMEWORK_BADGE_CLASSES: Record<Framework, string> = {
  laravel: 'border-red-500/40 bg-red-500/15 text-red-300',
  codeigniter: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
  symfony: 'border-zinc-400/40 bg-zinc-500/15 text-zinc-300',
  wordpress: 'border-sky-500/40 bg-sky-500/15 text-sky-300',
  nextjs: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-300',
  react: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  vue: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  node: 'border-lime-500/40 bg-lime-500/15 text-lime-300',
  php: 'border-violet-500/40 bg-violet-500/15 text-violet-300',
  unknown: 'border-slate-600/40 bg-slate-600/15 text-slate-400'
}

/** Clases de color de la etiqueta de un framework. */
export function frameworkBadgeClass(framework: Framework): string {
  return FRAMEWORK_BADGE_CLASSES[framework] ?? FRAMEWORK_BADGE_CLASSES.unknown
}
