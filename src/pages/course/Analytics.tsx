import { useMemo } from 'react'
import { Info } from 'lucide-react'
import { Distribution } from '@/components/problem/Distribution'
import { Tip } from '@/components/ui/misc'
import { useTheme } from '@/hooks/useTheme'
import { difficultyColor } from '@/lib/scale'
import { BAYES_M, displayLabel, LOW_SAMPLE, summarizeCourse, type RankedProblem } from '@/lib/stats'
import { formatMinutes, formatScore, shortAssignmentTitle } from '@/lib/format'
import type { OfferingOverview, OverviewAssignment, OverviewProblem } from '@/lib/types'

function Card({ title, info, children, className }: { title: string; info?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-4 ${className ?? ''}`}>
      <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium">
        {title}
        {info ? (
          <Tip content={<span className="block max-w-xs">{info}</span>}>
            <button className="text-faint hover:text-muted" aria-label={`About: ${title}`}>
              <Info className="size-3.5" />
            </button>
          </Tip>
        ) : null}
      </h3>
      {children}
    </section>
  )
}

export function Analytics({ overview, onOpenProblem }: { overview: OfferingOverview; onOpenProblem: (p: OverviewProblem, a: OverviewAssignment) => void }) {
  const { theme } = useTheme()
  const s = useMemo(() => summarizeCourse(overview), [overview])
  const ordered = useMemo(
    () => [...s.assignments].sort((a, b) => (a.assignment.due_date ?? '').localeCompare(b.assignment.due_date ?? '') || a.assignment.display_order - b.assignment.display_order),
    [s.assignments],
  )
  const maxRatings = Math.max(1, ...ordered.map((a) => a.ratingCount))
  const maxWork = Math.max(1, ...ordered.map((a) => a.workloadMinutes ?? 0))

  if (!s.totalRatings) {
    return <p className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-sm text-muted">Analytics appear once problems in this semester have ratings.</p>
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Hardest problems"
        info={`Ranked by a Bayesian-adjusted average: each problem's mean is shrunk toward the semester-wide average as if it had ${BAYES_M} extra ratings at that average. A problem with one 10/10 vote won't outrank one that 30 people rated 9.`}
      >
        <ol className="space-y-1">
          {s.hardest.slice(0, 10).map((r: RankedProblem, i) => {
            const sw = difficultyColor(r.mean, theme)
            return (
              <li key={r.problem.id}>
                <button onClick={() => onOpenProblem(r.problem, r.assignment)} className="group flex w-full items-center gap-3 rounded-md px-1.5 py-1 text-left hover:bg-surface-2">
                  <span className="w-4 text-right text-xs text-faint tabular">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{shortAssignmentTitle(r.assignment)}</span>
                    <span className="text-muted"> · {displayLabel(r.problem, r.parentLabel)}</span>
                    {r.problem.title ? <span className="text-faint"> {r.problem.title}</span> : null}
                  </span>
                  <span className="text-[11px] text-faint tabular">
                    n={r.count}
                    {r.count < LOW_SAMPLE ? ' · low' : ''}
                  </span>
                  <span className="inline-flex h-6 w-10 items-center justify-center rounded text-xs font-semibold tabular" style={{ backgroundColor: sw.bg, color: sw.fg }}>
                    {formatScore(r.mean)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </Card>

      <Card title="Difficulty by assignment" info="Each bar is the assignment average (mean of its problems' averages; unrated problems excluded). Hatched bars rest on fewer than 3 ratings per problem on average.">
        <div className="flex h-44 items-end gap-1.5" role="img" aria-label={`Assignment averages: ${ordered.map((a) => `${shortAssignmentTitle(a.assignment)} ${formatScore(a.mean)}`).join(', ')}`}>
          {ordered.map((a) => {
            const sw = a.mean != null ? difficultyColor(a.mean, theme) : null
            const thin = a.ratedUnits > 0 && a.ratingCount / a.ratedUnits < LOW_SAMPLE
            return (
              <div key={a.assignment.id} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${a.assignment.title}: ${formatScore(a.mean)} (${a.ratingCount} ratings)`}>
                <span className="text-[10px] font-medium tabular">{a.mean != null ? formatScore(a.mean) : ''}</span>
                <div
                  className={`relative w-full max-w-10 rounded-t ${thin ? 'hatch' : ''}`}
                  style={{ height: a.mean != null ? `${(a.mean / 10) * 100}%` : 3, backgroundColor: sw?.bg ?? 'var(--border)' }}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-1.5 flex gap-1.5 border-t border-border pt-1.5">
          {ordered.map((a) => (
            <span key={a.assignment.id} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted">
              {shortAssignmentTitle(a.assignment)}
            </span>
          ))}
        </div>
      </Card>

      <Card title="All ratings this semester" info="Histogram of every individual rating across all problems. Each student contributes at most one rating per problem.">
        <Distribution histogram={s.histogram} theme={theme} height={96} />
        <p className="mt-2 text-xs text-muted tabular">
          {s.totalRatings.toLocaleString()} ratings · overall mean {formatScore(s.pooledMean)} · {s.ratedProblems} of {s.totalProblems} problems rated
        </p>
      </Card>

      <Card title="Workload and participation" info="Workload sums the median time reported for each problem; shown only when at least half the problems have time data. Ratings counts show how much data backs each assignment.">
        <table className="w-full text-xs tabular">
          <thead>
            <tr className="text-left text-[11px] text-muted">
              <th className="pb-1.5 font-normal">Assignment</th>
              <th className="pb-1.5 font-normal">Ratings</th>
              <th className="pb-1.5 font-normal">Median time</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((a) => (
              <tr key={a.assignment.id} className="border-t border-border">
                <td className="py-1.5 pr-2 font-medium whitespace-nowrap">{shortAssignmentTitle(a.assignment)}</td>
                <td className="w-2/5 py-1.5 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-muted/60" style={{ width: `${(a.ratingCount / maxRatings) * 100}%` }} />
                    </div>
                    <span className="w-7 text-right">{a.ratingCount}</span>
                  </div>
                </td>
                <td className="w-2/5 py-1.5">
                  {a.workloadMinutes != null ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-surface-2">
                        <div className="h-full rounded-full bg-muted/60" style={{ width: `${(a.workloadMinutes / maxWork) * 100}%` }} />
                      </div>
                      <span className="w-12 text-right">{formatMinutes(a.workloadMinutes)}</span>
                    </div>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
