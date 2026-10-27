import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { BarChart3, Check, Download, FileUp, Grid3x3, Link2, Plus, Rows3, Star } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge, EmptyState, Segmented, Skeleton, Tip } from '@/components/ui/misc'
import { Select } from '@/components/ui/input'
import { Dialog, SheetContent } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { Heatmap } from '@/components/heatmap/Heatmap'
import { Legend } from '@/components/heatmap/Legend'
import { buildHeatmap } from '@/components/heatmap/model'
import { exportHeatmapPng } from '@/components/heatmap/exportPng'
import { ProblemPanel } from '@/components/problem/ProblemPanel'
import { useMyRatings, useOverview, useResolvePath, useSavedCourses, useToggleSaved } from '@/hooks/queries'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { isTypingTarget, modalOpen, useMediaQuery, useTitle } from '@/hooks/useMisc'
import { offeringLabel, formatScore, sortOfferings, shortAssignmentTitle } from '@/lib/format'
import { summarizeCourse, rateableProblems } from '@/lib/stats'
import { pushRecent } from '@/lib/recent'
import type { OverviewAssignment, OverviewProblem } from '@/lib/types'
import { HeatmapControls, InCourseSearch, useHeatmapOptions } from './controls'
import { AssignmentPanel } from './AssignmentPanel'
import { QuickRate } from './QuickRate'
import { Analytics } from './Analytics'
import { Compare } from './Compare'
import NotFoundPage from '../NotFoundPage'

type View = 'heatmap' | 'analytics' | 'compare'

export default function CoursePage() {
  const { uni = '', course = '', offering: offeringSlug, assignment: assignmentSlug, problem: problemSlug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { theme } = useTheme()
  const toast = useToast()
  const { user, openSignIn } = useAuth()
  const desktop = useMediaQuery('(min-width: 1024px)')
  const { options, setOptions } = useHeatmapOptions()
  const [quickRate, setQuickRate] = useState(false)

  const path = useResolvePath(uni, course, offeringSlug)
  const r = path.data
  const offering = r?.offering ?? null
  const overviewQ = useOverview(offering?.id)
  const overview = overviewQ.data
  const mine = useMyRatings(offering?.id)

  const view: View = (['analytics', 'compare'] as const).find((v) => v === params.get('view')) ?? 'heatmap'
  const base = r?.course && offering ? `/${r.university.slug}/${r.course.slug}/${offering.slug}` : ''
  const qs = location.search

  // Resolve the selected assignment/problem from the loaded overview (no round trip per click).
  const selAssignment = overview && assignmentSlug ? overview.assignments.find((a) => a.slug === assignmentSlug.toLowerCase()) ?? null : null
  const selProblem = selAssignment && problemSlug ? selAssignment.problems.find((p) => p.slug === problemSlug.toLowerCase()) ?? null : null
  const unresolved = Boolean(overview && ((assignmentSlug && !selAssignment) || (problemSlug && !selProblem)))
  // Old slugs (renames, merged duplicates) resolve through the server.
  const fallback = useResolvePath(unresolved ? uni : undefined, course, offeringSlug, assignmentSlug, problemSlug)

  useEffect(() => {
    if (!unresolved || !fallback.data || fallback.isPlaceholderData || !overview || !base) return
    const a = overview.assignments.find((x) => x.id === fallback.data!.assignment?.id)
    const p = a?.problems.find((x) => x.id === fallback.data!.problem?.id)
    if (a && (!problemSlug || p)) navigate(`${base}/${a.slug}${p ? `/${p.slug}` : ''}${qs}`, { replace: true })
    else {
      toast({ tone: 'info', message: 'That assignment or problem doesn’t exist (anymore) in this semester.' })
      navigate(`${base}${qs}`, { replace: true })
    }
  }, [unresolved, fallback.data, fallback.isPlaceholderData, overview, base, problemSlug, navigate, qs, toast])

  // Canonicalize capitalization / aliases in the URL (never from the previous semester's placeholder data).
  const placeholder = path.isPlaceholderData
  useEffect(() => {
    if (!r?.course || !offering || placeholder) return
    if (r.university.slug !== uni || r.course.slug !== course || offering.slug !== offeringSlug) {
      const rest = location.pathname.split('/').slice(4).join('/')
      navigate(`${base}${rest ? `/${rest}` : ''}${qs}`, { replace: true })
    }
  }, [r, offering, placeholder, uni, course, offeringSlug, base, location.pathname, navigate, qs])

  useTitle(r?.course ? `${r.course.code}${offering ? ` · ${offeringLabel(offering)}` : ''}` : null)

  useEffect(() => {
    if (r?.course && offering)
      pushRecent({ path: base, code: r.course.code, name: r.course.name, term: offeringLabel(offering), university: r.university.short_name ?? r.university.name })
  }, [r, offering, base])

  const openProblem = useCallback((p: OverviewProblem, a: OverviewAssignment) => navigate(`${base}/${a.slug}/${p.slug}${qs}`), [navigate, base, qs])
  const openAssignment = useCallback((a: OverviewAssignment) => navigate(`${base}/${a.slug}${qs}`), [navigate, base, qs])
  const closePanel = useCallback(() => navigate(`${base}${qs}`), [navigate, base, qs])

  // Reading order of every problem in the semester, for j/k.
  const order = useMemo(
    () =>
      overview?.assignments.flatMap((a) =>
        [...a.problems]
          .filter((p) => !p.parent_problem_id)
          .sort((x, y) => x.display_order - y.display_order)
          .flatMap((p) => [p, ...a.problems.filter((c) => c.parent_problem_id === p.id).sort((x, y) => x.display_order - y.display_order)])
          .map((p) => ({ p, a })),
      ) ?? [],
    [overview],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape' && (selProblem || selAssignment) && desktop && !modalOpen()) closePanel()
      if ((e.key === 'j' || e.key === 'k') && selProblem && !modalOpen()) {
        const i = order.findIndex((x) => x.p.id === selProblem.id)
        const next = order[i + (e.key === 'j' ? 1 : -1)]
        if (next) openProblem(next.p, next.a)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selProblem, selAssignment, desktop, closePanel, order, openProblem])

  const summary = useMemo(() => (overview ? summarizeCourse(overview) : null), [overview])
  const maxCount = useMemo(() => (overview ? buildHeatmap(overview, undefined, options).maxCount : 1), [overview, options])
  const hasParts = Boolean(overview?.assignments.some((a) => a.problems.some((p) => p.parent_problem_id)))
  const isDemo = Boolean(overview?.assignments.some((a) => a.is_demo))
  const myCount = useMemo(() => (overview && mine.data ? overview.assignments.flatMap(rateableProblems).filter((p) => mine.data![p.id] && !mine.data![p.id].stale).length : 0), [overview, mine.data])

  // ── loading / not-found states
  if (path.isLoading) return <PageSkeleton />
  if (path.isError) return <div className="mx-auto max-w-[1440px] px-6 py-16 text-sm text-danger">Couldn’t load this course. Check your connection and try again.</div>
  if (!r || !r.course) return <NotFoundPage what="course" hint={r ? `${r.university.name} doesn’t have a course at “${course}” yet.` : undefined} addHref="/contribute" />
  if (!offeringSlug) {
    const latest = sortOfferings(r.offerings)[0]
    if (latest) return <Navigate to={`/${r.university.slug}/${r.course.slug}/${latest.slug}${qs}`} replace />
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <EmptyState title={`No semesters of ${r.course.code} yet`} action={<Button asChild variant="primary"><Link to={`/contribute?university=${r.university.id}&course=${r.course.id}`}><Plus /> Add a semester</Link></Button>}>
          Add the semester you took it, then upload or enter its assignments.
        </EmptyState>
      </div>
    )
  }
  if (!offering) {
    return (
      <NotFoundPage what="semester" hint={`${r.course.code} has no semester called “${offeringSlug}”.`} addHref={`/contribute?university=${r.university.id}&course=${r.course.id}`}>
        {r.offerings.length ? (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {sortOfferings(r.offerings).map((o) => (
              <Button key={o.id} asChild size="sm" variant="outline">
                <Link to={`/${r.university.slug}/${r.course!.slug}/${o.slug}`}>{offeringLabel(o)}</Link>
              </Button>
            ))}
          </div>
        ) : null}
      </NotFoundPage>
    )
  }

  const uploadHref = `/upload?offering=${offering.id}${selAssignment ? `&assignment=${selAssignment.id}` : ''}`
  const panelOpen = Boolean(selAssignment) && view === 'heatmap'
  const rc = r.course
  const crumbs = { university: r.university.short_name ?? r.university.name, course: rc.code, offering: offeringLabel(offering) }
  const panel = selAssignment ? (
    selProblem ? (
      <ProblemPanel
        key={selProblem.id}
        problemId={selProblem.id}
        assignment={selAssignment}
        overview={overview!}
        offeringId={offering.id}
        myRatings={mine.data}
        crumbs={crumbs}
        isDemo={selAssignment.is_demo}
        onClose={closePanel}
        onNavigate={(id) => {
          const p = selAssignment.problems.find((x) => x.id === id)
          if (p) openProblem(p, selAssignment)
        }}
      />
    ) : (
      <AssignmentPanel
        assignment={selAssignment}
        offeringId={offering.id}
        myRatings={mine.data}
        uploadHref={uploadHref}
        onOpenProblem={(p) => openProblem(p, selAssignment)}
        onQuickRate={() => setQuickRate(true)}
        onClose={closePanel}
      />
    )
  ) : null

  const setView = (v: View) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev)
        if (v === 'heatmap') n.delete('view')
        else n.set('view', v)
        return n
      },
      { replace: true },
    )

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 sm:px-6">
      <CourseHeader
        uniSlug={r.university.slug}
        uniName={r.university.short_name ?? r.university.name}
        courseId={rc.id}
        code={rc.code}
        name={rc.name}
        offerings={r.offerings}
        offeringId={offering.id}
        isDemo={isDemo}
        onChangeOffering={(slug) => navigate(`/${r.university.slug}/${rc.slug}/${slug}${qs}`)}
        uploadHref={uploadHref}
        onExport={
          overview?.assignments.length
            ? () => exportHeatmapPng(overview, options, theme, `${rc.code} · ${offeringLabel(offering)}`, `${r.university.name} · hardest`, isDemo)
            : undefined
        }
      />

      {summary && overview?.assignments.length ? (
        <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:gap-8">
          <Kpi label="Assignments" value={String(summary.totalAssignments)} />
          <Kpi label="Problems rated" value={`${summary.ratedProblems}/${summary.totalProblems}`} />
          <Kpi label="Ratings" value={summary.totalRatings.toLocaleString()} />
          <Kpi label="Average difficulty" value={formatScore(summary.pooledMean)} />
          {summary.hardestAssignment ? <Kpi label="Hardest assignment" value={`${shortAssignmentTitle(summary.hardestAssignment.assignment)} · ${formatScore(summary.hardestAssignment.mean)}`} /> : null}
          {user ? <Kpi label="You’ve rated" value={String(myCount)} /> : null}
        </dl>
      ) : null}

      {overviewQ.isLoading ? (
        <Skeleton className="mt-6 h-80" />
      ) : !overview?.assignments.length ? (
        <EmptyState
          className="mt-8"
          icon={<Grid3x3 />}
          title={`No assignments for ${offeringLabel(offering)} yet`}
          action={
            <>
              <Button asChild variant="primary">
                <Link to={`/upload?offering=${offering.id}`}>
                  <FileUp /> Upload the first assignment
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={`/upload?offering=${offering.id}&mode=manual`}>Enter problem numbers only</Link>
              </Button>
            </>
          }
        >
          Took this course? Upload a problem set (PDF, LaTeX, Markdown or text) or just list its problem numbers. Everyone can then rate each problem.
        </EmptyState>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-3 border-b border-border pb-3">
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: 'heatmap', label: <span className="inline-flex items-center gap-1.5"><Grid3x3 className="size-3.5" />Heatmap</span> },
                { value: 'analytics', label: <span className="inline-flex items-center gap-1.5"><BarChart3 className="size-3.5" />Analytics</span> },
                { value: 'compare', label: <span className="inline-flex items-center gap-1.5"><Rows3 className="size-3.5" />Compare semesters</span> },
              ]}
            />
            <InCourseSearch assignments={overview.assignments} onPick={openProblem} className="ml-auto w-full sm:w-72" />
          </div>

          {view === 'heatmap' ? (
            <div className={cn('mt-4 grid gap-6', panelOpen && desktop && 'grid-cols-[minmax(0,1fr)_440px] xl:grid-cols-[minmax(0,1fr)_480px]')}>
              <div className="min-w-0">
                <HeatmapControls options={options} setOptions={setOptions} hasParts={hasParts} />
                <div className="mt-4">
                  <Heatmap
                    overview={overview}
                    myRatings={mine.data}
                    options={options}
                    theme={theme}
                    selectedProblemId={selProblem?.id}
                    selectedAssignmentId={selAssignment?.id}
                    onSelectProblem={openProblem}
                    onSelectAssignment={openAssignment}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <Legend metric={options.metric} theme={theme} maxCount={maxCount} />
                  <p className="max-w-sm text-[11px] text-faint">
                    Click a cell to see the problem and rate it; click an assignment name to rate all of its problems quickly. Arrow keys move between cells.
                    {!user ? (
                      <>
                        {' '}
                        <button className="underline underline-offset-2 hover:text-text" onClick={() => openSignIn()}>
                          Sign in
                        </button>{' '}
                        to see which ones you’ve rated.
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
              {panelOpen && desktop ? (
                <aside className="sticky top-[4.5rem] h-[calc(100dvh-5.5rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.03]" aria-label="Details">
                  {panel}
                </aside>
              ) : null}
            </div>
          ) : view === 'analytics' ? (
            <div className="mt-4">
              <Analytics overview={overview} onOpenProblem={(p, a) => {
                setView('heatmap')
                setTimeout(() => openProblem(p, a))
              }} />
            </div>
          ) : (
            <div className="mt-4">
              <Compare offerings={r.offerings} current={offering} />
            </div>
          )}
        </>
      )}

      {!desktop && panelOpen ? (
        <Dialog open onOpenChange={(v) => !v && closePanel()}>
          <SheetContent title={selProblem ? `Problem ${selProblem.label}` : selAssignment!.title}>{panel}</SheetContent>
        </Dialog>
      ) : null}
      {selAssignment && !selProblem ? <QuickRate assignment={selAssignment} offeringId={offering.id} myRatings={mine.data} open={quickRate} onOpenChange={setQuickRate} /> : null}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2 lg:bg-transparent lg:p-0">
      <dt className="text-[11px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold tracking-tight tabular">{value}</dd>
    </div>
  )
}

function CourseHeader(props: {
  uniSlug: string
  uniName: string
  courseId: string
  code: string
  name: string
  offerings: Array<{ id: string; slug: string; term: import('@/lib/types').Term; year: number; section: string }>
  offeringId: string
  isDemo: boolean
  uploadHref: string
  onChangeOffering: (slug: string) => void
  onExport?: () => void
}) {
  const { user, openSignIn } = useAuth()
  const saved = useSavedCourses()
  const toggle = useToggleSaved()
  const toast = useToast()
  const isSaved = Boolean(saved.data?.some((s) => s.course.id === props.courseId))
  const [copied, setCopied] = useState(false)

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
      <div className="min-w-0 flex-1">
        <nav className="text-xs text-muted" aria-label="Breadcrumb">
          <Link to={`/${props.uniSlug}`} className="hover:text-text">
            {props.uniName}
          </Link>{' '}
          / <span>{props.code}</span>
        </nav>
        <h1 className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
          {props.code}
          <span className="text-base font-normal text-muted sm:text-lg">{props.name}</span>
          {props.isDemo ? <Badge tone="demo" className="self-center">Demo data</Badge> : null}
        </h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          aria-label="Semester"
          value={props.offerings.find((o) => o.id === props.offeringId)?.slug}
          onChange={(e) => props.onChangeOffering(e.target.value)}
          className="h-8 w-auto pr-8 text-sm font-medium"
        >
          {sortOfferings(props.offerings).map((o) => (
            <option key={o.id} value={o.slug}>
              {offeringLabel(o)}
            </option>
          ))}
        </Select>
        <Tip content={isSaved ? 'Remove from My courses' : 'Save to My courses'}>
          <Button
            size="sm"
            variant="outline"
            aria-pressed={isSaved}
            onClick={() => (user ? toggle.mutate({ courseId: props.courseId, saved: !isSaved }) : openSignIn('Sign in to save courses.'))}
          >
            <Star className={cn(isSaved && 'fill-current')} /> {isSaved ? 'Saved' : 'Save'}
          </Button>
        </Tip>
        <Tip content="Copy a link to this view">
          <Button
            size="sm"
            variant="outline"
            aria-label="Copy link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              } catch {
                toast({ tone: 'info', message: window.location.href })
              }
            }}
          >
            {copied ? <Check /> : <Link2 />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Share'}</span>
          </Button>
        </Tip>
        {props.onExport ? (
          <Tip content="Download the heatmap as a PNG">
            <Button size="sm" variant="outline" onClick={props.onExport} aria-label="Export PNG">
              <Download /> <span className="hidden sm:inline">PNG</span>
            </Button>
          </Tip>
        ) : null}
        <Button size="sm" variant="primary" asChild>
          <Link to={props.uploadHref}>
            <FileUp /> Add assignment
          </Link>
        </Button>
      </div>
    </div>
  )
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-6 sm:px-6" aria-busy="true">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-8 w-80" />
      <div className="mt-6 flex gap-6">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-24" />
        ))}
      </div>
      <Skeleton className="mt-8 h-96" />
    </div>
  )
}
