import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { EnvironmentReport, PortsReport } from '@shared/types/environment'
import { messageFromError } from '../lib/ipc-error'
import { buildDiagnosticsReport, formatTimestamp } from '../lib/logs'
import Button from './ui/Button'
import Icon from './ui/Icon'
import type { IconName } from './ui/Icon'
import { useToast } from './ui/Toast'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

const TONE_TEXT: Record<Tone, string> = {
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
  neutral: 'text-slate-200'
}

interface StatProps {
  icon: IconName
  label: string
  value: string
  detail: string
  tone: Tone
}

function Stat({ icon, label, value, detail, tone }: StatProps): ReactElement {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-3">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
        <Icon name={icon} size={12} className={TONE_TEXT[tone]} />
        {label}
      </div>
      <p className={`mt-1.5 text-lg font-semibold leading-none ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500" title={detail}>
        {detail}
      </p>
    </div>
  )
}

interface DiagnosticsSummaryProps {
  report: EnvironmentReport
  ports: PortsReport
}

/**
 * Resumen del estado del equipo (EP-08): herramientas, WampServer y puertos.
 * Reúne en un vistazo lo que antes estaba repartido y permite copiar un
 * informe completo para compartirlo.
 */
function DiagnosticsSummary({ report, ports }: DiagnosticsSummaryProps): ReactElement {
  const { notify } = useToast()
  const [copying, setCopying] = useState(false)

  const requiredMissing = useMemo(
    () => report.tools.filter((tool) => tool.required && !tool.available),
    [report.tools]
  )
  const missingTools = useMemo(() => report.tools.filter((tool) => !tool.available), [report.tools])
  const occupied = useMemo(() => ports.ports.filter((port) => !port.available), [ports.ports])

  const availableTools = report.tools.length - missingTools.length
  const toolsTone: Tone =
    requiredMissing.length > 0 ? 'danger' : missingTools.length > 0 ? 'warning' : 'success'
  const toolsDetail =
    requiredMissing.length > 0
      ? `Faltan: ${requiredMissing.map((tool) => tool.label).join(', ')}`
      : missingTools.length > 0
        ? `Opcionales no detectadas: ${missingTools.map((tool) => tool.label).join(', ')}`
        : 'Todas las herramientas están disponibles.'

  const portsDetail =
    occupied.length === 0
      ? 'Todos los puertos revisados están libres.'
      : occupied
          .map((port) => `:${port.port} ${port.owner?.name ?? 'proceso desconocido'}`)
          .join(' · ')

  async function handleCopy(): Promise<void> {
    setCopying(true)
    try {
      const appInfo = await window.api.getAppInfo()
      await window.api.copyText(buildDiagnosticsReport({ report, ports, appInfo }))
      notify({
        tone: 'success',
        title: 'Informe copiado',
        description: 'Incluye herramientas, WampServer y puertos.'
      })
    } catch (cause) {
      notify({
        tone: 'error',
        title: 'No se pudo copiar el informe',
        description: messageFromError(cause)
      })
    } finally {
      setCopying(false)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Diagnóstico del entorno</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Herramientas, WampServer y puertos en un vistazo.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon="copy"
          onClick={() => void handleCopy()}
          loading={copying}
        >
          {copying ? 'Copiando…' : 'Copiar informe'}
        </Button>
      </div>

      <div className="grid gap-3 p-5 sm:grid-cols-3">
        <Stat
          icon="check"
          label="Herramientas"
          value={`${availableTools}/${report.tools.length}`}
          detail={toolsDetail}
          tone={toolsTone}
        />
        <Stat
          icon="activity"
          label="Puertos ocupados"
          value={String(occupied.length)}
          detail={portsDetail}
          tone={occupied.length > 0 ? 'warning' : 'success'}
        />
        <Stat
          icon="server"
          label="WampServer"
          value={report.wamp.installed ? 'Detectado' : 'No detectado'}
          detail={
            report.wamp.installed
              ? (report.wamp.path ?? 'Instalación detectada.')
              : 'Instálalo o indica su carpeta en Preferencias.'
          }
          tone={report.wamp.installed ? 'success' : 'neutral'}
        />
      </div>

      {requiredMissing.length > 0 && (
        <div className="mx-5 mb-5 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-300">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <p className="leading-relaxed">
            Faltan requisitos obligatorios:{' '}
            <strong>{requiredMissing.map((tool) => tool.label).join(', ')}</strong>. Los proyectos
            que los necesiten no podrán arrancar hasta que estén disponibles.
          </p>
        </div>
      )}

      <p className="border-t border-slate-800 px-5 py-2.5 text-[11px] text-slate-500">
        Herramientas: {formatTimestamp(report.generatedAt)} · Puertos:{' '}
        {formatTimestamp(ports.generatedAt)}
      </p>
    </section>
  )
}

export default DiagnosticsSummary
