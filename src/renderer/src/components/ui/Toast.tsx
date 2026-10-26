import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import Icon from './Icon'
import type { IconName } from './Icon'

type ToastTone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

interface ToastContextValue {
  notify: (toast: Omit<ToastItem, 'id'>) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE_STYLES: Record<ToastTone, { icon: IconName; iconClass: string; border: string }> = {
  success: { icon: 'check', iconClass: 'text-emerald-300', border: 'border-emerald-500/30' },
  error: { icon: 'alert', iconClass: 'text-red-300', border: 'border-red-500/30' },
  info: { icon: 'info', iconClass: 'text-sky-300', border: 'border-sky-500/30' }
}

const AUTO_DISMISS_MS = 6000

/**
 * Avisos flotantes junto a la acción que los provoca. Sustituyen a los banners
 * de error globales: el mensaje aparece cerca del usuario y desaparece solo.
 */
export function ToastProvider({ children }: { children: ReactNode }): ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id))
    const timer = timers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const notify = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = nextId.current
      nextId.current += 1
      // Como máximo tres avisos a la vez: el más antiguo se descarta.
      setToasts((previous) => [...previous.slice(-2), { ...toast, id }])
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      )
    },
    [dismiss]
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => window.clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const value = useMemo(() => ({ notify }), [notify])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const tone = TONE_STYLES[toast.tone]
          return (
            <div
              key={toast.id}
              role={toast.tone === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex animate-[toast-in_160ms_ease-out] items-start gap-3 rounded-xl border ${tone.border} bg-slate-900/95 p-3 shadow-2xl shadow-slate-950/60 backdrop-blur`}
            >
              <Icon name={tone.icon} size={16} className={`mt-0.5 shrink-0 ${tone.iconClass}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
                    {toast.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Cerrar aviso"
                className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200"
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

/** Acceso al sistema de avisos. */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>.')
  return context
}
