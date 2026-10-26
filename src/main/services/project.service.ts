import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { shell } from 'electron'
import { frameworkLabel } from '@shared/constants/frameworks'
import type {
  Framework,
  FrameworkDetection,
  Project,
  ProjectDraft,
  ProjectUpdate
} from '@shared/types/project'
import type { ExternalOpenResult } from '@shared/types/environment'
import { openProjectInEditor } from './editor.service'
import { readProjects, writeProjects } from './project.repository'
import { getSettings } from './settings.service'

/**
 * Lógica de negocio del catálogo de proyectos: detección del tipo de proyecto
 * (Laravel, CodeIgniter, React…) y operaciones de alta, consulta, edición y borrado.
 */

interface ComposerJson {
  name?: string
  require?: Record<string, string>
  'require-dev'?: Record<string, string>
}

interface PackageJson {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

/** Normaliza una ruta para comparaciones (absoluta, sin barra final, sin distinguir mayúsculas). */
function normalizePath(target: string): string {
  return resolve(target)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

async function isDirectory(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T
  } catch {
    return null
  }
}

function buildDetection(
  framework: Framework,
  confidence: 'high' | 'low',
  signals: string[],
  name: string | null,
  composerName: string | null,
  reason: string
): FrameworkDetection {
  return {
    framework,
    label: frameworkLabel(framework),
    confidence,
    signals,
    isLaravel: framework === 'laravel',
    name,
    composerName,
    reason
  }
}

/**
 * Inspecciona una carpeta y determina su tipo de proyecto a partir de archivos
 * y dependencias. Se evalúa de más específico a más genérico.
 */
export async function detectFramework(folderPath: string): Promise<FrameworkDetection> {
  if (!(await isDirectory(folderPath))) {
    return buildDetection(
      'unknown',
      'low',
      [],
      null,
      null,
      'La ruta indicada no es una carpeta válida.'
    )
  }

  const composer = await readJson<ComposerJson>(join(folderPath, 'composer.json'))
  const packageJson = await readJson<PackageJson>(join(folderPath, 'package.json'))

  const composerDeps: Record<string, string> = {
    ...(composer?.require ?? {}),
    ...(composer?.['require-dev'] ?? {})
  }
  const jsDeps: Record<string, string> = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {})
  }

  const [
    hasArtisan,
    hasSpark,
    hasWpConfig,
    hasWpContent,
    hasBinConsole,
    hasSystem,
    hasApplication
  ] = await Promise.all([
    pathExists(join(folderPath, 'artisan')),
    pathExists(join(folderPath, 'spark')),
    pathExists(join(folderPath, 'wp-config.php')),
    pathExists(join(folderPath, 'wp-content')),
    pathExists(join(folderPath, 'bin', 'console')),
    pathExists(join(folderPath, 'system')),
    pathExists(join(folderPath, 'application'))
  ])

  const composerName = typeof composer?.name === 'string' ? composer.name : null
  const packageName = typeof packageJson?.name === 'string' ? packageJson.name : null
  const name = composerName ?? packageName ?? basename(folderPath)

  // Laravel
  const laravelSignals: string[] = []
  if ('laravel/framework' in composerDeps) laravelSignals.push('composer.json: laravel/framework')
  if (hasArtisan) laravelSignals.push('archivo artisan')
  if (laravelSignals.length > 0) {
    return buildDetection(
      'laravel',
      'high',
      laravelSignals,
      name,
      composerName,
      'Detectado como proyecto Laravel.'
    )
  }

  // CodeIgniter (4 usa `spark`; 3 usa las carpetas system/ y application/)
  const codeIgniterSignals: string[] = []
  if ('codeigniter4/framework' in composerDeps) {
    codeIgniterSignals.push('composer.json: codeigniter4/framework')
  }
  if ('codeigniter/framework' in composerDeps) {
    codeIgniterSignals.push('composer.json: codeigniter/framework')
  }
  if (hasSpark) codeIgniterSignals.push('archivo spark')
  if (hasSystem && hasApplication) codeIgniterSignals.push('carpetas system/ y application/')
  if (codeIgniterSignals.length > 0) {
    return buildDetection(
      'codeigniter',
      'high',
      codeIgniterSignals,
      name,
      composerName,
      'Detectado como proyecto CodeIgniter.'
    )
  }

  // Symfony
  const symfonySignals: string[] = []
  if ('symfony/framework-bundle' in composerDeps) {
    symfonySignals.push('composer.json: symfony/framework-bundle')
  }
  if (hasBinConsole) symfonySignals.push('archivo bin/console')
  if (symfonySignals.length > 0) {
    return buildDetection(
      'symfony',
      'high',
      symfonySignals,
      name,
      composerName,
      'Detectado como proyecto Symfony.'
    )
  }

  // WordPress
  const wordpressSignals: string[] = []
  if (hasWpConfig) wordpressSignals.push('wp-config.php')
  if (hasWpContent) wordpressSignals.push('carpeta wp-content/')
  if (wordpressSignals.length > 0) {
    return buildDetection(
      'wordpress',
      'high',
      wordpressSignals,
      name,
      composerName,
      'Detectado como instalación de WordPress.'
    )
  }

  // Frontend / Node
  if ('next' in jsDeps) {
    return buildDetection(
      'nextjs',
      'high',
      ['package.json: next'],
      name,
      composerName,
      'Detectado como proyecto Next.js.'
    )
  }
  if ('react' in jsDeps) {
    return buildDetection(
      'react',
      'high',
      ['package.json: react'],
      name,
      composerName,
      'Detectado como proyecto React.'
    )
  }
  if ('vue' in jsDeps || 'nuxt' in jsDeps) {
    return buildDetection(
      'vue',
      'high',
      ['package.json: vue/nuxt'],
      name,
      composerName,
      'Detectado como proyecto Vue.'
    )
  }
  if (packageJson) {
    return buildDetection(
      'node',
      'low',
      ['package.json'],
      name,
      composerName,
      'Proyecto Node.js (framework no reconocido).'
    )
  }
  if (composer) {
    return buildDetection(
      'php',
      'low',
      ['composer.json'],
      name,
      composerName,
      'Proyecto PHP (framework no reconocido).'
    )
  }

  return buildDetection(
    'unknown',
    'low',
    [],
    name,
    composerName,
    'No se reconoció el tipo de proyecto (sin composer.json ni package.json).'
  )
}

/** Re-detecta el framework de los proyectos cuyo tipo haya cambiado en disco. */
async function refreshFrameworks(projects: Project[]): Promise<Project[]> {
  let changed = false

  const refreshed = await Promise.all(
    projects.map(async (project) => {
      if (!(await isDirectory(project.path))) return project

      const detection = await detectFramework(project.path)
      const detected = detection.framework !== 'unknown'
      if (detection.framework === project.framework && detected === project.detected) {
        return project
      }

      changed = true
      return { ...project, framework: detection.framework, detected }
    })
  )

  if (changed) await writeProjects(refreshed)
  return refreshed
}

/** Devuelve el catálogo ordenado por nombre, con el framework actualizado. */
export async function getProjects(): Promise<Project[]> {
  const projects = await refreshFrameworks(await readProjects())
  return [...projects].sort((a, b) => a.name.localeCompare(b.name))
}

/** Registra un proyecto nuevo tras validar la carpeta y evitar duplicados. */
export async function addProject(draft: ProjectDraft): Promise<Project> {
  if (!draft?.path || !(await isDirectory(draft.path))) {
    throw new Error('La carpeta seleccionada no existe o no es válida.')
  }

  const projects = await readProjects()
  const candidate = normalizePath(draft.path)
  if (projects.some((project) => normalizePath(project.path) === candidate)) {
    throw new Error('Ese proyecto ya está registrado.')
  }

  const detection = await detectFramework(draft.path)
  const name = (draft.name?.trim() || detection.name || basename(draft.path)).trim()

  const project: Project = {
    id: randomUUID(),
    name,
    path: draft.path,
    framework: draft.framework ?? detection.framework,
    detected: (draft.framework ?? detection.framework) !== 'unknown',
    createdAt: new Date().toISOString(),
    lastOpenedAt: null
  }

  await writeProjects([...projects, project])
  return project
}

/** Edita el nombre y/o la ruta de un proyecto existente. */
export async function updateProject(id: string, changes: ProjectUpdate): Promise<Project> {
  const projects = await readProjects()
  const index = projects.findIndex((project) => project.id === id)
  if (index === -1) throw new Error('El proyecto no existe.')

  const updated: Project = { ...projects[index] }

  if (typeof changes.name === 'string') {
    const name = changes.name.trim()
    if (!name) throw new Error('El nombre del proyecto no puede estar vacío.')
    updated.name = name
  }

  if (typeof changes.path === 'string' && changes.path.trim()) {
    if (!(await isDirectory(changes.path))) {
      throw new Error('La nueva ruta no es una carpeta válida.')
    }
    const candidate = normalizePath(changes.path)
    const duplicated = projects.some(
      (project, position) => position !== index && normalizePath(project.path) === candidate
    )
    if (duplicated) throw new Error('Ya existe otro proyecto con esa ruta.')

    updated.path = changes.path
    const detection = await detectFramework(changes.path)
    updated.framework = detection.framework
    updated.detected = detection.framework !== 'unknown'
  }

  projects[index] = updated
  await writeProjects(projects)
  return updated
}

/** Abre la carpeta del proyecto en el explorador de Windows. */
export async function openProject(id: string): Promise<Project> {
  const projects = await readProjects()
  const index = projects.findIndex((project) => project.id === id)
  if (index === -1) throw new Error('El proyecto no existe.')

  const project = projects[index]
  if (!(await isDirectory(project.path))) {
    throw new Error('La carpeta del proyecto ya no existe en disco.')
  }

  const failure = await shell.openPath(project.path)
  if (failure) throw new Error(`No se pudo abrir la carpeta: ${failure}`)

  const updated: Project = { ...project, lastOpenedAt: new Date().toISOString() }
  projects[index] = updated
  await writeProjects(projects)
  return updated
}

/**
 * Abre la carpeta del proyecto en el editor configurado (EP-07), sin arrancar
 * el entorno: es el acceso rápido «Abrir en editor» de la tarjeta.
 */
export async function openProjectInEditorById(id: string): Promise<ExternalOpenResult> {
  const projects = await readProjects()
  const project = projects.find((candidate) => candidate.id === id)
  if (!project) throw new Error('El proyecto no existe.')

  const settings = await getSettings()
  return openProjectInEditor(project.path, settings.editorPath)
}

/** Elimina un proyecto del catálogo (no borra nada en disco). */
export async function deleteProject(id: string): Promise<void> {
  const projects = await readProjects()
  const remaining = projects.filter((project) => project.id !== id)
  if (remaining.length === projects.length) throw new Error('El proyecto no existe.')
  await writeProjects(remaining)
}
