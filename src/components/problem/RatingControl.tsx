import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { difficultyColor, DIFFICULTY_LABELS } from '@/lib/scale'
import { COMPLETION_LABELS, TIME_BUCKETS, bucketForMinutes } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { useRateProblem } from '@/hooks/queries'
import { useTheme } from '@/hooks/useTheme'
import { useToast } from '@/components/ui/toast'
import { errorMessage, isAuthError } from '@/lib/errors'
import type { CompletionStatus, MyRating } from '@/lib/types'

interface Props {
  problemId: string
  offeringId: string
  label: string
  current: MyRating | null | undefined
  compact?: boolean
  showExtras?: boolean
  autoFocus?: boolean
  onRated?: (value: number) => void
  className?: string
}

const ANCHORS: Record<number, string> = { 1: 'Trivial', 3: 'Easy', 5: 'Moderate', 7: 'Hard', 10: 'Extreme' }

/**
 * 1–10 difficulty picker. One click saves (optimistically). Signed-out users can still pick; the choice is
 * kept and submitted after sign-in. Keyboard: 1–9, 0 = 10, arrows, Backspace clears.
 */
export function RatingControl({ problemId, offeringId, label, current, compact, showExtras = !compact, autoFocus, onRated, className }: Props) {
  const { user, openSignIn, setPending, pending } = useAuth()
  const { theme } = useTheme()
  const toast = useToast()
  const rate = useRateProblem(offeringId)
  const groupRef = useRef<HTMLDivElement>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [preciseOpen, setPreciseOpen] = useState(false)

  const pendingHere = pending?.problemId === problemId ? pending : null
  const value = current && !current.stale ? current.difficulty : pendingHere?.difficulty ?? null
  const time = current?.time_minutes ?? pendingHere?.timeMinutes ?? null
  const completion = current?.completion_status ?? pendingHere?.completion ?? null
  const [precise, setPrecise] = useState(time != null && !bucketForMinutes(time) ? String(time) : '')

  useEffect(() => {
    if (autoFocus) groupRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus({ preventScroll: true })
  }, [autoFocus, problemId])

  useEffect(() => {
    if (!savedFlash) return
    const t = setTimeout(() => setSavedFlash(false), 1800)
    return () => clearTimeout(t)
  }, [savedFlash])

  const submit = (difficulty: number, timeMinutes: number | null, comp: CompletionStatus | null) => {
    if (!user) {
      setPending({ problemId, offeringId, label, difficulty, timeMinutes, completion: comp })
      openSignIn(`Sign in to save your ${difficulty}/10 rating for ${label}. We’ll keep your choice while you sign in.`)
      return
    }
    rate.mutate(
      { problemId, difficulty, timeMinutes, completion: comp },
      {
        onSuccess: () => {
          setSavedFlash(true)
          onRated?.(difficulty)
        },
        onError: (e) => {
          if (isAuthError(e)) openSignIn('Your session expired. Sign in again to save your rating.')
          else toast({ tone: 'error', message: `Rating not saved: ${errorMessage(e)}` })
        },
      },
    )
  }

  const clear = () => {
    if (!user) return setPending(null)
    rate.mutate({ problemId, difficulty: 0, timeMinutes: null, completion: null, clear: true }, { onError: (e) => toast({ tone: 'error', message: errorMessage(e) }) })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (/^[0-9]$/.test(e.key)) {
      e.preventDefault()
      const v = e.key === '0' ? 10 : Number(e.key)
      submit(v, time, completion)
      groupRef.current?.querySelector<HTMLElement>(`[data-v="${v}"]`)?.focus()
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const from = Number((e.target as HTMLElement).dataset.v ?? value ?? 5)
      const to = Math.min(10, Math.max(1, from + (e.key === 'ArrowRight' ? 1 : -1)))
      groupRef.current?.querySelector<HTMLElement>(`[data-v="${to}"]`)?.focus()
    } else if ((e.key === 'Backspace' || e.key === 'Delete') && value != null) {
      e.preventDefault()
      clear()
    }
  }

  const saving = rate.isPending
  const status = pendingHere && !user ? 'Sign in to save' : saving ? 'Saving…' : savedFlash ? 'Saved' : value != null ? 'Your rating' : null

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        {!compact ? <span className="text-xs font-medium text-muted">How hard was it for you?</span> : null}
        <span className={cn('ml-auto inline-flex h-4 items-center gap-1 text-xs', savedFlash ? 'text-ok' : 'text-faint')} aria-live="polite">
          {savedFlash ? <Check className="size-3.5" /> : null}
          {status}
          {value != null && !saving && user ? (
            <button onClick={clear} className="ml-1.5 text-faint underline-offset-2 hover:text-text hover:underline">
              clear
            </button>
          ) : null}
        </span>
      </div>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-label={`Difficulty of ${label}, 1 (trivial) to 10 (extremely difficult)`}
        onKeyDown={onKeyDown}
        className={cn('mt-1.5 grid grid-cols-10 gap-[3px]', compact && 'mt-0')}
      >
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => {
          const sel = value === v
          const sw = difficultyColor(v, theme)
          return (
            <button
              key={v}
              data-v={v}
              role="radio"
              aria-checked={sel}
              aria-label={`${v} — ${DIFFICULTY_LABELS[v]}`}
              title={`${v} — ${DIFFICULTY_LABELS[v]}`}
              tabIndex={(value ?? 5) === v ? 0 : -1}
              onClick={() => submit(v, time, completion)}
              style={sel ? { backgroundColor: sw.bg, color: sw.fg, borderColor: 'transparent' } : { ['--sw' as string]: sw.bg }}
              className={cn(
                'relative h-9 rounded-md border border-border bg-surface text-[13px] font-medium tabular transition-colors hover:border-transparent hover:bg-[var(--sw)] hover:text-[#1f1d1a]',
                compact && 'h-8 text-xs',
                sel && 'animate-pop font-semibold shadow-sm',
              )}
            >
              {v}
            </button>
          )
        })}
      </div>
      {!compact ? (
        <div className="mt-1 grid grid-cols-10 text-[10px] text-faint" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={cn('text-center', i === 9 && 'text-right', i === 0 && 'text-left')}>
              {ANCHORS[i + 1] ?? ''}
            </span>
          ))}
        </div>
      ) : null}

      {showExtras ? (
        <div className={cn('mt-4 space-y-3 transition-opacity', value == null && 'pointer-events-none opacity-40')} aria-disabled={value == null}>
          <fieldset>
            <legend className="mb-1.5 text-xs text-muted">
              Approximately how long did you spend? <span className="text-faint">(optional)</span>
            </legend>
            <div className="flex flex-wrap gap-1">
              {TIME_BUCKETS.map((b) => {
                const on = time === b.minutes
                return (
                  <button
                    key={b.minutes}
                    aria-pressed={on}
                    title={b.label}
                    onClick={() => value != null && submit(value, on ? null : b.minutes, completion)}
                    className={cn('h-7 rounded-md border px-2 text-xs tabular transition-colors', on ? 'border-text bg-text text-bg' : 'border-border text-muted hover:border-border-strong hover:text-text')}
                  >
                    {b.short}
                  </button>
                )
              })}
              <button onClick={() => setPreciseOpen((x) => !x)} className={cn('h-7 rounded-md px-2 text-xs text-muted hover:text-text', time != null && !bucketForMinutes(time) && 'font-medium text-text')}>
                {time != null && !bucketForMinutes(time) ? `${time} min` : 'exact…'}
              </button>
            </div>
            {preciseOpen ? (
              <form
                className="mt-2 flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  const m = Math.round(Number(precise))
                  if (value != null && m >= 1 && m <= 6000) submit(value, m, completion)
                  setPreciseOpen(false)
                }}
              >
                <input
                  type="number"
                  min={1}
                  max={6000}
                  inputMode="numeric"
                  value={precise}
                  onChange={(e) => setPrecise(e.target.value)}
                  className="h-7 w-24 rounded-md border border-border bg-surface px-2 text-xs tabular"
                  aria-label="Minutes spent"
                  placeholder="minutes"
                />
                <button type="submit" className="h-7 rounded-md border border-border px-2 text-xs hover:bg-surface-2">
                  Save
                </button>
              </form>
            ) : null}
          </fieldset>
          <fieldset>
            <legend className="mb-1.5 text-xs text-muted">
              How did it go? <span className="text-faint">(optional — every rating counts the same)</span>
            </legend>
            <div className="flex flex-wrap gap-1">
              {(Object.keys(COMPLETION_LABELS) as CompletionStatus[]).map((k) => {
                const on = completion === k
                return (
                  <button
                    key={k}
                    aria-pressed={on}
                    onClick={() => value != null && submit(value, time, on ? null : k)}
                    className={cn('h-7 rounded-md border px-2 text-xs transition-colors', on ? 'border-text bg-text text-bg' : 'border-border text-muted hover:border-border-strong hover:text-text')}
                  >
                    {COMPLETION_LABELS[k]}
                  </button>
                )
              })}
            </div>
          </fieldset>
        </div>
      ) : null}
      {current?.stale ? <p className="mt-2 text-xs text-warn">This problem changed significantly since you rated it ({current.difficulty}/10). Please rate it again.</p> : null}
    </div>
  )
}
