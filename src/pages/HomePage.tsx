import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Clock, FileUp, ListChecks, ShieldCheck, X } from 'lucide-react'
import { getApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge, Skeleton } from '@/components/ui/misc'
import { CourseSearch } from '@/components/layout/CourseSearch'
import { Heatmap } from '@/components/heatmap/Heatmap'
import { Legend } from '@/components/heatmap/Legend'
import { DEFAULT_OPTIONS } from '@/components/heatmap/model'
import { useTheme } from '@/hooks/useTheme'
import { useTitle } from '@/hooks/useMisc'
import { clearRecent, getRecent } from '@/lib/recent'
import { offeringLabel, relativeTime } from '@/lib/format'
import type { FeaturedOffering } from '@/lib/types'

export default function HomePage() {
  useTitle(null)
  const { theme } = useTheme()
  const navigate = useNavigate()
  const [recent, setRecent] = useState(getRecent)
  const featured = useQuery({ queryKey: ['featured'], queryFn: () => getApi().featuredOfferings(6), staleTime: 60_000 })
  const preview = featured.data?.find((f) => f.problem_count > 0) ?? null
  const previewOverview = useQuery({
    queryKey: ['overview', preview?.offering_id],
    queryFn: () => getApi().getOverview(preview!.offering_id),
    enabled: Boolean(preview),
    staleTime: 30_000,
  })
  const href = (f: FeaturedOffering) => `/${f.university_slug}/${f.course_slug}/${f.offering_slug}`

  return (
    <div>
      <section className="border-b border-border">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-4 pt-14 pb-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:pt-20 lg:pb-20">
          <div>
            <h1 className="text-[34px] leading-[1.08] font-semibold tracking-[-0.025em] sm:text-5xl">How hard was that problem?</h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              Students rate individual homework problems from 1 to 10. See which problems — and which weeks — are the real walls, before you hit them.
            </p>
            <CourseSearch size="lg" floating className="mt-7 max-w-lg" />
            <p className="mt-3 text-xs text-faint">
              Starting with Harvard.{' '}
              <Link to="/harvard" className="underline underline-offset-2 hover:text-text">
                Browse all courses
              </Link>
            </p>
            {recent.length ? (
              <div className="mt-6 max-w-lg">
                <div className="mb-1.5 flex items-center gap-2 text-xs text-muted">
                  <Clock className="size-3.5" /> Recently viewed
                  <button
                    className="ml-auto text-faint hover:text-text"
                    onClick={() => {
                      clearRecent()
                      setRecent([])
                    }}
                    aria-label="Clear recently viewed"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recent.slice(0, 5).map((r) => (
                    <Link key={r.path} to={r.path} className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs hover:border-border-strong" title={`${r.name} · viewed ${relativeTime(new Date(r.at).toISOString())}`}>
                      <span className="font-medium">{r.code}</span> <span className="text-muted">{r.term}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="min-w-0">
            {preview && previewOverview.data ? (
              <figure className="rounded-xl border border-border bg-surface p-4 shadow-sm shadow-black/[0.03]">
                <figcaption className="mb-3 flex items-center gap-2">
                  <Link to={href(preview)} className="text-sm font-semibold hover:underline">
                    {preview.course_code} · {offeringLabel(preview)}
                  </Link>
                  {preview.is_demo ? <Badge tone="demo">Demo data</Badge> : null}
                  <Link to={href(preview)} className="ml-auto inline-flex items-center gap-1 text-xs text-muted hover:text-text">
                    Open <ArrowRight className="size-3.5" />
                  </Link>
                </figcaption>
                <div className="max-h-[330px] overflow-hidden">
                  <Heatmap
                    overview={previewOverview.data}
                    options={DEFAULT_OPTIONS}
                    theme={theme}
                    showAverage={false}
                    onSelectProblem={(p, a) => navigate(`${href(preview)}/${a.slug}/${p.slug}`)}
                    onSelectAssignment={(a) => navigate(`${href(preview)}/${a.slug}`)}
                  />
                </div>
                <div className="mt-3 border-t border-border pt-3">
                  <Legend metric="mean" theme={theme} maxCount={1} />
                </div>
              </figure>
            ) : featured.isLoading || previewOverview.isLoading ? (
              <Skeleton className="h-[420px] rounded-xl" />
            ) : null}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6">
        <h2 className="text-sm font-medium text-muted">Courses with ratings</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {featured.isLoading
            ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
            : featured.data?.map((f) => (
                <Link key={f.offering_id} to={href(f)} className="group rounded-xl border border-border bg-surface p-4 transition-colors hover:border-border-strong">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{f.course_code}</span>
                    <span className="text-xs text-muted">{offeringLabel(f)}</span>
                    {f.is_demo ? <Badge tone="demo" className="ml-auto">demo</Badge> : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">{f.course_name}</p>
                  <p className="mt-3 text-xs text-faint tabular">
                    {f.assignment_count} assignments · {f.problem_count} problems · {f.rating_count.toLocaleString()} ratings
                  </p>
                </Link>
              ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 pt-14 sm:px-6">
        <h2 className="text-sm font-medium text-muted">How it works</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Step icon={<ListChecks />} title="Rate what you’ve done">
            One click per problem, 1 (trivial) to 10 (brutal). Optionally add how long it took. You can change your rating any time.
          </Step>
          <Step icon={<FileUp />} title="Add assignments">
            Upload a PDF, LaTeX, Markdown or text file. We split it into problems in your browser; you review every problem before anything is published.
          </Step>
          <Step icon={<ShieldCheck />} title="Private by design">
            Individual ratings are never shown — only aggregates. Uploaded files stay private unless you choose to share them. No leaderboards.
          </Step>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button asChild variant="primary">
            <Link to="/upload">
              <FileUp /> Add an assignment
            </Link>
          </Button>
          <Button asChild variant="ghost">
            <Link to="/about">How ratings are computed</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}

function Step({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-muted [&_svg]:size-4">{icon}</div>
      <h3 className="mt-2.5 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted">{children}</p>
    </div>
  )
}
