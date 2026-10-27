import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/cn'

type Tone = 'success' | 'error' | 'info'
interface ToastItem {
  id: number
  tone: Tone
  message: ReactNode
  action?: { label: string; onClick: () => void }
}

const Ctx = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => {})

export function useToast() {
  return useContext(Ctx)
}

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), [])
  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = ++counter
      setItems((xs) => [...xs.slice(-3), { ...t, id }])
      setTimeout(() => dismiss(id), t.tone === 'error' ? 7000 : 3800)
    },
    [dismiss],
  )
  const value = useMemo(() => push, [push])
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? AlertCircle : Info
          return (
            <div key={t.id} className="pointer-events-auto flex max-w-md items-center gap-2.5 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm shadow-lg shadow-black/5 animate-fade-in">
              <Icon className={cn('size-4 shrink-0', t.tone === 'success' && 'text-ok', t.tone === 'error' && 'text-danger', t.tone === 'info' && 'text-muted')} />
              <div className="min-w-0 flex-1">{t.message}</div>
              {t.action ? (
                <button className="text-xs font-medium underline underline-offset-2" onClick={() => { t.action!.onClick(); dismiss(t.id) }}>
                  {t.action.label}
                </button>
              ) : null}
              <button onClick={() => dismiss(t.id)} className="text-faint hover:text-text" aria-label="Dismiss">
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}
