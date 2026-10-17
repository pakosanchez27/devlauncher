import { useState } from 'react'
import type { ReactElement } from 'react'
import type { PingResponse } from '@shared/types/ipc'

/** Prueba interactiva del canal IPC `app:ping` renderer → main. */
function PingPanel(): ReactElement {
  const [message, setMessage] = useState('Hola desde el renderer')
  const [response, setResponse] = useState<PingResponse | null>(null)
  const [loading, setLoading] = useState(false)

  async function handlePing(): Promise<void> {
    setLoading(true)
    try {
      const result = await window.api.ping({ message })
      setResponse(result)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
      <h2 className="mb-1 text-lg font-semibold">Prueba de IPC seguro</h2>
      <p className="mb-4 text-sm text-slate-400">
        El renderer invoca <code className="rounded bg-slate-800 px-1">app:ping</code> y el proceso
        principal responde.
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Escribe un mensaje"
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={handlePing}
          disabled={loading}
          className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-400 disabled:opacity-50"
        >
          {loading ? 'Enviando…' : 'Enviar ping'}
        </button>
      </div>

      {response && (
        <dl className="mt-4 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-slate-500">reply:</dt>
            <dd className="font-mono text-emerald-400">{response.reply}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">runtime:</dt>
            <dd className="font-mono text-slate-200">{response.runtime}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500">timestamp:</dt>
            <dd className="font-mono text-slate-200">{response.timestamp}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

export default PingPanel
