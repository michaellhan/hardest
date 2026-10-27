import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Plus, Timer, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, Tip } from '@/components/ui/misc'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { RatingControl } from '@/components/problem/RatingControl'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { getApi } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { ASSIGNMENT_TYPE_LABELS, shortAssignmentTitle, formatCount, formatDate, formatMinutes, formatScore } from '@/lib/format'
import { difficultyColor } from '@/lib/scale'
import { displayLabel, rateableProblems, summarizeAssignment } from '@/lib/stats'
import type { MyRating, OverviewAssignment, OverviewProblem } from '@/lib/types'
import { nextLabel } from '@/lib/parser'

interface Props {
  assignment: OverviewAssignment
  offeringId: string
  myRatings?: Record<string, MyRating>
  uploadHref: string
  onOpenProblem: (p: OverviewProblem) => void
  onQuickRate: () => void
  onClose: () => void
}

/** Assignment summary plus an inline list for rating every problem without opening each one. */
export function AssignmentPanel({ assignment, offeringId, myRatings, uploadHref, onOpenProblem, onQuickRate, onClose }: Props) {
  const { theme } = useTheme()
  const { user, openSignIn } = useAuth()
  const summary = useMemo(() => summarizeAssignment(assignment), [assignment])
  const rateable = useMemo(() => rateableProblems(assignment), [assignment])
  const mineCount = rateable.filter((p) => myRatings?.[p.id] && !myRatings[p.id].stale).length
  const missingStatements = assignment.problems.filter((p) => !p.has_statement && !p.parent_problem_id).length
  const sw = summary.mean != null ? difficultyColor(summary.mean, theme) : null

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={assignment.title}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-xs text-muted">{ASSIGNMENT_TYPE_LABELS[assignment.assignment_type]}</span>
        {assignment.is_demo ? <Badge tone="demo">Demo data</Badge> : null}
        <Tip content="Close (Esc)">
          <Button variant="ghost" size="icon" className="ml-auto" onClick={onClose} aria-label="Close assignment">
            <X />
          </Button>
        </Tip>
      </header>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 sm:px-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">{assignment.title}</h2>
            <p className="mt-0.5 text-sm text-muted">
              {formatCount(summary.totalUnits, 'problem')}
              {assignment.due_date ? ` · due ${formatDate(assignment.due_date)}` : ''}
            </p>
          </div>
          <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-xl tabular" style={sw ? { backgroundColor: sw.bg, color: sw.fg } : { border: '1px dashed var(--border-strong)' }}>
            <span className="text-lg leading-none font-semibold">{formatScore(summary.mean)}</span>
            <span className="mt-0.5 text-[9px] opacity-75">avg</span>
          </div>
        </div>
        {assignment.description ? <p className="mt-3 text-sm text-muted">{assignment.description}</p> : null}

        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm tabular">
          <div className="rounded-lg bg-surface-2/60 px-3 py-2">
            <dt className="text-[11px] text-muted">Rated problems</dt>
            <dd className="font-medium">
              {summary.ratedUnits}/{summary.totalUnits}
            </dd>
          </div>
          <div className="rounded-lg bg-surface-2/60 px-3 py-2">
            <dt className="text-[11px] text-muted">Ratings</dt>
            <dd className="font-medium">{summary.ratingCount}</dd>
          </div>
          <div className="rounded-lg bg-surface-2/60 px-3 py-2">
            <dt className="flex items-center gap-1 text-[11px] text-muted">
              <Timer className="size-3" /> Workload
            </dt>
            <dd className="font-medium">
              {summary.workloadMinutes != null ? formatMinutes(summary.workloadMinutes) : <span className="font-normal text-faint">not enough data</span>}
            </dd>
          </div>
        </dl>
        <p className="mt-1.5 text-[11px] text-faint">
          Assignment average = mean of each problem’s average (unrated problems excluded). Workload sums median times when at least half the problems report time.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={() => (user ? onQuickRate() : openSignIn('Sign in to rate this assignment. Ratings are private; only averages are shown.'))} disabled={!rateable.length}>
            <Zap /> Quick rate {rateable.length ? `(${mineCount}/${rateable.length} done)` : ''}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to={uploadHref}>
              <FileUp /> {missingStatements ? 'Add statements from a file' : 'Upload a file'}
            </Link>
          </Button>
        </div>

        <section className="mt-6" aria-label="Problems">
          <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Problems</h3>
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {summary.units.map((u) => {
              const items = u.parts.length ? u.parts : [u.problem]
              return items.map((p, i) => {
                const label = displayLabel(p, u.parts.length ? u.problem.label : null)
                const s = p.stats
                const psw = s?.mean != null ? difficultyColor(s.mean, theme) : null
                return (
                  <li key={p.id} className={i > 0 ? 'border-t-0' : undefined}>
                    <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 text-sm">
                      <button className="font-medium hover:underline" onClick={() => onOpenProblem(p)}>
                        {label}
                      </button>
                      {p.title ? <span className="truncate text-xs text-muted">{p.title}</span> : null}
                      {!p.has_statement && !(u.parts.length && u.problem.has_statement) ? <span className="text-[11px] text-faint">no statement</span> : null}
                      <span
                        className="ml-auto inline-flex h-5 min-w-8 items-center justify-center rounded px-1 text-[11px] font-medium tabular"
                        style={psw ? { backgroundColor: psw.bg, color: psw.fg } : { border: '1px dashed var(--border-strong)', color: 'var(--faint)' }}
                        title={s ? `${formatScore(s.mean)} from ${formatCount(s.rating_count, 'rating')}` : 'No ratings yet'}
                      >
                        {s ? formatScore(s.mean) : '—'}
                      </span>
                    </div>
                    <RatingControl compact className="px-3 pb-2.5" problemId={p.id} offeringId={offeringId} label={`${shortAssignmentTitle(assignment)} problem ${label}`} current={myRatings?.[p.id]} />
                  </li>
                )
              })
            })}
          </ul>
          <AddProblem assignment={assignment} offeringId={offeringId} />
        </section>
      </div>
    </div>
  )
}

function AddProblem({ assignment, offeringId }: { assignment: OverviewAssignment; offeringId: string }) {
  const { user, openSignIn } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const tops = assignment.problems.filter((p) => !p.parent_problem_id).sort((a, b) => a.display_order - b.display_order)
  const suggested = tops.length ? nextLabel(tops[tops.length - 1].label) : '1'
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(suggested)
  const [busy, setBusy] = useState(false)

  if (!open)
    return (
      <button
        className="mt-2 inline-flex items-center gap-1 text-xs text-muted hover:text-text"
        onClick={() => {
          if (!user) return openSignIn('Sign in to add a missing problem.')
          setLabel(suggested)
          setOpen(true)
        }}
      >
        <Plus className="size-3.5" /> Add a missing problem
      </button>
    )
  return (
    <form
      className="mt-2 flex items-center gap-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!label.trim()) return
        setBusy(true)
        try {
          await getApi().addProblem({ assignmentId: assignment.id, label: label.trim() })
          toast({ tone: 'success', message: `Added problem ${label.trim()}.` })
          qc.invalidateQueries({ queryKey: ['overview', offeringId] })
          setOpen(false)
        } catch (err) {
          toast({ tone: 'error', message: errorMessage(err) })
        } finally {
          setBusy(false)
        }
      }}
    >
      <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 w-28 text-xs" aria-label="New problem label" maxLength={60} autoFocus />
      <Button size="sm" type="submit" variant="primary" disabled={busy}>
        Add
      </Button>
      <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  )
}
