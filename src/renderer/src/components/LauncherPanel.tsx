import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type {
  LaunchServiceStatus,
  LaunchSession,
  LaunchState,
  LaunchStepState
} from '@shared/types/launcher'
import { messageFromError } from '../lib/ipc-error'

const SESSION_LABELS: Record<LaunchState, string> = {
  idle: 'Inactivo',
  starting: 'Arrancando…',
  ready: 'En marcha',
  failed: 'Con errores',
  stopped: 'Detenido'
}

const SESSION_CLASSES: Record<LaunchState, string> = {
  idle: 'border-slate-600 text-slate-400',
  starting: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  ready: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300',
  failed: 'border-red-500/60 bg-red-500/15 text-red-300',
  stopped: 'border-slate-600 text-slate-400'
}

const STEP_LABELS: Record<LaunchStepState, string> = {
  pending: 'Pendiente',
  running: 'En curso',
  ready: 'Listo',
  skipped: 'Omitido',
  failed: 'Fallo'
}

const STEP_CLASSES: Record<LaunchStepState, string> = {
  pending: 'border-slate-700 text-slate-400',
  running: 'border-amber-500/60 bg-amber-500/15 text-amber-300',
  ready: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300',
  skipped: 'border-slate-600 text-slate-400',
  failed: 'border-red-500/60 bg-red-500/15 text-red-300'
}

const SERVICE_LABELS: Record<LaunchServiceStatus, string> = {
  running: 'En ejecución',
  stopped: 'Detenido',
  failed: 'Fallo'
}

const MAX_LOG_LINES = 200

function byStartedAtDesc(a: LaunchSession, b: LaunchSession): number {
  return (b.startedAt ?? '').localeCompare(a.startedAt ?? '')
}

/** Inserta o reemplaza una sesión manteniendo el orden (más reciente primero). */
function upsertSession(sessions: LaunchSession[], session: LaunchSession): LaunchSession[] {
  return [
    ...sessions.filter((candidate) => candidate.projectId !== session.projectId),
    session
  ].sort(byStartedAtDesc)
}

/** Entornos en marcha: pasos, servicios, URLs y salida de los procesos. */
function LauncherPanel(): ReactElement | null {
  const [sessions, setSessions] = useState<LaunchSession[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    window.api.launcher
      .status()
      .then((current) => setSessions([...current].sort(byStartedAtDesc)))
      .catch((cause: unknown) => setError(messageFromError(cause)))

    return window.api.launcher.onEvent((event) => {
      if (event.type === 'session') {
        setSessions((previous) => upsertSession(previous, event.session))
        return
      }

      if (event.type === 'log') {
        setLogs((previous) =>
          [...previous, `[${event.processId.slice(0, 8)}] ${event.line}`].slice(-MAX_LOG_LINES)
        )
        return
      }

      // Un proceso cambió de estado: se refleja en la sesión a la que pertenece.
      setSessions((previous) =>
        previous.map((session) =>
          session.projectId === event.process.projectId
            ? {
                ...session,
                services: session.services.map((service) =>
                  service.id === event.process.id
                    ? {
                        ...service,
                        status: event.process.status,
                        pid: event.process.pid,
                        ports: event.process.ports
                      }
                    : service
                )
              }
            : session
        )
      )
    })
  }, [])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [logs])

  async function handleStop(projectId?: string): Promise<void> {
    setBusy(projectId ?? 'all')
    setError(null)
    try {
      await window.api.launcher.stop(projectId)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setBusy(null)
    }
  }

  async function handleStopService(serviceId: string): Promise<void> {
    setBusy(serviceId)
    setError(null)
    try {
      await window.api.launcher.stopService(serviceId)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setBusy(null)
    }
  }

  // Las sesiones detenidas se ocultan: el panel muestra solo lo que está vivo
  // o lo que ha fallado y requiere atención.
  const visible = sessions.filter((session) => session.state !== 'stopped')
  if (visible.length === 0) return null

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Entornos en marcha</h2>
          <p className="text-sm text-slate-400">
            {visible.length === 1
              ? 'Un proyecto está arrancado.'
              : `${visible.length} proyectos arrancados a la vez.`}
          </p>
        </div>
        <button
          onClick={() => handleStop()}
          disabled={busy !== null}
          className="rounded-lg border border-red-900/60 px-4 py-2 text-sm text-red-300 transition hover:border-red-600 disabled:opacity-40"
        >
          {busy === 'all' ? 'Deteniendo…' : 'Detener todo'}
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {visible.map((session) => (
          <article
            key={session.projectId}
            className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium text-slate-100">{session.projectName}</h3>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${SESSION_CLASSES[session.state]}`}
                  >
                    {SESSION_LABELS[session.state]}
                  </span>
                </div>
                <p
                  className="truncate font-mono text-xs text-slate-500"
                  title={session.projectPath}
                >
                  {session.projectPath}
                </p>
              </div>
              <button
                onClick={() => handleStop(session.projectId)}
                disabled={busy !== null}
                className="rounded-lg border border-red-900/60 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-600 disabled:opacity-40"
              >
                {busy === session.projectId ? 'Deteniendo…' : 'Detener entorno'}
              </button>
            </div>

            {session.error && session.state === 'failed' && (
              <p className="mb-3 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {session.error}
              </p>
            )}

            <ol className="mb-3 flex flex-col gap-2">
              {session.steps.map((step, index) => (
                <li
                  key={step.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">{index + 1}.</span>
                      <span className="text-sm font-medium text-slate-100">{step.label}</span>
                    </div>
                    {step.message && (
                      <p className="mt-0.5 text-xs text-slate-400">{step.message}</p>
                    )}
                  </div>
                  <span
                    className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${STEP_CLASSES[step.state]}`}
                  >
                    {STEP_LABELS[step.state]}
                  </span>
                </li>
              ))}
            </ol>

            {(session.urls.app || session.urls.vite) && (
              <div className="mb-3 flex flex-wrap gap-2">
                {session.urls.app && (
                  <a
                    href={session.urls.app}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-indigo-800/60 bg-indigo-950/30 px-3 py-2 text-sm text-indigo-300 transition hover:border-indigo-500"
                  >
                    Abrir aplicación · <span className="font-mono">{session.urls.app}</span>
                  </a>
                )}
                {session.urls.vite && (
                  <a
                    href={session.urls.vite}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-800/60 bg-cyan-950/30 px-3 py-2 text-sm text-cyan-300 transition hover:border-cyan-500"
                  >
                    Abrir Vite · <span className="font-mono">{session.urls.vite}</span>
                  </a>
                )}
              </div>
            )}

            {session.services.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {session.services.map((service) => (
                  <li
                    key={service.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs"
                  >
                    <span className="text-slate-300">{service.label}</span>
                    {service.pid !== null && (
                      <span className="font-mono text-slate-500">PID {service.pid}</span>
                    )}
                    {service.ports.length > 0 && (
                      <span className="font-mono text-slate-500">:{service.ports.join(', :')}</span>
                    )}
                    <span
                      className={
                        service.status === 'running'
                          ? 'text-emerald-300'
                          : service.status === 'failed'
                            ? 'text-red-300'
                            : 'text-slate-500'
                      }
                    >
                      {SERVICE_LABELS[service.status]}
                    </span>
                    {service.status === 'running' && (
                      <button
                        onClick={() => handleStopService(service.id)}
                        disabled={busy !== null}
                        className="rounded border border-red-900/60 px-2 py-0.5 text-[10px] text-red-300 transition hover:border-red-600 disabled:opacity-40"
                      >
                        {busy === service.id ? 'Parando…' : 'Detener'}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>

      <details className="mt-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <summary className="cursor-pointer text-sm text-slate-400">
          Salida de los procesos ({logs.length})
        </summary>
        <pre
          ref={logRef}
          className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-400"
        >
          {logs.length === 0 ? 'Sin salida todavía.' : logs.join('\n')}
        </pre>
      </details>
    </section>
  )
}

export default LauncherPanel
