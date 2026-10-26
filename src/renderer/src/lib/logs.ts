import type { EnvironmentReport, PortsReport } from '@shared/types/environment'
import type { AppInfo } from '@shared/types/ipc'
import type { LaunchSession } from '@shared/types/launcher'
import type { LogEntry } from './launch-context'
import { LAUNCH_STATE_LABELS, STEP_LABELS } from './launch-labels'

/** Nivel deducido de una línea de salida. */
export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'plain'

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  error: 'Error',
  warn: 'Aviso',
  info: 'Info',
  debug: 'Depuración',
  plain: 'Salida'
}

const ERROR_PATTERN =
  /\b(?:error|err|failed|failure|fatal|exception|critical|panic|traceback|uncaught|sqlstate|eaddrinuse)\b/i
const WARN_PATTERN = /\b(?:warn(?:ing)?s?|deprecat(?:ed|ion|ions))\b/i
const INFO_PATTERN =
  /\b(?:info|notice|ready|listening|compiled|built|started|serving|success|successfully|running)\b/i
const DEBUG_PATTERN = /\b(?:debug|verbose|trace)\b/i

/**
 * Deduce el nivel de una línea sin exigir un formato concreto: Laravel, Vite,
 * npm y PHP escriben de formas distintas, así que se buscan palabras clave
 * habituales. Las líneas normales se quedan como `plain`.
 */
export function detectLogLevel(line: string): LogLevel {
  if (/^\[(?:error|err)\]/i.test(line) || ERROR_PATTERN.test(line)) return 'error'
  if (WARN_PATTERN.test(line)) return 'warn'
  if (INFO_PATTERN.test(line)) return 'info'
  if (DEBUG_PATTERN.test(line)) return 'debug'
  return 'plain'
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** Fecha y hora local en formato `YYYY-MM-DD HH:mm:ss`. */
export function formatTimestamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return typeof value === 'string' ? value : '—'
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Hora local de una línea, para la columna izquierda del visor. */
export function formatLogTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--:--'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** Etiqueta de cada servicio de la sesión, indexada por id de proceso. */
export function buildServiceLabels(session: LaunchSession): Map<string, string> {
  return new Map(session.services.map((service) => [service.id, service.label]))
}

/** Texto plano de un conjunto de líneas, con hora y servicio. */
export function buildLogText(entries: LogEntry[], labels: Map<string, string>): string {
  return entries
    .map((entry) => {
      const service = labels.get(entry.processId) ?? entry.processId.slice(0, 8)
      return `[${formatTimestamp(entry.at)}] [${service}] ${entry.line}`
    })
    .join('\n')
}

/** Informe legible de una sesión, útil para copiar y compartir un fallo. */
export function buildSessionReport(session: LaunchSession, entries: LogEntry[]): string {
  const labels = buildServiceLabels(session)
  const lines: string[] = [
    `Proyecto: ${session.projectName}`,
    `Ruta: ${session.projectPath}`,
    `Estado: ${LAUNCH_STATE_LABELS[session.state]}`
  ]

  if (session.startedAt) lines.push(`Inicio: ${formatTimestamp(session.startedAt)}`)
  if (session.finishedAt) lines.push(`Fin: ${formatTimestamp(session.finishedAt)}`)
  if (session.error) lines.push(`Error: ${session.error}`)
  if (session.urls.app) lines.push(`Aplicación: ${session.urls.app}`)
  if (session.urls.vite) lines.push(`Frontend: ${session.urls.vite}`)

  lines.push('', 'Pasos:')
  if (session.steps.length === 0) {
    lines.push('- Sin pasos registrados.')
  } else {
    for (const step of session.steps) {
      lines.push(
        `- ${step.label} [${STEP_LABELS[step.state]}]${step.message ? `: ${step.message}` : ''}`
      )
    }
  }

  lines.push('', 'Servicios:')
  if (session.services.length === 0) {
    lines.push('- Sin servicios registrados.')
  } else {
    for (const service of session.services) {
      const details: string[] = [service.status]
      if (service.ports.length > 0) details.push(`puertos ${service.ports.join(', ')}`)
      if (service.pid !== null) details.push(`PID ${service.pid}`)
      lines.push(`- ${service.label}: ${details.join(' · ')}`)
    }
  }

  const tail = entries.slice(-100)
  lines.push('', 'Últimas líneas de salida:')
  lines.push(tail.length > 0 ? buildLogText(tail, labels) : '(sin salida)')

  return lines.join('\n')
}

interface DiagnosticsReportInput {
  report: EnvironmentReport
  ports: PortsReport
  appInfo: AppInfo
  generatedAt?: Date
}

/** Informe del entorno para soporte: herramientas, WampServer y puertos. */
export function buildDiagnosticsReport({
  report,
  ports,
  appInfo,
  generatedAt = new Date()
}: DiagnosticsReportInput): string {
  const requiredMissing = report.tools.filter((tool) => tool.required && !tool.available)
  const lines: string[] = [
    `DevLauncher ${appInfo.version} — Informe de diagnóstico`,
    `Generado: ${formatTimestamp(generatedAt)}`,
    `Equipo: ${appInfo.platform} · Electron ${appInfo.electron} · Node ${appInfo.node} · Chrome ${appInfo.chrome}`,
    '',
    'HERRAMIENTAS'
  ]

  for (const tool of report.tools) {
    const state = tool.available
      ? `disponible${tool.version ? ` (${tool.version})` : ''}`
      : 'NO disponible'
    const path = tool.path ? ` — ${tool.path}` : ''
    const required = tool.required ? ' [obligatoria]' : ''
    lines.push(`- ${tool.label}: ${state}${path}${required}`)
  }
  lines.push(
    requiredMissing.length > 0
      ? `Faltan obligatorias: ${requiredMissing.map((tool) => tool.label).join(', ')}`
      : 'No faltan herramientas obligatorias.'
  )

  lines.push('', 'WAMPSERVER')
  if (report.wamp.installed) {
    lines.push(`- Detectado: ${report.wamp.path ?? 'ruta desconocida'}`)
    if (report.wamp.mysqlPath) lines.push(`- MySQL: ${report.wamp.mysqlPath}`)
  } else {
    lines.push('- No detectado.')
  }

  lines.push('', 'PUERTOS')
  if (ports.ports.length === 0) {
    lines.push('- Sin puertos revisados.')
  } else {
    for (const port of ports.ports) {
      const owner = port.owner
        ? ` por ${port.owner.name ?? 'proceso desconocido'} (PID ${port.owner.pid})`
        : ''
      const reserved = port.reservedByUs ? ' [reservado por DevLauncher]' : ''
      lines.push(
        `- ${port.label} (:${port.port}): ${port.available ? 'libre' : `ocupado${owner}`}${reserved}`
      )
    }
  }

  lines.push(
    '',
    `Último análisis del entorno: ${formatTimestamp(report.generatedAt)}`,
    `Última comprobación de puertos: ${formatTimestamp(ports.generatedAt)}`
  )

  return lines.join('\n')
}

/** Convierte un nombre de proyecto en un nombre de archivo seguro. */
export function slugifyFileName(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  return slug || 'proyecto'
}
