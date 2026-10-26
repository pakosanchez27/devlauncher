import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { LaunchSession, LaunchStepState } from '@shared/types/launcher'
import { useLaunch } from '../lib/launch-context'
import type { LogEntry } from '../lib/launch-context'
import { LAUNCH_STATE_LABELS, LAUNCH_STATE_TONES, STEP_LABELS } from '../lib/launch-labels'
import { buildSessionReport, detectLogLevel } from '../lib/logs'
import { messageFromError } from '../lib/ipc-error'
import type { ViewId } from '../lib/views'
import Badge from './ui/Badge'
import Button from './ui/Button'
import EmptyState from './ui/EmptyState'
import Icon from './ui/Icon'
import type { IconName } from './ui/Icon'
import { useToast } from './ui/Toast'
import LogViewer from './LogViewer'

interface ActivityViewProps {
  onNavigate: (view: ViewId) => void
}

const STEP_ICONS: Record<LaunchStepState, { name: IconName; className: string }> = {
  pending: { name: 'clock', className: 'text-slate-500' },
  running: { name: 'spinner', className: 'animate-spin text-amber-300' },
  ready: { name: 'check', className: 'text-emerald-300' },
  skipped: { name: 'minus', className: 'text-slate-500' },
  failed: { name: 'x', className: 'text-red-300' }
}

interface SessionCardProps {
  session: LaunchSession
  logs: LogEntry[]
  busy: string | null
  onStop: (session: LaunchSession) => void
  onStopService: (serviceId: string) => void
  onOpenUrl: (projectId: string, target: 'app' | 'vite') => void
  onClearLogs: (projectId: string) => void
}

/** Entorno en marcha: pasos, URLs, servicios y registro de los procesos. */
function SessionCard({
  session,
  logs,
  busy,
  onStop,
  onStopService,
  onOpenUrl,
  onClearLogs
}: SessionCardProps): ReactElement {
  const { notify } = useToast()
  const logDetailsRef = useRef<HTMLDetailsElement>(null)
  const [copyingDetails, setCopyingDetails] = useState(false)
  const errorCount = logs.filter((entry) => detectLogLevel(entry.line) === 'error').length
  const doneSteps = session.steps.filter(
    (step) => step.state === 'ready' || step.state === 'skipped'
  ).length

  function openLogs(): void {
    const node = logDetailsRef.current
    if (!node) return
    node.open = true
    node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  async function handleCopyDetails(): Promise<void> {
    setCopyingDetails(true)
    try {
      await window.api.copyText(buildSessionReport(session, logs))
      notify({
        tone: 'success',
        title: 'Detalles copiados',
        description: 'Pégalos donde necesites compartir el fallo.'
      })
    } catch (cause) {
      notify({
        tone: 'error',
        title: 'No se pudieron copiar los detalles',
        description: messageFromError(cause)
      })
    } finally {
      setCopyingDetails(false)
    }
  }

  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-100">{session.projectName}</h2>
            <Badge tone={LAUNCH_STATE_TONES[session.state]} dot>
              {LAUNCH_STATE_LABELS[session.state]}
            </Badge>
            {session.steps.length > 0 && (
              <span className="text-[11px] tabular-nums text-slate-500">
                {doneSteps}/{session.steps.length} pasos
              </span>
            )}
          </div>
          <p
            className="mt-0.5 truncate font-mono text-[11px] text-slate-500"
            title={session.projectPath}
          >
            {session.projectPath}
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          icon="stop"
          onClick={() => onStop(session)}
          loading={busy === session.projectId}
        >
          {busy === session.projectId ? 'Deteniendo…' : 'Detener'}
        </Button>
      </div>

      {session.error && session.state === 'failed' && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="leading-relaxed">{session.error}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="subtle" size="sm" icon="terminal" onClick={openLogs}>
                Ver registro
              </Button>
              <Button
                variant="subtle"
                size="sm"
                icon="copy"
                onClick={() => void handleCopyDetails()}
                loading={copyingDetails}
              >
                Copiar detalles
              </Button>
            </div>
          </div>
        </div>
      )}

      {session.steps.length > 0 && (
        <ol className="mt-4">
          {session.steps.map((step, index) => {
            const icon = STEP_ICONS[step.state]
            return (
              <li key={step.id} className="relative flex gap-3 pb-3 last:pb-0">
                {index < session.steps.length - 1 && (
                  <span
                    className="absolute left-[9px] top-5 h-full w-px bg-slate-800"
                    aria-hidden="true"
                  />
                )}
                <span className="relative z-10 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-slate-700 bg-slate-900">
                  <Icon name={icon.name} size={11} className={icon.className} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm ${
                        step.state === 'pending' ? 'text-slate-500' : 'text-slate-200'
                      }`}
                    >
                      {step.label}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">
                      {STEP_LABELS[step.state]}
                    </span>
                  </div>
                  {step.message && (
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{step.message}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {(session.urls.app || session.urls.vite) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {session.urls.app && (
            <Button
              variant="subtle"
              size="sm"
              icon="browser"
              onClick={() => onOpenUrl(session.projectId, 'app')}
              title={session.urls.app}
            >
              Aplicación
              <span className="font-mono text-[11px] text-slate-500">{session.urls.app}</span>
            </Button>
          )}
          {session.urls.vite && (
            <Button
              variant="subtle"
              size="sm"
              icon="external"
              onClick={() => onOpenUrl(session.projectId, 'vite')}
              title={session.urls.vite}
            >
              Frontend
              <span className="font-mono text-[11px] text-slate-500">{session.urls.vite}</span>
            </Button>
          )}
        </div>
      )}

      {session.services.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
            Servicios
          </h3>
          <ul className="flex flex-wrap gap-2">
            {session.services.map((service) => (
              <li
                key={service.id}
                className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-2.5 py-1.5 text-xs"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    service.status === 'running'
                      ? 'bg-emerald-400'
                      : service.status === 'failed'
                        ? 'bg-red-400'
                        : 'bg-slate-500'
                  }`}
                  aria-hidden="true"
                />
                <span className="text-slate-300">{service.label}</span>
                {service.ports.length > 0 && (
                  <span className="font-mono text-slate-500">:{service.ports.join(', :')}</span>
                )}
                {service.pid !== null && (
                  <span
                    className="font-mono text-[10px] text-slate-600"
                    title="Identificador del proceso"
                  >
                    PID {service.pid}
                  </span>
                )}
                {service.status === 'running' && (
                  <button
                    type="button"
                    onClick={() => onStopService(service.id)}
                    disabled={busy !== null}
                    aria-label={`Detener ${service.label}`}
                    title={`Detener ${service.label}`}
                    className="ml-1 rounded p-0.5 text-slate-500 transition hover:bg-red-950/40 hover:text-red-300 disabled:opacity-40"
                  >
                    <Icon name="x" size={12} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <details
        ref={logDetailsRef}
        className="mt-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/40"
      >
        <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-slate-400 transition hover:text-slate-200">
          <Icon name="terminal" size={14} />
          Salida de los procesos
          {errorCount > 0 && (
            <span className="rounded-full bg-red-500/10 px-1.5 text-[10px] text-red-300">
              {errorCount} {errorCount === 1 ? 'error' : 'errores'}
            </span>
          )}
          <span className="ml-auto rounded-full bg-slate-800 px-1.5 text-[10px] text-slate-400">
            {logs.length}
          </span>
        </summary>
        <LogViewer
          session={session}
          entries={logs}
          onClear={() => onClearLogs(session.projectId)}
        />
      </details>
    </article>
  )
}

/** Vista de actividad: entornos en marcha, pasos y registros en vivo. */
function ActivityView({ onNavigate }: ActivityViewProps): ReactElement {
  const { sessions, logs, clearLogs } = useLaunch()
  const { notify } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const visible = sessions.filter((session) => session.state !== 'stopped')

  function reportError(title: string, cause: unknown): void {
    notify({ tone: 'error', title, description: messageFromError(cause) })
  }

  async function handleStop(session: LaunchSession): Promise<void> {
    setBusy(session.projectId)
    try {
      await window.api.launcher.stop(session.projectId)
      notify({ tone: 'info', title: 'Entorno detenido', description: session.projectName })
    } catch (cause) {
      reportError('No se pudo detener el entorno', cause)
    } finally {
      setBusy(null)
    }
  }

  async function handleStopAll(): Promise<void> {
    setBusy('all')
    try {
      await window.api.launcher.stop()
      notify({ tone: 'info', title: 'Todos los entornos detenidos' })
    } catch (cause) {
      reportError('No se pudieron detener los entornos', cause)
    } finally {
      setBusy(null)
    }
  }

  async function handleStopService(serviceId: string): Promise<void> {
    setBusy(serviceId)
    try {
      await window.api.launcher.stopService(serviceId)
      notify({ tone: 'info', title: 'Servicio detenido' })
    } catch (cause) {
      reportError('No se pudo detener el servicio', cause)
    } finally {
      setBusy(null)
    }
  }

  async function handleOpenUrl(projectId: string, target: 'app' | 'vite'): Promise<void> {
    try {
      const result = await window.api.launcher.openUrl(projectId, target)
      if (!result.opened) {
        notify({
          tone: 'error',
          title: 'No se pudo abrir la aplicación',
          description: result.message
        })
      }
    } catch (cause) {
      reportError('No se pudo abrir la aplicación', cause)
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">Actividad</h1>
          <p className="mt-1 text-sm text-slate-400">
            {visible.length === 0
              ? 'Aquí verás los pasos y los registros de cada entorno.'
              : `${visible.length} entorno${visible.length === 1 ? '' : 's'} activo${visible.length === 1 ? '' : 's'} · actualizado en vivo`}
          </p>
        </div>
        {visible.length > 0 && (
          <Button
            variant="danger"
            icon="stop"
            onClick={() => void handleStopAll()}
            loading={busy === 'all'}
          >
            {busy === 'all' ? 'Deteniendo…' : 'Detener todo'}
          </Button>
        )}
      </header>

      {visible.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No hay entornos en marcha"
          description="Cuando inicies un proyecto verás aquí cada paso del arranque, los servicios activos y la salida de los procesos."
          action={
            <Button variant="primary" icon="play" onClick={() => onNavigate('projects')}>
              Ir a Proyectos
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {visible.map((session) => (
            <SessionCard
              key={session.projectId}
              session={session}
              logs={logs[session.projectId] ?? []}
              busy={busy}
              onStop={(target) => void handleStop(target)}
              onStopService={(serviceId) => void handleStopService(serviceId)}
              onOpenUrl={(projectId, target) => void handleOpenUrl(projectId, target)}
              onClearLogs={clearLogs}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default ActivityView
