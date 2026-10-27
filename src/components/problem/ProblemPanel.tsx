import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, FileText, Flag, History, Link2, PencilLine, Plus, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge, Skeleton, Tip } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { LazyMarkdown } from '@/components/LazyMarkdown'
import { RatingControl } from './RatingControl'
import { Distribution } from './Distribution'
import { StatementEditor } from './StatementEditor'
import { ReportDialog } from './ReportDialog'
import { useHistory, useProblem } from '@/hooks/queries'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { getApi } from '@/lib/api'
import { COMPLETION_LABELS, shortAssignmentTitle, formatCount, formatMinutes, formatScore, relativeTime } from '@/lib/format'
import { difficultyBand, difficultyColor } from '@/lib/scale'
import { buildUnits, displayLabel, LOW_SAMPLE, standardError } from '@/lib/stats'
import { errorMessage } from '@/lib/errors'
import type { CompletionStatus, MyRating, OfferingOverview, OverviewAssignment, ProblemStats } from '@/lib/types'

interface Props {
  problemId: string
  assignment: OverviewAssignment
  overview: OfferingOverview
  offeringId: string
  myRatings?: Record<string, MyRating>
  crumbs: { university: string; course: string; offering: string }
  isDemo: boolean
  onClose: () => void
  onNavigate: (problemId: string) => void
}

export function ProblemPanel({ problemId, assignment, overview, offeringId, myRatings, crumbs, isDemo, onClose, onNavigate }: Props) {
  const { theme } = useTheme()
  const { user, openSignIn, isModerator } = useAuth()
  const toast = useToast()
  const q = useProblem(problemId)
  const [editor, setEditor] = useState<null | 'add-statement' | 'suggest-edit'>(null)
  const [reporting, setReporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)

  const units = useMemo(() => buildUnits(assignment), [assignment])
  const overviewProblem = assignment.problems.find((p) => p.id === problemId)
  const unit = units.find((u) => u.problem.id === problemId)
  const parts = unit?.parts ?? []
  const parent = overviewProblem?.parent_problem_id ? assignment.problems.find((p) => p.id === overviewProblem.parent_problem_id) : null
  const label = overviewProblem ? displayLabel(overviewProblem, parent?.label) : '…'

  // Previous / next in reading order (units, then their parts).
  const order = units.flatMap((u) => [u.problem.id, ...u.parts.map((p) => p.id)])
  const idx = order.indexOf(problemId)
  const prev = idx > 0 ? order[idx - 1] : null
  const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null

  const d = q.data
  const stats: ProblemStats | null = parts.length ? null : d?.stats ?? overviewProblem?.stats ?? null
  const mine = myRatings?.[problemId]
  const requireUser = (reason: string, then: () => void) => (user ? then() : openSignIn(reason))

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast({ tone: 'success', message: 'Link copied.' })
    } catch {
      toast({ tone: 'info', message: window.location.href })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={`Problem ${label}`}>
      <header className="flex items-center gap-1 border-b border-border px-4 py-2.5">
        <nav className="min-w-0 flex-1 truncate text-xs text-muted" aria-label="Breadcrumb">
          {crumbs.university} / {crumbs.course} / {crumbs.offering} / <span className="text-text">{assignment.title}</span>
        </nav>
        <Tip content="Previous problem (k)">
          <Button variant="ghost" size="icon" disabled={!prev} onClick={() => prev && onNavigate(prev)} aria-label="Previous problem">
            <ArrowLeft />
          </Button>
        </Tip>
        <Tip content="Next problem (j)">
          <Button variant="ghost" size="icon" disabled={!next} onClick={() => next && onNavigate(next)} aria-label="Next problem">
            <ArrowRight />
          </Button>
        </Tip>
        <Tip content="Close (Esc)">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close problem details">
            <X />
          </Button>
        </Tip>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-10 sm:px-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {/^\d/.test(label) ? 'Problem ' : ''}
              {label}
            </h2>
            {overviewProblem?.title ? <p className="mt-0.5 text-sm text-muted">{d?.problem.title ? <InlineTitle text={d.problem.title} /> : overviewProblem.title}</p> : null}
          </div>
          {isDemo ? <Badge tone="demo">Demo data</Badge> : null}
        </div>

        {/* Statement */}
        <section className="mt-4" aria-label="Problem statement">
          {q.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : d?.problem.statement_markdown ? (
            <>
              <LazyMarkdown>{d.problem.statement_markdown}</LazyMarkdown>
              {d.problem.extraction_status === 'needs_review' ? <p className="mt-2 text-xs text-warn">Extracted automatically — may contain errors.</p> : null}
            </>
          ) : (
            <div className="rounded-lg border border-dashed border-border-strong px-4 py-4">
              <p className="text-sm text-muted">Problem statement not available yet.</p>
              <p className="mt-1 text-xs text-faint">You can still rate it. If you have the assignment, add the statement for others.</p>
              <Button size="sm" className="mt-3" onClick={() => requireUser('Sign in to add a problem statement.', () => setEditor('add-statement'))}>
                <Plus /> Add problem statement
              </Button>
            </div>
          )}
          {d?.source_document ? <SourceLink doc={d.source_document} pages={[d.problem.source_page_start, d.problem.source_page_end]} /> : null}
        </section>

        {/* Parts */}
        {parts.length ? (
          <section className="mt-6" aria-label="Parts">
            <h3 className="text-xs font-medium tracking-wide text-muted uppercase">Parts</h3>
            <p className="mt-1 text-xs text-faint">Rate each part separately. The problem’s overall score is the mean of its rated parts.</p>
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
              {parts.map((p) => (
                <li key={p.id} className="px-3 py-2.5">
                  <div className="mb-1.5 flex items-center gap-2 text-sm">
                    <button className="font-medium hover:underline" onClick={() => onNavigate(p.id)}>
                      ({p.label})
                    </button>
                    {p.title ? <span className="truncate text-muted">{p.title}</span> : null}
                    <span className="ml-auto text-xs text-muted tabular">
                      {p.stats ? `${formatScore(p.stats.mean)} · ${formatCount(p.stats.rating_count, 'rating')}` : 'unrated'}
                    </span>
                  </div>
                  <RatingControl compact problemId={p.id} offeringId={offeringId} label={`${shortAssignmentTitle(assignment)} problem ${displayLabel(p, label)}`} current={myRatings?.[p.id]} />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <>
            <section className="mt-6" aria-label="Difficulty statistics">
              <StatsBlock stats={stats} theme={theme} mine={mine && !mine.stale ? mine.difficulty : null} />
            </section>
            <section className="mt-6 rounded-xl border border-border bg-surface-2/40 p-3.5" aria-label="Your rating">
              <RatingControl problemId={problemId} offeringId={offeringId} label={`${shortAssignmentTitle(assignment)} problem ${label}`} current={mine} autoFocus={false} />
            </section>
          </>
        )}

        {unit && parts.length && unit.stats.count ? (
          <section className="mt-6">
            <StatsBlock
              theme={theme}
              stats={{ rating_count: unit.stats.count, mean: unit.stats.mean, median: unit.stats.median, stddev: null, histogram: unit.stats.histogram, time_count: 0, median_time_minutes: unit.stats.timeMinutes, completion: {} }}
              combined={`${unit.stats.ratedParts} of ${unit.stats.totalParts} parts rated`}
            />
          </section>
        ) : null}

        {/* Actions */}
        <section className="mt-6 flex flex-wrap gap-1.5 border-t border-border pt-4">
          {d?.problem.statement_markdown || isModerator ? (
            <Button size="sm" variant="outline" onClick={() => requireUser('Sign in to suggest an edit.', () => setEditor('suggest-edit'))}>
              <PencilLine /> Suggest edit
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => requireUser('Sign in to report a problem.', () => setReporting(true))}>
            <Flag /> Report
          </Button>
          <Button size="sm" variant="ghost" onClick={copyLink}>
            <Link2 /> Copy link
          </Button>
          {d && d.revision_count > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setHistoryOpen((x) => !x)} aria-expanded={historyOpen}>
              <History /> History ({d.revision_count})
              <ChevronDown className={cn('transition-transform', historyOpen && 'rotate-180')} />
            </Button>
          ) : null}
        </section>
        {d?.pending_proposals ? <p className="mt-2 text-xs text-faint">{formatCount(d.pending_proposals, 'suggested edit')} awaiting review.</p> : null}
        {historyOpen ? <HistoryList problemId={problemId} offeringId={offeringId} /> : null}
      </div>

      {editor && d ? (
        <StatementEditor
          open
          onOpenChange={(v) => !v && setEditor(null)}
          problemId={problemId}
          offeringId={offeringId}
          mode={editor}
          initial={{ label: d.problem.label, title: d.problem.title, statement_markdown: d.problem.statement_markdown }}
        />
      ) : null}
      {reporting ? <ReportDialog open onOpenChange={setReporting} problemId={problemId} assignmentId={assignment.id} overview={overview} label={label} /> : null}
    </div>
  )
}

function InlineTitle({ text }: { text: string }) {
  return /\$/.test(text) ? <LazyMarkdown className="inline [&>p]:inline">{text}</LazyMarkdown> : <>{text}</>
}

export function StatsBlock({ stats, theme, mine, combined }: { stats: ProblemStats | null; theme: 'light' | 'dark'; mine?: number | null; combined?: string }) {
  if (!stats || !stats.rating_count) {
    return (
      <div className="rounded-lg border border-dashed border-border-strong px-4 py-5 text-center">
        <p className="text-sm font-medium">No ratings yet</p>
        <p className="mt-0.5 text-xs text-muted">Be the first — it takes one click.</p>
      </div>
    )
  }
  const se = standardError(stats)
  const sw = stats.mean != null ? difficultyColor(stats.mean, theme) : null
  const completionTotal = Object.values(stats.completion ?? {}).reduce((a, b) => a + (b ?? 0), 0)
  return (
    <div>
      <div className="flex items-stretch gap-4">
        <div className="flex size-[72px] shrink-0 flex-col items-center justify-center rounded-xl tabular" style={sw ? { backgroundColor: sw.bg, color: sw.fg } : undefined}>
          <span className="text-2xl leading-none font-semibold">{formatScore(stats.mean)}</span>
          <span className="mt-1 text-[10px] opacity-75">of 10</span>
        </div>
        <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-1.5 text-sm tabular">
          <div>
            <dt className="text-[11px] text-muted">{combined ? 'Combined' : 'Average'}</dt>
            <dd className="font-medium">
              {stats.mean != null ? difficultyBand(stats.mean) : '—'}
              {se != null ? <span className="ml-1 text-xs font-normal text-faint">± {(1.96 * se).toFixed(1)}</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Median</dt>
            <dd className="font-medium">{formatScore(stats.median)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Ratings</dt>
            <dd className={cn('font-medium', stats.rating_count < LOW_SAMPLE && 'text-warn')}>
              {stats.rating_count}
              {stats.rating_count < LOW_SAMPLE ? <span className="ml-1 text-xs font-normal">low sample</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Median time</dt>
            <dd className="font-medium">
              {stats.median_time_minutes != null ? formatMinutes(stats.median_time_minutes) : <span className="font-normal text-faint">no data</span>}
              {stats.time_count ? <span className="ml-1 text-xs font-normal text-faint">n={stats.time_count}</span> : null}
            </dd>
          </div>
        </dl>
      </div>
      {combined ? <p className="mt-2 text-xs text-faint">{combined}. Mean of part averages; median over all part ratings.</p> : null}
      <Distribution className="mt-4" histogram={stats.histogram} theme={theme} mine={mine} />
      {se != null ? <p className="mt-1 text-[11px] text-faint">± is an approximate 95% interval for the average (1.96 × standard error).</p> : null}
      {completionTotal >= 5 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[11px] text-muted">Self-reported outcome ({completionTotal} responses)</p>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2">
            {(['solved_independently', 'solved_with_help', 'attempted_not_solved', 'not_attempted'] as CompletionStatus[]).map((k, i) => (
              <div key={k} style={{ width: `${((stats.completion[k] ?? 0) / completionTotal) * 100}%`, opacity: 1 - i * 0.22 }} className="bg-text" title={`${COMPLETION_LABELS[k]}: ${stats.completion[k] ?? 0}`} />
            ))}
          </div>
          <ul className="mt-1.5 grid grid-cols-2 gap-x-3 text-[11px] text-muted tabular">
            {(['solved_independently', 'solved_with_help', 'attempted_not_solved', 'not_attempted'] as CompletionStatus[]).map((k) => (
              <li key={k} className="truncate">
                {Math.round(((stats.completion[k] ?? 0) / completionTotal) * 100)}% {COMPLETION_LABELS[k].toLowerCase()}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function SourceLink({ doc, pages }: { doc: { filename: string; storage_path: string | null; visibility: string; file_type: string }; pages: [number | null, number | null] }) {
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (!doc.storage_path) return <p className="mt-3 text-xs text-faint">Source: {doc.filename} (file not stored)</p>
  const open = async () => {
    setBusy(true)
    try {
      const url = await getApi().documentUrl(doc.storage_path!)
      if (!url) throw new Error('This file isn’t available to you.')
      window.open(url + (doc.file_type === 'pdf' && pages[0] ? `#page=${pages[0]}` : ''), '_blank', 'noopener')
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button onClick={open} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted hover:text-text">
      <FileText className="size-3.5" />
      Original source: {doc.filename}
      {pages[0] ? ` · p. ${pages[0]}${pages[1] && pages[1] !== pages[0] ? `–${pages[1]}` : ''}` : ''}
      {doc.visibility === 'private' ? <Badge tone="outline">private — visible to you</Badge> : null}
    </button>
  )
}

function HistoryList({ problemId, offeringId }: { problemId: string; offeringId: string }) {
  const q = useHistory(problemId, true)
  const { isModerator } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  if (q.isLoading) return <Skeleton className="mt-3 h-16" />
  return (
    <ol className="mt-3 space-y-2 border-l border-border pl-3">
      {(q.data ?? []).map((r) => (
        <li key={r.id} className="text-xs">
          <div className="flex items-center gap-2">
            <span className="font-medium capitalize">{r.kind === 'create' ? 'Created' : r.kind === 'revert' ? 'Reverted' : r.kind === 'merge' ? 'Merged duplicate' : 'Edited'}</span>
            <span className="text-faint">{relativeTime(r.created_at)}</span>
            {r.is_mine ? <Badge>you</Badge> : null}
            {r.material_change ? <Badge tone="warn">question changed</Badge> : null}
            {isModerator && r.before && r.kind !== 'create' ? (
              <button
                className="ml-auto text-muted underline-offset-2 hover:text-text hover:underline"
                onClick={async () => {
                  try {
                    await getApi().revertRevision(r.id)
                    toast({ tone: 'success', message: 'Reverted.' })
                    qc.invalidateQueries({ queryKey: ['problem', problemId] })
                    qc.invalidateQueries({ queryKey: ['history', problemId] })
                    qc.invalidateQueries({ queryKey: ['overview', offeringId] })
                  } catch (e) {
                    toast({ tone: 'error', message: errorMessage(e) })
                  }
                }}
              >
                Revert to before this
              </button>
            ) : null}
          </div>
          {r.note ? <p className="mt-0.5 text-muted">{r.note}</p> : null}
          {r.before?.statement_markdown !== r.after?.statement_markdown && r.kind !== 'create' ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-faint">Show statement change</summary>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <pre className="max-h-40 overflow-auto rounded border border-border bg-danger/5 p-2 font-mono text-[11px] whitespace-pre-wrap">{r.before?.statement_markdown ?? '(empty)'}</pre>
                <pre className="max-h-40 overflow-auto rounded border border-border bg-ok/5 p-2 font-mono text-[11px] whitespace-pre-wrap">{r.after?.statement_markdown ?? '(empty)'}</pre>
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
