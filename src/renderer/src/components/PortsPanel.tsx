import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { PortInspection } from '@shared/types/environment'
import type { LaunchServiceKind, ManagedProcessInfo } from '@shared/types/launcher'
import type { Project } from '@shared/types/project'
import { messageFromError } from '../lib/ipc-error'
import Badge from './ui/Badge'
import Button from './ui/Button'
import Icon from './ui/Icon'

const KIND_LABELS: Record<LaunchServiceKind, string> = {
  wamp: 'WampServer',
  php: 'PHP',
  node: 'Node',
  vite: 'Vite'
}

/** Tiempo transcurrido desde `startedAt`, en formato corto. */
function formatElapsed(startedAt: string): string {
  const elapsed = Date.now() - Date.parse(startedAt)
  if (!Number.isFinite(elapsed) || elapsed < 0) return '—'

  const total = Math.floor(elapsed / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60

  if (hours > 0) return `${hours} h ${minutes} min`
  if (minutes > 0) return `${minutes} min ${seconds} s`
  return `${seconds} s`
}

/**
 * Procesos gestionados y comprobación de puertos (EP-05): qué ha lanzado
 * DevLauncher, con su PID y puertos, y quién ocupa un puerto concreto.
 */
function PortsPanel(): ReactElement {
  const [processes, setProcesses] = useState<ManagedProcessInfo[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [port, setPort] = useState('8000')
  const [inspection, setInspection] = useState<PortInspection | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshProcesses = useCallback(async (): Promise<void> => {
    setProcesses(await window.api.launcher.processes())
  }, [])

  /** Refresco completo: procesos y catálogo (los nombres de los proyectos). */
  const reload = useCallback(async (): Promise<void> => {
    const [nextProjects] = await Promise.all([window.api.projects.list(), refreshProcesses()])
    setProjects(nextProjects)
  }, [refreshProcesses])

  const inspect = useCallback(async (value: number): Promise<void> => {
    setInspection(await window.api.environment.inspectPort(value))
  }, [])

  useEffect(() => {
    reload()
      .then(() => inspect(8000))
      .catch((cause: unknown) => setError(messageFromError(cause)))

    // Los eventos de sesión/proceso cambian la lista; los logs no la afectan.
    const unsubscribe = window.api.launcher.onEvent((event) => {
      if (event.type !== 'log') void refreshProcesses().catch(() => undefined)
    })
    // El tiempo transcurrido y los procesos que mueren solos se refrescan solos.
    const timer = window.setInterval(() => {
      void refreshProcesses().catch(() => undefined)
    }, 5000)

    return () => {
      unsubscribe()
      window.clearInterval(timer)
    }
  }, [reload, refreshProcesses, inspect])

  const names = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  )
  const activeProcesses = processes.filter((process) => process.status === 'running')

  async function handleInspect(): Promise<void> {
    const value = Number(port)
    if (!Number.isInteger(value) || value < 1 || value > 65535) {
      setError('Escribe un puerto válido entre 1 y 65535.')
      return
    }

    setBusy('inspect')
    setError(null)
    try {
      await inspect(value)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setBusy(null)
    }
  }

  async function handleStop(processId: string): Promise<void> {
    setBusy(processId)
    setError(null)
    try {
      await window.api.launcher.stopService(processId)
      await refreshProcesses()
      if (inspection) await inspect(inspection.port)
    } catch (cause) {
      setError(messageFromError(cause))
    } finally {
      setBusy(null)
    }
  }

  const managedOwner = inspection?.owner
    ? processes.find((process) => process.pid === inspection.owner?.pid)
    : undefined

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Procesos gestionados</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Servicios lanzados por DevLauncher y quién ocupa cada puerto.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon="restart"
          onClick={() => void reload().catch((cause: unknown) => setError(messageFromError(cause)))}
        >
          Actualizar
        </Button>
      </div>

      <div className="p-5">
        {error && (
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
            <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {activeProcesses.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
            No hay procesos gestionados en ejecución.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {activeProcesses.map((process) => (
              <li
                key={process.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-slate-100">
                      {names.get(process.projectId) ?? 'Proyecto'}
                    </span>
                    <Badge tone="neutral">{KIND_LABELS[process.kind]}</Badge>
                    {process.pid !== null && (
                      <span className="font-mono text-[11px] text-slate-500">
                        PID {process.pid}
                      </span>
                    )}
                  </div>
                  <p
                    className="mt-0.5 truncate font-mono text-[11px] text-slate-500"
                    title={process.command}
                  >
                    {process.command}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  {process.ports.length > 0 && (
                    <span className="font-mono text-slate-400">:{process.ports.join(', :')}</span>
                  )}
                  <span className="text-slate-500">{formatElapsed(process.startedAt)}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleStop(process.id)}
                    loading={busy === process.id}
                  >
                    {busy === process.id ? 'Parando…' : 'Detener'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 border-t border-slate-800 pt-4">
          <h3 className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Comprobar un puerto
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={1}
              max={65535}
              value={port}
              onChange={(event) => setPort(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleInspect()
              }}
              aria-label="Puerto a comprobar"
              className="h-9 w-28 rounded-lg border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-200 outline-none transition focus:border-indigo-500"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleInspect()}
              loading={busy === 'inspect'}
            >
              {busy === 'inspect' ? 'Comprobando…' : 'Comprobar'}
            </Button>
          </div>

          {inspection && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs">
              <span className="font-mono text-slate-300">:{inspection.port}</span>
              <Badge tone={inspection.available ? 'success' : 'warning'}>
                {inspection.available ? 'Libre' : 'Ocupado'}
              </Badge>
              {inspection.owner && (
                <span className="text-slate-400">
                  por {inspection.owner.name ?? 'un proceso desconocido'} (PID{' '}
                  {inspection.owner.pid})
                </span>
              )}
              {inspection.reservedByUs && (
                <span className="text-indigo-300">reservado por DevLauncher</span>
              )}
              {managedOwner && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => void handleStop(managedOwner.id)}
                  loading={busy === managedOwner.id}
                >
                  Detener ese proceso
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export default PortsPanel
