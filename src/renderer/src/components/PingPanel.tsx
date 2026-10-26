import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PingResponse } from '@shared/types/ipc'
import Button from './ui/Button'

/** Prueba interactiva del canal IPC `app:ping` renderer → main. */
function PingPanel(): ReactElement {
  const [message, setMessage] = useState('Hola desde el renderer')
  const [response, setResponse] = useState<PingResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handlePing(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.ping({ message })
      setResponse(result)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <h2 className="text-sm font-semibold text-slate-100">Prueba de comunicación</h2>
      <p className="mt-0.5 text-xs text-slate-400">
        El renderer invoca <code className="rounded bg-slate-800 px-1">app:ping</code> y el proceso
        principal responde.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Escribe un mensaje"
          aria-label="Mensaje para el ping"
          className="h-9 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500"
        />
        <Button variant="primary" size="sm" onClick={handlePing} loading={loading}>
          {loading ? 'Enviando…' : 'Enviar ping'}
        </Button>
      </div>

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      {response && (
        <dl className="mt-3 space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="text-slate-500">Respuesta:</dt>
            <dd className="font-mono text-emerald-400">{response.reply}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Runtime:</dt>
            <dd className="font-mono text-slate-300">{response.runtime}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">Fecha:</dt>
            <dd className="font-mono text-slate-300">{response.timestamp}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

export default PingPanel
