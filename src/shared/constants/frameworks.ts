import type { Framework } from '../types/project'

/** Nombres legibles de los frameworks reconocidos (main y renderer). */
export const FRAMEWORK_LABELS: Record<Framework, string> = {
  laravel: 'Laravel',
  codeigniter: 'CodeIgniter',
  symfony: 'Symfony',
  wordpress: 'WordPress',
  nextjs: 'Next.js',
  react: 'React',
  vue: 'Vue',
  node: 'Node.js',
  php: 'PHP',
  unknown: 'Desconocido'
}

/** Devuelve el nombre legible de un framework. */
export function frameworkLabel(framework: Framework): string {
  return FRAMEWORK_LABELS[framework] ?? framework
}
