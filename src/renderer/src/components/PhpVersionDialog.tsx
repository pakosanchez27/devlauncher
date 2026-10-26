import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PhpInstallation } from '@shared/types/environment'
import type { Project } from '@shared/types/project'
import { messageFromError } from '../lib/ipc-error'
import { useLaunch } from '../lib/launch-context'
import Button from './ui/Button'
import Icon from './ui/Icon'

const CUSTOM = '__custom'

const SOURCE_LABELS: Record<PhpInstallation['source'], string> = {
  wamp: 'WampServer',
  configured: 'Ruta global',
  path: 'PATH',
  custom: 'Personalizada'
}

const INPUT_CLASS =
  'h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500'
const SELECT_CLASS =
  'h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 outline-none transition focus:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-60'
const LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wide text-slate-400'

/** Normaliza rutas de Windows para comparar la ruta guardada con las detectadas. */
function normalizePath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right)
}

interface PhpVersionDialogProps {
  /** Proyecto a configurar; `null` cierra el diálogo. */
  project: Project | null
  onClose: () => void
  onSaved: (project: Project) => void
}

/**
 * Selector de la versión de PHP de un proyecto.
 *
 * «Usar el PHP global» deja el proyecto siguiendo la ruta de Ajustes. Elegir una
 * instalación concreta la fija en `projects.json`; si desaparece, el arranque
 * falla con un mensaje claro en vez de usar otra versión sin avisar.
 */
function PhpVersionDialog({
  project,
  onClose,
  onSaved
}: PhpVersionDialogProps): ReactElement | null {
  const { sessions } = useLaunch()
  const [installations, setInstallations] = useState<PhpInstallation[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState('')
  const [customPath, setCustomPath] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const running = useMemo(() => {
    if (!project) return false
    return sessions.some(
      (session) =>
        session.projectId === project.id &&
        (session.state === 'starting' || session.state === 'ready')
    )
  }, [project, sessions])

  useEffect(() => {
    if (!project) return

    let active = true
    const currentPath = project.phpPath ?? ''

    setSelection(currentPath)
    setCustomPath(currentPath)
    setInstallations([])
    setLoading(true)
    setLoadError(null)
    setError(null)

    window.api.environment
      .listPhp()
      .then((items) => {
        if (!active) return
        setInstallations(items)
        if (currentPath && !items.some((item) => samePath(item.path, currentPath))) {
          setSelection(CUSTOM)
        }
      })
      .catch((cause: unknown) => {
        if (!active) return
        setLoadError(messageFromError(cause))
        if (currentPath) setSelection(CUSTOM)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [project])

  useEffect(() => {
    if (!project) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [project, saving, onClose])

  if (!project) return null

  const globalInstallation = installations.find((installation) => installation.isGlobal)
  const selectedInstallation = installations.find((installation) =>
    samePath(installation.path, selection)
  )

  function handleClose(): void {
    if (!saving) onClose()
  }

  async function handleBrowse(): Promise<void> {
    try {
      const picked = await window.api.projects.selectPhp()
      if (!picked) return
      setCustomPath(picked)
      setSelection(CUSTOM)
      setError(null)
    } catch (cause) {
      setError(messageFromError(cause))
    }
  }

  async function handleSave(): Promise<void> {
    if (!project) return

    setSaving(true)
    setError(null)

    try {
      let phpPath: string | null

      if (selection === '') {
        phpPath = null
      } else if (selection === CUSTOM) {
        const target = customPath.trim()
        if (!target) {
          setError('Escribe o selecciona la ruta de php.exe.')
          return
        }
        const installation = await window.api.environment.inspectPhp(target)
        phpPath = installation.path
      } else {
        phpPath = selection
      }

      const updated = await window.api.projects.update(project.id, { phpPath })
      onSaved(updated)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex animate-[fade-in_120ms_ease-out] items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="php-version-dialog-title"
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl shadow-slate-950/60"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="php-version-dialog-title" className="text-base font-semibold text-slate-100">
              Versión de PHP
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-400">
              Elige con qué PHP arranca «{project.name}».
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            aria-label="Cerrar"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3 text-xs text-slate-400">
              <Icon name="spinner" size={13} className="animate-spin" />
              Buscando instalaciones de PHP…
            </div>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className={LABEL_CLASS}>PHP del proyecto</span>
              <select
                value={selection}
                onChange={(event) => {
                  setSelection(event.target.value)
                  setError(null)
                }}
                disabled={saving}
                className={SELECT_CLASS}
              >
                <option value="">Usar el PHP global de Ajustes</option>
                {installations.map((installation) => (
                  <option key={installation.path} value={installation.path}>
                    {`PHP ${installation.version ?? 'versión desconocida'} · ${
                      SOURCE_LABELS[installation.source]
                    }${installation.isGlobal ? ' · global' : ''}`}
                  </option>
                ))}
                <option value={CUSTOM}>Otra ruta…</option>
              </select>
            </label>
          )}

          {!loading && (
            <p
              className="truncate text-[11px] text-slate-500"
              title={globalInstallation?.path ?? ''}
            >
              {globalInstallation
                ? `Global actual: PHP ${globalInstallation.version ?? 'versión desconocida'} · ${globalInstallation.path}`
                : 'No se detectó un PHP global. Puedes elegir una instalación o indicar una ruta.'}
            </p>
          )}

          {selection === CUSTOM && !loading && (
            <div className="flex flex-col gap-1.5">
              <span className={LABEL_CLASS}>Ruta de php.exe</span>
              <div className="flex gap-2">
                <input
                  value={customPath}
                  onChange={(event) => {
                    setCustomPath(event.target.value)
                    setError(null)
                  }}
                  placeholder="C:\wamp64\bin\php\php8.3.36\php.exe"
                  disabled={saving}
                  className={`${INPUT_CLASS} flex-1`}
                />
                <Button
                  variant="secondary"
                  icon="folder"
                  onClick={() => void handleBrowse()}
                  disabled={saving}
                >
                  Examinar
                </Button>
              </div>
            </div>
          )}

          {selectedInstallation && (
            <p
              className="truncate font-mono text-[10px] text-slate-600"
              title={selectedInstallation.path}
            >
              {selectedInstallation.path}
            </p>
          )}

          {loadError && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
              <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
              {loadError}
            </p>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-red-300">
              <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}

          {running && (
            <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] leading-relaxed text-amber-300">
              El proyecto está en marcha. Reinícialo para aplicar esta versión.
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            {running
              ? 'No reinicia el entorno automáticamente.'
              : 'Se aplicará la próxima vez que arranques el entorno.'}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleClose} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleSave()}
              loading={saving}
              disabled={loading}
            >
              Guardar
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PhpVersionDialog
