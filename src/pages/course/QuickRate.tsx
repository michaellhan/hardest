import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/misc'
import { LazyMarkdown } from '@/components/LazyMarkdown'
import { RatingControl } from '@/components/problem/RatingControl'
import { useProblem } from '@/hooks/queries'
import { buildUnits, displayLabel } from '@/lib/stats'
import { shortAssignmentTitle } from '@/lib/format'
import type { MyRating, OverviewAssignment } from '@/lib/types'

/**
 * Keyboard-first pass through an assignment: press 1–9 or 0 (=10) to rate and advance, ←/→ to move,
 * S to skip. Starts at the first problem you haven't rated.
 */
export function QuickRate({ assignment, offeringId, myRatings, open, onOpenChange }: { assignment: OverviewAssignment; offeringId: string; myRatings?: Record<string, MyRating>; open: boolean; onOpenChange: (v: boolean) => void }) {
  const items = useMemo(
    () =>
      buildUnits(assignment).flatMap((u) =>
        u.parts.length ? u.parts.map((p) => ({ problem: p, label: displayLabel(p, u.problem.label), parentId: u.problem.id })) : [{ problem: u.problem, label: u.problem.label, parentId: null as string | null }],
      ),
    [assignment],
  )
  const firstUnrated = Math.max(0, items.findIndex((it) => !myRatings?.[it.problem.id] || myRatings[it.problem.id].stale))
  const [index, setIndex] = useState(firstUnrated)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (open) {
      setIndex(firstUnrated)
      setDone(false)
    }
    // Only when (re)opening; ratings changing mid-session must not jump around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const item = items[index]
  const detail = useProblem(item?.problem.id)
  const parentDetail = useProblem(item?.parentId)
  const rated = items.filter((it) => myRatings?.[it.problem.id] && !myRatings[it.problem.id].stale).length

  const advance = useCallback(() => {
    setIndex((i) => {
      if (i >= items.length - 1) {
        setDone(true)
        return i
      }
      return i + 1
    })
  }, [items.length])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return
      if (e.key === 'ArrowRight' && !(e.target as HTMLElement).closest('[role=radiogroup]')) advance()
      else if (e.key === 'ArrowLeft' && !(e.target as HTMLElement).closest('[role=radiogroup]')) setIndex((i) => Math.max(0, i - 1))
      else if (e.key === 's' || e.key === 'S') advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, advance])

  if (!items.length) return null
  const statement = detail.data?.problem.statement_markdown
  const parentStatement = item?.parentId ? parentDetail.data?.problem.statement_markdown : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Quick rate · ${assignment.title}`} description={<span className="tabular">{rated} of {items.length} rated</span>} className="max-w-2xl">
        <div className="mb-4 flex gap-[3px]" aria-hidden>
          {items.map((it, i) => {
            const mine = myRatings?.[it.problem.id]
            return (
              <button
                key={it.problem.id}
                tabIndex={-1}
                onClick={() => {
                  setIndex(i)
                  setDone(false)
                }}
                className={cn('h-1.5 flex-1 rounded-full transition-colors', mine && !mine.stale ? 'bg-text/70' : 'bg-surface-3', i === index && !done && 'ring-2 ring-focus ring-offset-1 ring-offset-surface')}
                title={it.label}
              />
            )
          })}
        </div>
        {done ? (
          <div className="py-8 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-ok/15 text-ok">
              <Check className="size-5" />
            </div>
            <p className="mt-3 font-medium">
              {rated === items.length ? 'All done — thank you!' : `You rated ${rated} of ${items.length}.`}
            </p>
            <p className="mt-1 text-sm text-muted">Your ratings are already reflected in the heatmap.</p>
            <div className="mt-5 flex justify-center gap-2">
              {rated < items.length ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setIndex(Math.max(0, items.findIndex((it) => !myRatings?.[it.problem.id])))
                    setDone(false)
                  }}
                >
                  Go to skipped
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : item ? (
          <div>
            <div className="flex items-baseline gap-2">
              <h3 className="text-lg font-semibold tracking-tight">
                {/^\d/.test(item.label) ? 'Problem ' : ''}
                {item.label}
              </h3>
              {item.problem.title ? <span className="truncate text-sm text-muted">{item.problem.title}</span> : null}
              <span className="ml-auto text-xs text-faint tabular">
                {index + 1} / {items.length}
              </span>
            </div>
            <div className="mt-2 max-h-[34vh] overflow-y-auto rounded-lg border border-border bg-bg px-3 py-2.5">
              {detail.isLoading ? (
                <p className="text-sm text-faint">Loading…</p>
              ) : statement || parentStatement ? (
                <>
                  {parentStatement ? <div className="mb-2 border-b border-border pb-2 text-muted"><LazyMarkdown>{parentStatement}</LazyMarkdown></div> : null}
                  {statement ? <LazyMarkdown>{statement}</LazyMarkdown> : null}
                </>
              ) : (
                <p className="text-sm text-faint">Statement not available yet — rate from memory.</p>
              )}
            </div>
            <RatingControl
              key={item.problem.id}
              className="mt-4"
              problemId={item.problem.id}
              offeringId={offeringId}
              label={`${shortAssignmentTitle(assignment)} problem ${item.label}`}
              current={myRatings?.[item.problem.id]}
              showExtras={false}
              autoFocus
              onRated={() => setTimeout(advance, 280)}
            />
            <div className="mt-4 flex items-center gap-2 text-xs text-faint">
              <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
                <ArrowLeft /> Back
              </Button>
              <span className="hidden flex-1 text-center sm:block">
                <Kbd>1</Kbd>–<Kbd>9</Kbd>, <Kbd>0</Kbd> = 10 · <Kbd>S</Kbd> skip
              </span>
              <Button size="sm" variant="ghost" className="ml-auto sm:ml-0" onClick={advance}>
                Skip <ArrowRight />
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
