import { useCallback, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { AppSettings, EnvironmentReport, PortsReport, ToolId } from '@shared/types/environment'
import { messageFromError } from '../lib/ipc-error'
import AppInfoCard from './AppInfoCard'
import PingPanel from './PingPanel'
import PortsPanel from './PortsPanel'
import Badge from './ui/Badge'
import Button from './ui/Button'
import Icon from './ui/Icon'
import { useToast } from './ui/Toast'

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

const INPUT_CLASS =
  'h-9 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500'
const LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wide text-slate-400'

interface PanelProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

/** Tarjeta de ajustes con cabecera y contenido. */
function Panel({ title, description, actions, children }: PanelProps): ReactElement {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

/** Ajustes: herramientas, WampServer, puertos, preferencias y diagnóstico. */
function SettingsView(): ReactElement {
  const { notify } = useToast()

  const [report, setReport] = useState<EnvironmentReport | null>(null)
  const [ports, setPorts] = useState<PortsReport | null>(null)
  const [form, setForm] = useState<Partial<Record<ToolId, string>>>({})
  const [wampPath, setWampPath] = useState('')
  const [editorPath, setEditorPath] = useState('')
  const [browserPath, setBrowserPath] = useState('')
  const [openEditorOnLaunch, setOpenEditorOnLaunch] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

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
      .then(() => setLoadError(null))
      .catch((cause: unknown) => {
        const message = messageFromError(cause)
        setLoadError(message)
        notify({
          tone: 'error',
          title: 'No se pudo revisar el entorno',
          description: message
        })
      })
      .finally(() => setLoading(false))
  }, [refresh, notify])

  async function handleRecheck(): Promise<void> {
    setLoading(true)
    setLoadError(null)
    try {
      await refresh()
      notify({ tone: 'success', title: 'Entorno revisado' })
    } catch (cause) {
      const message = messageFromError(cause)
      setLoadError(message)
      notify({
        tone: 'error',
        title: 'No se pudo revisar el entorno',
        description: message
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    try {
      await window.api.settings.update({
        executables: form,
        wampPath,
        editorPath,
        browserPath,
        openEditorOnLaunch
      })
      await refresh()
      notify({ tone: 'success', title: 'Preferencias guardadas' })
    } catch (cause) {
      notify({
        tone: 'error',
        title: 'No se pudieron guardar las preferencias',
        description: messageFromError(cause)
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Ajustes</h1>
          <p className="mt-1 text-sm text-slate-400">
            Herramientas detectadas, preferencias y diagnóstico del equipo.
          </p>
        </div>
        <Button variant="secondary" icon="restart" onClick={handleRecheck} loading={loading}>
          {loading ? 'Analizando…' : 'Re-analizar'}
        </Button>
      </header>

      {report && report.missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <p>
            Faltan requisitos obligatorios: <strong>{report.missing.join(', ')}</strong>. Los
            proyectos que los necesiten no podrán arrancar hasta que estén disponibles.
          </p>
        </div>
      )}

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300"
        >
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          <p>No se pudo analizar el entorno: {loadError}</p>
        </div>
      )}

      <Panel
        title="Herramientas"
        description="Lo que DevLauncher encuentra en este equipo para ejecutar tus proyectos."
      >
        {!report ? (
          <p className="px-5 py-6 text-sm text-slate-500">
            {loadError ?? 'Analizando el entorno…'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-800/70">
            {report.tools.map((tool) => (
              <li key={tool.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Icon
                    name={tool.available ? 'check' : 'x'}
                    size={15}
                    className={`mt-0.5 shrink-0 ${tool.available ? 'text-emerald-400' : 'text-red-400'}`}
                  />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-slate-100">{tool.label}</span>
                      {tool.required && (
                        <span className="text-[10px] uppercase tracking-wide text-slate-500">
                          obligatorio
                        </span>
                      )}
                    </div>
                    <p className="truncate text-xs text-slate-400" title={tool.path ?? ''}>
                      {tool.available ? (tool.version ?? 'versión desconocida') : tool.message}
                    </p>
                    {tool.path && (
                      <p className="truncate font-mono text-[10px] text-slate-600">{tool.path}</p>
                    )}
                  </div>
                </div>
                <Badge tone={tool.available ? 'success' : 'danger'}>
                  {tool.available ? 'Disponible' : 'Falta'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="WampServer" description="Servidor de Apache y MySQL para proyectos PHP.">
          <div className="p-5">
            {!report ? (
              <p className="text-sm text-slate-500">{loadError ?? 'Analizando el entorno…'}</p>
            ) : report.wamp.installed ? (
              <div className="flex items-start gap-3">
                <Icon name="server" size={18} className="mt-0.5 shrink-0 text-emerald-300" />
                <div className="min-w-0">
                  <Badge tone="success">Detectado</Badge>
                  <p
                    className="mt-2 truncate font-mono text-xs text-slate-400"
                    title={report.wamp.path ?? ''}
                  >
                    {report.wamp.path}
                  </p>
                  {report.wamp.mysqlPath && (
                    <p
                      className="mt-1 truncate font-mono text-[11px] text-slate-600"
                      title={report.wamp.mysqlPath}
                    >
                      MySQL: {report.wamp.mysqlPath}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <Icon name="server" size={18} className="mt-0.5 shrink-0 text-slate-500" />
                <div>
                  <Badge tone="neutral">No detectado</Badge>
                  <p className="mt-2 text-xs leading-relaxed text-slate-400">
                    No se encontró WampServer en las rutas habituales. Instálalo o indica su carpeta
                    en las preferencias de abajo.
                  </p>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel title="Puertos" description="Disponibilidad de los puertos que usan tus proyectos.">
          <ul className="grid grid-cols-1 gap-2 p-5 sm:grid-cols-2">
            {(ports?.ports ?? []).map((port) => (
              <li
                key={port.port}
                className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-300">
                    {port.label} <span className="font-mono text-slate-500">:{port.port}</span>
                  </span>
                  <Badge tone={port.available ? 'success' : 'warning'}>
                    {port.available ? 'Libre' : 'Ocupado'}
                  </Badge>
                </div>
                {port.owner && (
                  <p className="mt-1 truncate text-[11px] text-slate-500">
                    {port.owner.name ?? 'Proceso desconocido'} (PID {port.owner.pid})
                  </p>
                )}
                {port.reservedByUs && (
                  <p className="mt-1 text-[11px] text-indigo-400">Reservado por DevLauncher</p>
                )}
              </li>
            ))}
            {!ports && (
              <li className="text-sm text-slate-500">{loadError ?? 'Comprobando puertos…'}</li>
            )}
          </ul>
        </Panel>
      </div>

      <Panel
        title="Preferencias"
        description="Cómo abrir tus proyectos y su aplicación. Vacío = detección automática."
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleSave()
          }}
        >
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            {TOOL_FIELDS.map((field) => (
              <label key={field.id} className="flex flex-col gap-1.5">
                <span className={LABEL_CLASS}>{field.label}</span>
                <input
                  value={form[field.id] ?? ''}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, [field.id]: event.target.value }))
                  }
                  placeholder={field.placeholder}
                  className={INPUT_CLASS}
                />
              </label>
            ))}

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={LABEL_CLASS}>Carpeta de WampServer</span>
              <input
                value={wampPath}
                onChange={(event) => setWampPath(event.target.value)}
                placeholder="C:\\wamp64"
                className={INPUT_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={LABEL_CLASS}>Editor para abrir los proyectos</span>
              <input
                value={editorPath}
                onChange={(event) => setEditorPath(event.target.value)}
                placeholder="C:\\Users\\tu-usuario\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd"
                className={INPUT_CLASS}
              />
              <span className="text-[11px] leading-relaxed text-slate-500">
                Vacío: se usa Visual Studio Code del PATH o de su instalación habitual y, si no
                está, se abre la carpeta en el Explorador de Windows.
              </span>
            </label>

            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className={LABEL_CLASS}>Navegador para abrir la aplicación</span>
              <input
                value={browserPath}
                onChange={(event) => setBrowserPath(event.target.value)}
                placeholder="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
                className={INPUT_CLASS}
              />
              <span className="text-[11px] leading-relaxed text-slate-500">
                Vacío: se usa el navegador predeterminado de Windows. Sirve cualquier navegador con
                ejecutable (Chrome, Firefox, Edge…).
              </span>
            </label>

            <label className="flex items-center gap-2.5 text-sm text-slate-300 sm:col-span-2">
              <input
                type="checkbox"
                checked={openEditorOnLaunch}
                onChange={(event) => setOpenEditorOnLaunch(event.target.checked)}
                className="h-4 w-4 accent-indigo-500"
              />
              Abrir el proyecto en el editor al iniciar el entorno
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 px-5 py-3.5">
            <p className="text-[11px] text-slate-500">
              Las rutas manuales tienen prioridad sobre la detección automática.
            </p>
            <Button type="submit" variant="primary" loading={saving}>
              {saving ? 'Guardando…' : 'Guardar preferencias'}
            </Button>
          </div>
        </form>
      </Panel>

      <PortsPanel />

      <details className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/30">
        <summary className="flex cursor-pointer items-center gap-2 px-5 py-3.5 text-sm text-slate-400 transition hover:text-slate-200">
          <Icon name="info" size={15} />
          Diagnóstico técnico
          <Icon name="chevron-down" size={14} className="ml-auto" />
        </summary>
        <div className="grid gap-4 border-t border-slate-800 p-4 lg:grid-cols-2">
          <AppInfoCard />
          <PingPanel />
        </div>
      </details>
    </section>
  )
}

export default SettingsView
