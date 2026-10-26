import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { LaunchServiceKind, LaunchSession } from '@shared/types/launcher'
import type { LogEntry } from '../lib/launch-context'
import { buildLogText, detectLogLevel, formatLogTime, slugifyFileName } from '../lib/logs'
import type { LogLevel } from '../lib/logs'
import { SERVICE_KIND_LABELS } from '../lib/launch-labels'
import { messageFromError } from '../lib/ipc-error'
import Button from './ui/Button'
import ConfirmDialog from './ui/ConfirmDialog'
import Icon from './ui/Icon'
import { useToast } from './ui/Toast'

type LevelFilter = 'all' | 'problems' | 'error'

interface DecoratedEntry extends LogEntry {
  level: LogLevel
}

const LEVEL_TEXT: Record<LogLevel, string> = {
  error: 'text-red-300',
  warn: 'text-amber-300',
  info: 'text-sky-200',
  debug: 'text-slate-400',
  plain: 'text-slate-300'
}

const LEVEL_ROW: Record<LogLevel, string> = {
  error: 'bg-red-500/5',
  warn: 'bg-amber-500/5',
  info: '',
  debug: '',
  plain: ''
}

const SERVICE_TEXT: Record<LaunchServiceKind, string> = {
  php: 'text-indigo-300',
  node: 'text-emerald-300',
  vite: 'text-violet-300',
  wamp: 'text-amber-300'
}

const LEVEL_FILTERS: Array<{ id: LevelFilter; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'problems', label: 'Problemas' },
  { id: 'error', label: 'Errores' }
]

interface FilterChipProps {
  active: boolean
  count?: number
  title?: string
  onClick: () => void
  children: string
}

function FilterChip({ active, count, title, onClick, children }: FilterChipProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition ${
        active
          ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200'
          : 'border-slate-700 bg-slate-950/40 text-slate-400 hover:border-slate-500 hover:text-slate-200'
      }`}
    >
      {children}
      {count !== undefined && <span className="tabular-nums text-slate-500">{count}</span>}
    </button>
  )
}

interface LogViewerProps {
  session: LaunchSession
  entries: LogEntry[]
  onClear: () => void
}

/**
 * Visor de la salida de una sesión (EP-08): filtra por servicio, nivel y texto,
 * resalta los problemas, sigue las líneas nuevas y permite copiar, exportar o
 * vaciar el registro. La salida se conserva en el contexto de la aplicación, así
 * que cambiar de sección no la pierde.
 */
function LogViewer({ session, entries, onClear }: LogViewerProps): ReactElement {
  const { notify } = useToast()
  const logRef = useRef<HTMLDivElement>(null)

  const [serviceFilter, setServiceFilter] = useState<string>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [query, setQuery] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [atBottom, setAtBottom] = useState(true)
  const [copying, setCopying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const serviceById = useMemo(
    () => new Map(session.services.map((service) => [service.id, service])),
    [session.services]
  )
  const labels = useMemo(
    () => new Map(session.services.map((service) => [service.id, service.label])),
    [session.services]
  )

  const decorated = useMemo<DecoratedEntry[]>(
    () => entries.map((entry) => ({ ...entry, level: detectLogLevel(entry.line) })),
    [entries]
  )

  const serviceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of entries) {
      counts.set(entry.processId, (counts.get(entry.processId) ?? 0) + 1)
    }
    return counts
  }, [entries])

  const problemCount = useMemo(
    () => decorated.filter((entry) => entry.level === 'error' || entry.level === 'warn').length,
    [decorated]
  )

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return decorated.filter((entry) => {
      if (serviceFilter !== 'all' && entry.processId !== serviceFilter) return false
      if (levelFilter === 'error' && entry.level !== 'error') return false
      if (levelFilter === 'problems' && entry.level !== 'error' && entry.level !== 'warn') {
        return false
      }
      if (needle && !entry.line.toLowerCase().includes(needle)) return false
      return true
    })
  }, [decorated, levelFilter, query, serviceFilter])

  useEffect(() => {
    const node = logRef.current
    if (!node) return
    if (autoScroll) {
      node.scrollTop = node.scrollHeight
      setAtBottom(true)
      return
    }
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    setAtBottom(bottom)
  }, [autoScroll, visible])

  function handleScroll(): void {
    const node = logRef.current
    if (!node) return
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
    setAtBottom(bottom)
    setAutoScroll(bottom)
  }

  function scrollToBottom(): void {
    setAutoScroll(true)
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }

  function resetFilters(): void {
    setServiceFilter('all')
    setLevelFilter('all')
    setQuery('')
  }

  async function handleCopy(): Promise<void> {
    if (visible.length === 0) return
    setCopying(true)
    try {
      await window.api.copyText(buildLogText(visible, labels))
      notify({
        tone: 'success',
        title: 'Registro copiado',
        description: `${visible.length} ${visible.length === 1 ? 'línea' : 'líneas'} en el portapapeles.`
      })
    } catch (cause) {
      notify({
        tone: 'error',
        title: 'No se pudo copiar el registro',
        description: messageFromError(cause)
      })
    } finally {
      setCopying(false)
    }
  }

  async function handleExport(): Promise<void> {
    if (visible.length === 0) return
    setExporting(true)
    try {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      const levelDescription =
        levelFilter === 'all'
          ? 'todos los niveles'
          : levelFilter === 'problems'
            ? 'avisos y errores'
            : 'solo errores'
      const header = [
        `# DevLauncher — ${session.projectName}`,
        `# ${session.projectPath}`,
        `# Exportado: ${new Date().toLocaleString('es-ES')}`,
        `# Servicio: ${serviceFilter === 'all' ? 'todos' : (labels.get(serviceFilter) ?? serviceFilter)}`,
        `# Nivel: ${levelDescription}`,
        `# Búsqueda: ${query.trim() || '(ninguna)'}`,
        ''
      ].join('\n')

      const result = await window.api.logs.export({
        suggestedName: `${slugifyFileName(session.projectName)}-${stamp}.log`,
        content: `${header}${buildLogText(visible, labels)}\n`
      })

      if (result.saved) {
        notify({
          tone: 'success',
          title: 'Registro guardado',
          description: result.path
        })
      }
    } catch (cause) {
      notify({
        tone: 'error',
        title: 'No se pudo guardar el registro',
        description: messageFromError(cause)
      })
    } finally {
      setExporting(false)
    }
  }

  function handleClear(): void {
    onClear()
    setConfirmClear(false)
    notify({ tone: 'info', title: 'Registro vaciado', description: session.projectName })
  }

  const lineWord = entries.length === 1 ? 'línea' : 'líneas'

  return (
    <div className="border-t border-slate-800 bg-slate-950/70">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div
          className="flex flex-wrap items-center gap-1"
          role="group"
          aria-label="Filtrar por servicio"
        >
          <FilterChip
            active={serviceFilter === 'all'}
            count={entries.length}
            onClick={() => setServiceFilter('all')}
          >
            Todos
          </FilterChip>
          {session.services.map((service) => (
            <FilterChip
              key={service.id}
              active={serviceFilter === service.id}
              count={serviceCounts.get(service.id) ?? 0}
              title={service.label}
              onClick={() => setServiceFilter(service.id)}
            >
              {SERVICE_KIND_LABELS[service.kind]}
            </FilterChip>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Buscar en el registro</span>
            <Icon
              name="search"
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar…"
              className="h-8 w-40 rounded-lg border border-slate-700 bg-slate-950 pl-7 pr-2 text-xs text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500"
            />
          </label>

          <div
            className="inline-flex overflow-hidden rounded-lg border border-slate-700"
            role="group"
            aria-label="Filtrar por nivel"
          >
            {LEVEL_FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={levelFilter === option.id}
                onClick={() => setLevelFilter(option.id)}
                className={`px-2 py-1 text-[11px] transition ${
                  levelFilter === option.id
                    ? 'bg-indigo-500/15 text-indigo-200'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/70 px-3 py-2">
        <span className="text-[11px] tabular-nums text-slate-500">
          {visible.length} de {entries.length} {lineWord}
        </span>
        {problemCount > 0 && (
          <span className="text-[11px] text-amber-300">{problemCount} con problemas</span>
        )}

        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-400">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(event) => setAutoScroll(event.target.checked)}
            className="h-3.5 w-3.5 accent-indigo-500"
          />
          Seguir salida
        </label>
        {!atBottom && (
          <Button size="sm" variant="ghost" icon="arrow-down" onClick={scrollToBottom}>
            Ir al final
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon="copy"
          onClick={() => void handleCopy()}
          loading={copying}
          disabled={visible.length === 0}
        >
          Copiar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="download"
          onClick={() => void handleExport()}
          loading={exporting}
          disabled={visible.length === 0}
        >
          Exportar
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          onClick={() => setConfirmClear(true)}
          disabled={entries.length === 0}
        >
          Vaciar
        </Button>
      </div>

      <div
        ref={logRef}
        onScroll={handleScroll}
        role="region"
        tabIndex={0}
        aria-label={`Salida de ${session.projectName}`}
        className="max-h-72 overflow-auto border-t border-slate-800/70 font-mono text-[11px] leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
      >
        {visible.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">
            <p>
              {entries.length === 0
                ? 'Todavía no hay salida. Las líneas aparecerán aquí en cuanto los procesos escriban algo.'
                : 'Ninguna línea coincide con los filtros.'}
            </p>
            {entries.length > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-2 text-xs text-indigo-300 transition hover:text-indigo-200 hover:underline"
              >
                Quitar filtros
              </button>
            )}
          </div>
        ) : (
          visible.map((entry, index) => {
            const service = serviceById.get(entry.processId)
            const label = service
              ? SERVICE_KIND_LABELS[service.kind]
              : (labels.get(entry.processId) ?? entry.processId.slice(0, 8))
            return (
              <div
                key={`${entry.at}-${index}`}
                className={`flex gap-2 px-3 py-0.5 ${LEVEL_ROW[entry.level]}`}
              >
                <span className="w-14 shrink-0 tabular-nums text-slate-600">
                  {formatLogTime(entry.at)}
                </span>
                <span
                  className={`w-12 shrink-0 truncate text-[10px] uppercase tracking-wide ${
                    service ? SERVICE_TEXT[service.kind] : 'text-slate-500'
                  }`}
                  title={service?.label ?? label}
                >
                  {label}
                </span>
                <span
                  className={`min-w-0 whitespace-pre-wrap break-words ${LEVEL_TEXT[entry.level]}`}
                >
                  {entry.line}
                </span>
              </div>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="¿Vaciar el registro?"
        description={`Se quitarán las ${entries.length} líneas de «${session.projectName}» de esta vista. La salida nueva seguirá apareciendo.`}
        confirmLabel="Vaciar registro"
        tone="danger"
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  )
}

export default LogViewer
