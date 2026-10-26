import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { AppSettings, EnvironmentReport, PortsReport, ToolId } from '@shared/types/environment'
import { messageFromError } from '../lib/ipc-error'

const TOOL_FIELDS: Array<{ id: ToolId; label: string; placeholder: string }> = [
  { id: 'php', label: 'PHP', placeholder: 'C:\\wamp64\\bin\\php\\php8.2.0\\php.exe' },
  { id: 'node', label: 'Node.js', placeholder: 'C:\\Program Files\\nodejs\\node.exe' },
  { id: 'npm', label: 'npm', placeholder: 'C:\\Program Files\\nodejs\\npm.cmd' },
  {
    id: 'composer',
    label: 'Composer',
    placeholder: 'C:\\ProgramData\\ComposerSetup\\bin\\composer.bat'
  },
  { id: 'mysql', label: 'MySQL', placeholder: 'C:\\wamp64\\bin\\mysql\\mysql8.0\\bin\\mysql.exe' }
]

function availabilityBadge(ok: boolean): string {
  return ok
    ? 'rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-300'
    : 'rounded bg-red-500/20 px-2 py-0.5 text-[10px] uppercase tracking-wide text-red-300'
}

/** Verificador del entorno: herramientas, puertos y rutas de ejecutables. */
function EnvironmentSection(): ReactElement {
  const [report, setReport] = useState<EnvironmentReport | null>(null)
  const [ports, setPorts] = useState<PortsReport | null>(null)
  const [form, setForm] = useState<Partial<Record<ToolId, string>>>({})
  const [wampPath, setWampPath] = useState('')
  const [editorPath, setEditorPath] = useState('')
  const [browserPath, setBrowserPath] = useState('')
  const [openEditorOnLaunch, setOpenEditorOnLaunch] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const [environment, portsReport, settings]: [EnvironmentReport, PortsReport, AppSettings] =
      await Promise.all([
        window.api.environment.check(),
        window.api.environment.checkPorts(),
        window.api.settings.get()
      ])
    setReport(environment)
    setPorts(portsReport)
    setForm(settings.executables)
    setWampPath(settings.wampPath ?? '')
    setEditorPath(settings.editorPath ?? '')
    setBrowserPath(settings.browserPath ?? '')
    setOpenEditorOnLaunch(settings.openEditorOnLaunch)
  }, [])

  useEffect(() => {
    refresh()
      .catch((cause: unknown) => setError(messageFromError(cause)))
      .finally(() => setLoading(false))
  }, [refresh])

  async function handleRecheck(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      await refresh()
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await window.api.settings.update({
        executables: form,
        wampPath,
        editorPath,
        browserPath,
        openEditorOnLaunch
      })
      await refresh()
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Entorno</h2>
          <p className="text-sm text-slate-400">
            Herramientas, puertos y preferencias para ejecutar tus proyectos.
          </p>
        </div>
        <button
          onClick={handleRecheck}
          disabled={loading}
          className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
        >
          {loading ? 'Analizando…' : 'Re-analizar'}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {report && report.missing.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
          Faltan requisitos obligatorios: {report.missing.join(', ')}.
        </p>
      )}

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Herramientas
      </h3>
      <ul className="mb-6 flex flex-col gap-2">
        {(report?.tools ?? []).map((tool) => (
          <li
            key={tool.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-100">{tool.label}</span>
                {tool.required && (
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">
                    obligatorio
                  </span>
                )}
              </div>
              <p
                className="mt-0.5 truncate font-mono text-xs text-slate-500"
                title={tool.path ?? ''}
              >
                {tool.available
                  ? `${tool.version ?? 'versión desconocida'} · ${tool.path}`
                  : tool.message}
              </p>
            </div>
            <span className={availabilityBadge(tool.available)}>
              {tool.available ? 'Disponible' : 'Falta'}
            </span>
          </li>
        ))}
      </ul>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        WampServer
      </h3>
      <p className="mb-6 text-sm text-slate-400">
        {report?.wamp.installed
          ? `Detectado en ${report.wamp.path}`
          : 'No se detectó una instalación de WampServer en las rutas habituales.'}
      </p>

      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Puertos</h3>
      <ul className="flex flex-wrap gap-2">
        {(ports?.ports ?? []).map((port) => (
          <li
            key={port.port}
            className="flex flex-col gap-1 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="text-slate-300">
                {port.label} <span className="font-mono text-slate-500">:{port.port}</span>
              </span>
              <span className={availabilityBadge(port.available)}>
                {port.available ? 'Libre' : 'Ocupado'}
              </span>
            </div>
            {port.owner && (
              <span className="text-[10px] text-slate-500">
                {port.owner.name ?? 'Proceso desconocido'} (PID {port.owner.pid})
              </span>
            )}
            {port.reservedByUs && (
              <span className="text-[10px] text-indigo-400">Reservado por DevLauncher</span>
            )}
          </li>
        ))}
      </ul>

      <details className="mt-6 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <summary className="cursor-pointer text-sm text-slate-400">
          Rutas de ejecutables y preferencias
        </summary>
        <p className="mt-2 text-xs text-slate-500">
          Deja un campo vacío para usar la detección automática (WampServer y PATH).
        </p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TOOL_FIELDS.map((field) => (
            <label key={field.id} className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wide text-slate-500">{field.label}</span>
              <input
                value={form[field.id] ?? ''}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, [field.id]: event.target.value }))
                }
                placeholder={field.placeholder}
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
              />
            </label>
          ))}

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Ruta de WampServer
            </span>
            <input
              value={wampPath}
              onChange={(event) => setWampPath(event.target.value)}
              placeholder="C:\\wamp64"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Editor para abrir los proyectos
            </span>
            <input
              value={editorPath}
              onChange={(event) => setEditorPath(event.target.value)}
              placeholder="C:\\Users\\tu-usuario\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
            <span className="text-[11px] text-slate-500">
              Vacío: se usa Visual Studio Code del PATH o de su instalación habitual y, si no está,
              se abre la carpeta en el Explorador de Windows.
            </span>
          </label>

          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">
              Navegador para abrir la aplicación
            </span>
            <input
              value={browserPath}
              onChange={(event) => setBrowserPath(event.target.value)}
              placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs outline-none focus:border-indigo-500"
            />
            <span className="text-[11px] text-slate-500">
              Vacío: se usa el navegador predeterminado de Windows. Sirve cualquier navegador con
              ejecutable (Chrome, Firefox, Edge…).
            </span>
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-300 sm:col-span-2">
            <input
              type="checkbox"
              checked={openEditorOnLaunch}
              onChange={(event) => setOpenEditorOnLaunch(event.target.checked)}
              className="h-4 w-4 accent-indigo-500"
            />
            Abrir el proyecto en el editor al iniciar el entorno
          </label>
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar y re-analizar'}
        </button>
      </details>
    </section>
  )
}

export default EnvironmentSection
