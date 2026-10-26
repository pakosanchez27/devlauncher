import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { LaunchSession } from '@shared/types/launcher'

/** Línea de salida de un proceso, con el proceso que la emitió. */
export interface LogEntry {
  processId: string
  line: string
  /** Momento en que la línea llegó al renderer (ISO 8601). */
  at: string
}

interface LaunchContextValue {
  /** Sesiones de arranque, la más reciente primero. */
  sessions: LaunchSession[]
  /** Salida de los procesos agrupada por proyecto. */
  logs: Record<string, LogEntry[]>
  /** Vacía la salida acumulada de un proyecto. */
  clearLogs: (projectId: string) => void
}

const MAX_LOG_LINES = 500

const LaunchContext = createContext<LaunchContextValue | null>(null)

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

/**
 * Estado compartido del motor de arranque: una sola suscripción a
 * `launcher:event` alimenta el contador de la barra lateral, las tarjetas y la
 * vista de actividad, sin duplicar listeners ni peticiones.
 */
export function LaunchProvider({ children }: { children: ReactNode }): ReactElement {
  const [sessions, setSessions] = useState<LaunchSession[]>([])
  const [logs, setLogs] = useState<Record<string, LogEntry[]>>({})

  useEffect(() => {
    let active = true

    window.api.launcher
      .status()
      .then((current) => {
        if (active) setSessions([...current].sort(byStartedAtDesc))
      })
      .catch(() => undefined)

    const unsubscribe = window.api.launcher.onEvent((event) => {
      if (event.type === 'session') {
        setSessions((previous) => upsertSession(previous, event.session))
        return
      }

      if (event.type === 'log') {
        setLogs((previous) => {
          const entries = [
            ...(previous[event.projectId] ?? []),
            { processId: event.processId, line: event.line, at: new Date().toISOString() }
          ]
          return { ...previous, [event.projectId]: entries.slice(-MAX_LOG_LINES) }
        })
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

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const clearLogs = useCallback((projectId: string): void => {
    setLogs((previous) => {
      if (!(projectId in previous)) return previous
      const next = { ...previous }
      delete next[projectId]
      return next
    })
  }, [])

  const value = useMemo(() => ({ sessions, logs, clearLogs }), [sessions, logs, clearLogs])

  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>
}

/** Estado del motor de arranque compartido por toda la interfaz. */
export function useLaunch(): LaunchContextValue {
  const context = useContext(LaunchContext)
  if (!context) throw new Error('useLaunch debe usarse dentro de <LaunchProvider>.')
  return context
}
