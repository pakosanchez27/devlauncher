/**
 * Contratos de datos de proyectos.
 *
 * Compartidos entre el proceso principal, el preload y el renderer para que la
 * gestión de proyectos esté tipada de extremo a extremo.
 */

/** Tipos de proyecto que DevLauncher sabe reconocer. */
export type Framework =
  | 'laravel'
  | 'codeigniter'
  | 'symfony'
  | 'wordpress'
  | 'nextjs'
  | 'react'
  | 'vue'
  | 'node'
  | 'php'
  | 'unknown'

/** Proyecto registrado en el catálogo persistente. */
export interface Project {
  /** Identificador interno (uuid). */
  id: string
  /** Nombre legible mostrado en la interfaz. */
  name: string
  /** Ruta absoluta de la carpeta del proyecto en disco. */
  path: string
  /** Framework detectado. */
  framework: Framework
  /** true si la detección automática reconoció el tipo de proyecto. */
  detected: boolean
  /**
   * Ejecutable de PHP elegido para este proyecto.
   *
   * `null` significa usar el PHP global de Ajustes. Una ruta concreta permite
   * fijar una versión distinta para proyectos que lo necesiten.
   */
  phpPath: string | null
  /** Fecha de alta en formato ISO 8601. */
  createdAt: string
  /** Última vez que se abrió desde DevLauncher (null si nunca). */
  lastOpenedAt: string | null
}

/** Datos necesarios para registrar un proyecto nuevo. */
export interface ProjectDraft {
  path: string
  name?: string
  /** Fuerza el framework (si se omite, se usa el detectado). */
  framework?: Framework
}

/** Campos editables de un proyecto ya registrado. */
export interface ProjectUpdate {
  name?: string
  path?: string
  /** Ruta del ejecutable de PHP; `null` vuelve a usar el PHP global. */
  phpPath?: string | null
}

/** Resultado de inspeccionar una carpeta para determinar su tipo de proyecto. */
export interface FrameworkDetection {
  /** Framework reconocido (o 'unknown'). */
  framework: Framework
  /** Nombre legible del framework. */
  label: string
  /** Confianza de la detección. */
  confidence: 'high' | 'low'
  /** Señales que sustentan la detección (archivos/dependencias encontrados). */
  signals: string[]
  /** Atajo: true si es un proyecto Laravel. */
  isLaravel: boolean
  /** Nombre sugerido (de composer.json, package.json o de la carpeta). */
  name: string | null
  /** Valor del campo `name` de composer.json, si existe. */
  composerName: string | null
  /** Explicación legible del resultado. */
  reason: string
}
