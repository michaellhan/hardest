import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, EyeOff, GitMerge, Inbox, RotateCcw, ShieldCheck, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Badge, EmptyState, Segmented, Skeleton } from '@/components/ui/misc'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { LazyMarkdown } from '@/components/LazyMarkdown'
import { useAuth } from '@/hooks/useAuth'
import { getApi } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatCount, relativeTime } from '@/lib/format'
import type { ContentStatus, ModerationQueue, ProblemContext, ReportKind } from '@/lib/types'

type Tab = 'proposals' | 'reports' | 'content'
type Proposal = ModerationQueue['proposals'][number]
type Report = ModerationQueue['reports'][number]

const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  incorrect_statement: 'Incorrect statement',
  duplicate: 'Duplicate',
  incorrect_parsing: 'Parsing error',
  content_concern: 'Content concern',
  other: 'Other',
}

export default function ModerationPage() {
  const { user, ready, openSignIn } = useAuth()
  const isDemo = Boolean(getApi().demo)
  // Same key/fn as AuthProvider's profile query, read directly so we can tell "loading" from "not a moderator".
  const profileQ = useQuery({
    queryKey: ['me', 'profile', user?.id],
    queryFn: () => getApi().getProfile(),
    enabled: Boolean(user),
    staleTime: 60_000,
  })
  const isModerator = profileQ.data?.role === 'moderator' || profileQ.data?.role === 'admin'

  if (!ready || (user && profileQ.isLoading)) {
    return (
      <Page>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-6 h-8 w-72" />
        <Skeleton className="mt-4 h-48 w-full" />
      </Page>
    )
  }

  if (!user) {
    return (
      <Page>
        <EmptyState
          icon={<ShieldCheck />}
          title="Moderation"
          action={
            <Button variant="primary" onClick={() => openSignIn('Sign in to review the moderation queue.')}>
              Sign in
            </Button>
          }
        >
          Sign in with a moderator account to review suggested edits, reports, and new content.
        </EmptyState>
      </Page>
    )
  }

  if (!isModerator) {
    return (
      <Page>
        <EmptyState
          icon={<ShieldCheck />}
          title="Moderators only"
          action={
            isDemo ? (
              <Button asChild variant="outline">
                <Link to="/me">Open demo controls</Link>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link to="/">Back to courses</Link>
              </Button>
            )
          }
        >
          {isDemo
            ? 'This is the demo sandbox — switch your role to Moderator under “Demo controls” on your account page to try the moderation tools.'
            : 'This page is for volunteer moderators who review suggested edits, reports, and new content. Thanks for contributing — if something needs attention, use “Report” on the problem.'}
        </EmptyState>
      </Page>
    )
  }

  return <Queue />
}

function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">{children}</div>
}

/** Runs a moderation action with toasts and refreshes everything a moderation change can affect. */
function useModAction() {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key)
    try {
      const msg = await fn()
      if (msg) toast({ tone: 'success', message: msg })
      await qc.invalidateQueries({ queryKey: ['moderation'] })
      for (const k of ['overview', 'problem', 'history', 'path', 'universities', 'courses']) qc.invalidateQueries({ queryKey: [k] })
      return true
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

function Queue() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: Tab = raw === 'reports' || raw === 'content' ? raw : 'proposals'
  const setTab = (t: Tab) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p)
        if (t === 'proposals') n.delete('tab')
        else n.set('tab', t)
        return n
      },
      { replace: true },
    )

  const q = useQuery({ queryKey: ['moderation'], queryFn: () => getApi().moderationQueue(), staleTime: 15_000 })
  const d = q.data
  const pendingContent = d ? d.universities.length : 0

  return (
    <Page>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Moderation</h1>
        {q.isFetching && d ? <span className="text-xs text-faint">Refreshing…</span> : null}
      </div>
      <p className="mt-1 text-sm text-muted">Every action is recorded. Edits can be reverted from a problem’s history.</p>

      <Segmented
        className="mt-5 max-w-full overflow-x-auto"
        label="Moderation queue"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'proposals', label: <TabLabel text="Edit proposals" count={d?.proposals.length} /> },
          { value: 'reports', label: <TabLabel text="Reports" count={d?.reports.length} /> },
          { value: 'content', label: <TabLabel text="New content" count={d ? pendingContent : undefined} /> },
        ]}
      />

      <div className="mt-5">
        {q.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : q.isError || !d ? (
          <EmptyState
            title="Couldn’t load the queue"
            action={
              <Button size="sm" onClick={() => q.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(q.error)}
          </EmptyState>
        ) : tab === 'proposals' ? (
          <Proposals items={d.proposals} />
        ) : tab === 'reports' ? (
          <Reports items={d.reports} />
        ) : (
          <NewContent queue={d} />
        )}
      </div>
    </Page>
  )
}

function TabLabel({ text, count }: { text: string; count?: number }) {
  return (
    <>
      {text}
      {count ? <span className="ml-1.5 rounded bg-surface-3 px-1 text-[10px] tabular text-text">{count}</span> : null}
    </>
  )
}

// ─── shared bits ────────────────────────────────────────────────────────────

function problemHref(c: ProblemContext) {
  const base = `/${c.university_slug}/${c.course_slug}/${c.offering_slug}`
  return c.problem_slug ? `${base}/${c.assignment_slug}/${c.problem_slug}` : base
}

function problemName(c: ProblemContext) {
  if (!c.problem_label) return null
  const l = c.parent_label ? `${c.parent_label}(${c.problem_label})` : c.problem_label
  return /^\d/.test(l) ? `Problem ${l}` : l
}

function ContextLink({ c, className }: { c: ProblemContext; className?: string }) {
  const name = problemName(c)
  return (
    <Link to={problemHref(c)} className={cn('group inline-flex min-w-0 max-w-full items-baseline gap-1.5 text-sm', className)}>
      <span className="shrink-0 font-medium">{c.course_code}</span>
      <span className="truncate text-muted group-hover:text-text group-hover:underline">
        {c.assignment_title}
        {name ? ` · ${name}` : ''}
      </span>
    </Link>
  )
}

function Item({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('rounded-xl border border-border bg-surface p-4', className)}>{children}</li>
}

function Empty({ text }: { text: string }) {
  return (
    <EmptyState icon={<Inbox />} title="All clear">
      {text}
    </EmptyState>
  )
}

function StatusBadge({ status }: { status?: ContentStatus }) {
  if (!status || status === 'active') return null
  return <Badge tone={status === 'hidden' ? 'danger' : 'warn'}>{status === 'hidden' ? 'Hidden' : 'Pending'}</Badge>
}

// ─── proposals ──────────────────────────────────────────────────────────────

function Proposals({ items }: { items: Proposal[] }) {
  if (!items.length) return <Empty text="No suggested edits are waiting for review." />
  return (
    <ul className="space-y-3">
      {items.map((p) => (
        <ProposalCard key={p.id} p={p} />
      ))}
    </ul>
  )
}

function ProposalCard({ p }: { p: Proposal }) {
  const { busy, run } = useModAction()
  const [note, setNote] = useState('')
  const [material, setMaterial] = useState(p.material_change)
  const fields = (['label', 'title', 'statement_markdown'] as const).filter((k) => k in p.changes)

  const review = (approve: boolean) =>
    run(approve ? 'approve' : 'reject', async () => {
      await getApi().reviewProposal(p.id, approve, note.trim() || null, approve ? material : null)
      return approve ? (material ? 'Edit approved. Ratings were set aside for re-rating.' : 'Edit approved.') : 'Edit rejected.'
    })

  return (
    <Item>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ContextLink c={p.context} className="flex-1" />
        {p.material_change ? <Badge tone="warn">Marked as material change</Badge> : null}
        <time className="text-xs text-faint" dateTime={p.created_at}>
          {relativeTime(p.created_at)}
        </time>
      </div>
      {p.context.rating_count ? <p className="mt-0.5 text-xs text-faint">{formatCount(p.context.rating_count, 'rating')} on this problem</p> : null}

      <div className="mt-3 space-y-3">
        {fields.map((k) => (
          <Diff key={k} field={k} before={p.current[k]} after={p.changes[k] ?? null} />
        ))}
        {!fields.length ? <p className="text-sm text-faint">This proposal has no changes.</p> : null}
      </div>

      {p.note ? (
        <blockquote className="mt-3 border-l-2 border-border-strong pl-3 text-sm text-muted">
          <span className="sr-only">Contributor’s note: </span>
          {p.note}
        </blockquote>
      ) : null}

      <div className="mt-4 space-y-3 border-t border-border pt-3">
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5" checked={material} onChange={(e) => setMaterial(e.target.checked)} />
          <span>
            <span className="font-medium text-text">Material change</span> — the question itself changed, so existing ratings are set aside and students are
            asked to re-rate. Leave unchecked for typos and formatting.
            {material !== p.material_change ? <span className="ml-1 text-warn">(overrides the contributor)</span> : null}
          </span>
        </label>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`note-${p.id}`}>Note to contributor (optional)</Label>
            <Input id={`note-${p.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Thanks — fixed the exponent" />
          </div>
          <div className="flex gap-2">
            <Button size="md" variant="outline" disabled={busy !== null} onClick={() => review(false)}>
              <X /> {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </Button>
            <Button size="md" variant="primary" disabled={busy !== null} onClick={() => review(true)}>
              <Check /> {busy === 'approve' ? 'Approving…' : 'Approve'}
            </Button>
          </div>
        </div>
      </div>
    </Item>
  )
}

const FIELD_LABELS = { label: 'Label', title: 'Title', statement_markdown: 'Statement' } as const

function Diff({ field, before, after }: { field: keyof typeof FIELD_LABELS; before: string | null; after: string | null }) {
  const isStatement = field === 'statement_markdown'
  const render = (v: string | null) =>
    !v ? <span className="text-sm text-faint italic">(empty)</span> : isStatement ? <LazyMarkdown>{v}</LazyMarkdown> : <span className="text-sm">{v}</span>
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted uppercase">{FIELD_LABELS[field]}</p>
      <div className="grid gap-2 md:grid-cols-2">
        <div className={cn('min-w-0 rounded-md border border-border bg-bg p-2.5', isStatement && 'max-h-80 overflow-y-auto')}>
          <p className="mb-1 text-[11px] text-faint">Current</p>
          {render(before)}
        </div>
        <div className={cn('min-w-0 rounded-md border border-border-strong bg-surface p-2.5', isStatement && 'max-h-80 overflow-y-auto')}>
          <p className="mb-1 text-[11px] text-faint">Proposed</p>
          {render(after)}
        </div>
      </div>
    </div>
  )
}

// ─── reports ────────────────────────────────────────────────────────────────

function Reports({ items }: { items: Report[] }) {
  if (!items.length) return <Empty text="No open reports." />
  return (
    <ul className="space-y-3">
      {items.map((r) => (
        <ReportCard key={r.id} r={r} />
      ))}
    </ul>
  )
}

function ReportCard({ r }: { r: Report }) {
  const { busy, run } = useModAction()
  const [note, setNote] = useState('')
  const [merging, setMerging] = useState(false)

  const problemMerge = r.kind === 'duplicate' && r.problem_id && r.duplicate_of_problem_id ? { s: r.problem_id, t: r.duplicate_of_problem_id } : null
  const assignmentMerge =
    !problemMerge && r.kind === 'duplicate' && r.assignment_id && r.duplicate_of_assignment_id && !r.duplicate_of_problem_id
      ? { s: r.assignment_id, t: r.duplicate_of_assignment_id }
      : null

  const resolve = (status: 'resolved' | 'dismissed') =>
    run(status, async () => {
      await getApi().resolveReport(r.id, status, note.trim() || null)
      return status === 'resolved' ? 'Report resolved.' : 'Report dismissed.'
    })

  const merge = async () => {
    const ok = await run('merge', async () => {
      const api = getApi()
      let msg: string
      if (problemMerge) {
        const res = await api.mergeProblems(problemMerge.s, problemMerge.t)
        msg = `Merged. ${formatCount(res.moved_ratings, 'rating')} moved${res.conflicts ? `, ${formatCount(res.conflicts, 'conflict')} resolved in favor of the newer rating` : ''}.`
      } else if (assignmentMerge) {
        const res = await api.mergeAssignments(assignmentMerge.s, assignmentMerge.t)
        msg = `Merged. ${formatCount(res.merged_problems, 'problem')} combined, ${formatCount(res.moved_problems, 'problem')} moved.`
      } else return
      await api.resolveReport(r.id, 'resolved', note.trim() || 'Merged into the reported original.')
      return msg
    })
    if (ok) setMerging(false)
  }

  return (
    <Item>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tone={r.kind === 'content_concern' ? 'danger' : 'neutral'}>{REPORT_KIND_LABELS[r.kind]}</Badge>
        {r.context ? <ContextLink c={r.context} className="flex-1" /> : <span className="flex-1 text-sm text-faint">The reported item no longer exists.</span>}
        <time className="text-xs text-faint" dateTime={r.created_at}>
          {relativeTime(r.created_at)}
        </time>
      </div>

      {r.details ? <p className="mt-2.5 text-sm whitespace-pre-wrap">{r.details}</p> : <p className="mt-2.5 text-sm text-faint">No details given.</p>}

      {r.kind === 'duplicate' ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
          <span>Duplicate of</span>
          {r.duplicate_context ? <ContextLink c={r.duplicate_context} /> : <span className="text-faint">(no target given)</span>}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor={`rnote-${r.id}`}>Resolution note (optional)</Label>
          <Input id={`rnote-${r.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="e.g. Statement corrected" />
        </div>
        <div className="flex flex-wrap gap-2">
          {problemMerge || assignmentMerge ? (
            <Button variant="outline" disabled={busy !== null} onClick={() => setMerging(true)}>
              <GitMerge /> {problemMerge ? 'Merge into target' : 'Merge assignments'}
            </Button>
          ) : null}
          <Button variant="ghost" disabled={busy !== null} onClick={() => resolve('dismissed')}>
            {busy === 'dismissed' ? 'Dismissing…' : 'Dismiss'}
          </Button>
          <Button variant="primary" disabled={busy !== null} onClick={() => resolve('resolved')}>
            <Check /> {busy === 'resolved' ? 'Resolving…' : 'Resolve'}
          </Button>
        </div>
      </div>

      {problemMerge || assignmentMerge ? (
        <Dialog open={merging} onOpenChange={(v) => busy !== 'merge' && setMerging(v)}>
          <DialogContent title={problemMerge ? 'Merge duplicate problem?' : 'Merge duplicate assignment?'}>
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5 rounded-md border border-border p-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="w-12 shrink-0 text-xs text-faint">From</span>
                  {r.context ? <ContextLink c={r.context} /> : <span className="text-faint">Unknown</span>}
                </div>
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="w-12 shrink-0 text-xs text-faint">Into</span>
                  {r.duplicate_context ? <ContextLink c={r.duplicate_context} /> : <span className="text-faint">Unknown</span>}
                </div>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {problemMerge ? (
                  <>
                    <li>All ratings move to the target; none are lost.</li>
                    <li>Students who rated both keep only their newer rating.</li>
                    <li>Parts with matching labels are merged; the rest move under the target.</li>
                    <li>The duplicate is hidden. If the target has no statement, it takes the duplicate’s.</li>
                  </>
                ) : (
                  <>
                    <li>Problems with matching labels are merged, and their ratings are preserved.</li>
                    <li>Students who rated both copies keep only their newer rating.</li>
                    <li>Problems with no match move into the target assignment.</li>
                    <li>The duplicate assignment is hidden.</li>
                  </>
                )}
                <li>The report is marked resolved.</li>
              </ul>
              <p className="text-xs text-faint">Merges can’t be undone from the app.</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" disabled={busy === 'merge'} onClick={() => setMerging(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={busy === 'merge'} onClick={merge}>
                <GitMerge /> {busy === 'merge' ? 'Merging…' : 'Merge'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </Item>
  )
}

// ─── new content ────────────────────────────────────────────────────────────

const PAGE = 15

function NewContent({ queue }: { queue: ModerationQueue }) {
  const { busy, run } = useModAction()
  const [allCourses, setAllCourses] = useState(false)
  const [allAssignments, setAllAssignments] = useState(false)

  const setStatus = (type: 'universities' | 'courses' | 'assignments', id: string, status: 'active' | 'hidden', what: string) =>
    run(`${type}:${id}`, async () => {
      await getApi().setContentStatus(type, id, status)
      return status === 'active' ? `${what} is now visible.` : `${what} is now hidden.`
    })

  const courses = allCourses ? queue.recent_courses : queue.recent_courses.slice(0, PAGE)
  const assignments = allAssignments ? queue.recent_assignments : queue.recent_assignments.slice(0, PAGE)

  return (
    <div className="space-y-6">
      <Section title="Universities awaiting review" description="New universities stay hidden from the public until approved.">
        {!queue.universities.length ? (
          <p className="px-4 py-3 text-sm text-faint">No universities are waiting.</p>
        ) : (
          queue.universities.map((u) => (
            <Row key={u.id}>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {u.name}
                  {u.short_name ? <span className="font-normal text-muted"> · {u.short_name}</span> : null}
                </p>
                <p className="truncate text-xs text-faint">
                  /{u.slug}
                  {u.domain ? ` · ${u.domain}` : ''}
                </p>
              </div>
              <StatusBadge status={u.status} />
              <div className="flex shrink-0 gap-1.5">
                <Button size="xs" variant="ghost" disabled={busy !== null} onClick={() => setStatus('universities', u.id, 'hidden', u.name)}>
                  <EyeOff /> Hide
                </Button>
                <Button size="xs" variant="primary" disabled={busy !== null} onClick={() => setStatus('universities', u.id, 'active', u.name)}>
                  <Check /> Approve
                </Button>
              </div>
            </Row>
          ))
        )}
      </Section>

      <Section title="Recently added courses">
        {!courses.length ? (
          <p className="px-4 py-3 text-sm text-faint">No new courses.</p>
        ) : (
          courses.map((c) => (
            <Row key={c.id}>
              <div className="min-w-0 flex-1">
                <Link to={`/${c.university_slug}/${c.slug}`} className="block truncate text-sm hover:underline">
                  <span className="font-medium">{c.code}</span> <span className="text-muted">{c.name}</span>
                </Link>
                <p className="truncate text-xs text-faint">
                  /{c.university_slug} · {relativeTime(c.created_at)}
                </p>
              </div>
              <StatusBadge status={c.status} />
              <HideRestore
                hidden={c.status === 'hidden'}
                disabled={busy !== null}
                label={c.code}
                onChange={(s) => setStatus('courses', c.id, s, c.code)}
              />
            </Row>
          ))
        )}
        {!allCourses && queue.recent_courses.length > PAGE ? <ShowAll count={queue.recent_courses.length} onClick={() => setAllCourses(true)} /> : null}
      </Section>

      <Section title="Recently added assignments">
        {!assignments.length ? (
          <p className="px-4 py-3 text-sm text-faint">No new assignments.</p>
        ) : (
          assignments.map((a) => (
            <Row key={a.assignment_id}>
              <div className="min-w-0 flex-1">
                <ContextLink c={a} />
                <p className="truncate text-xs text-faint">
                  {a.offering_slug}
                  {a.problem_count != null ? ` · ${formatCount(a.problem_count, 'problem')}` : ''}
                  {a.created_at ? ` · ${relativeTime(a.created_at)}` : ''}
                </p>
              </div>
              <StatusBadge status={a.status} />
              <HideRestore
                hidden={a.status === 'hidden'}
                disabled={busy !== null}
                label={a.assignment_title}
                onChange={(s) => setStatus('assignments', a.assignment_id, s, a.assignment_title)}
              />
            </Row>
          ))
        )}
        {!allAssignments && queue.recent_assignments.length > PAGE ? <ShowAll count={queue.recent_assignments.length} onClick={() => setAllAssignments(true)} /> : null}
      </Section>
    </div>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
      {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      <div className="mt-2 divide-y divide-border rounded-xl border border-border bg-surface">{children}</div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:flex-nowrap">{children}</div>
}

function HideRestore({ hidden, disabled, label, onChange }: { hidden: boolean; disabled: boolean; label: string; onChange: (s: 'active' | 'hidden') => void }) {
  return hidden ? (
    <Button size="xs" variant="outline" disabled={disabled} onClick={() => onChange('active')} aria-label={`Restore ${label}`}>
      <RotateCcw /> Restore
    </Button>
  ) : (
    <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onChange('hidden')} aria-label={`Hide ${label}`}>
      <EyeOff /> Hide
    </Button>
  )
}

function ShowAll({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <div className="px-4 py-2">
      <Button size="xs" variant="ghost" onClick={onClick}>
        Show all {count} <ArrowRight />
      </Button>
    </div>
  )
}
