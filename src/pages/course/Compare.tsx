import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getApi } from '@/lib/api'
import { Select, Label } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { useTheme } from '@/hooks/useTheme'
import { difficultyColor } from '@/lib/scale'
import { summarizeCourse, type AssignmentSummary } from '@/lib/stats'
import { formatScore, offeringLabel, shortAssignmentTitle, sortOfferings } from '@/lib/format'
import type { Offering } from '@/lib/types'

function Score({ v, n }: { v: number | null | undefined; n?: number }) {
  const { theme } = useTheme()
  if (v == null) return <span className="inline-flex h-6 w-11 items-center justify-center rounded border border-dashed border-border-strong text-[11px] text-faint">—</span>
  const sw = difficultyColor(v, theme)
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex h-6 w-11 items-center justify-center rounded text-xs font-semibold tabular" style={{ backgroundColor: sw.bg, color: sw.fg }}>
        {formatScore(v)}
      </span>
      {n != null ? <span className="text-[11px] text-faint tabular">n={n}</span> : null}
    </span>
  )
}

function key(a: AssignmentSummary, i: number) {
  const x = a.assignment
  return x.assignment_number != null ? `${x.assignment_type === 'homework' ? 'problem_set' : x.assignment_type}:${x.assignment_number}` : `idx:${i}`
}

/** Same course, two semesters: lines assignments up by number (or position) and compares averages. */
export function Compare({ offerings, current }: { offerings: Offering[]; current: Offering }) {
  const others = sortOfferings(offerings).filter((o) => o.id !== current.id)
  const [otherId, setOtherId] = useState(others[0]?.id ?? '')
  const a = useQuery({ queryKey: ['overview', current.id], queryFn: () => getApi().getOverview(current.id) })
  const b = useQuery({ queryKey: ['overview', otherId], queryFn: () => getApi().getOverview(otherId), enabled: Boolean(otherId) })
  const other = offerings.find((o) => o.id === otherId)

  const rows = useMemo(() => {
    if (!a.data || !b.data) return null
    const sa = summarizeCourse(a.data)
    const sb = summarizeCourse(b.data)
    const order = (s: typeof sa) =>
      [...s.assignments].sort((x, y) => (x.assignment.due_date ?? '9999').localeCompare(y.assignment.due_date ?? '9999') || x.assignment.display_order - y.assignment.display_order)
    const la = order(sa)
    const lb = order(sb)
    const mb = new Map(lb.map((x, i) => [key(x, i), x]))
    const used = new Set<string>()
    const out: Array<{ label: string; a: AssignmentSummary | null; b: AssignmentSummary | null }> = la.map((x, i) => {
      const k = key(x, i)
      const match = mb.get(k) ?? null
      if (match) used.add(k)
      return { label: shortAssignmentTitle(x.assignment), a: x, b: match }
    })
    lb.forEach((x, i) => {
      if (!used.has(key(x, i))) out.push({ label: shortAssignmentTitle(x.assignment), a: null, b: x })
    })
    return { sa, sb, rows: out }
  }, [a.data, b.data])

  if (!others.length) {
    return <p className="rounded-xl border border-dashed border-border-strong px-6 py-12 text-center text-sm text-muted">Only one semester of this course is on the site so far, so there’s nothing to compare yet.</p>
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <Label htmlFor="cmp">Compare {offeringLabel(current)} with</Label>
          <Select id="cmp" value={otherId} onChange={(e) => setOtherId(e.target.value)} className="w-48">
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {offeringLabel(o)}
              </option>
            ))}
          </Select>
        </div>
        <p className="pb-2 text-xs text-faint">Assignments are matched by number when both semesters number them, otherwise by position. Different years may have different problems.</p>
      </div>
      {!rows ? (
        <Skeleton className="mt-4 h-48" />
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-normal">Assignment</th>
                <th className="pb-2 font-normal">{offeringLabel(current)}</th>
                <th className="pb-2 font-normal">{other ? offeringLabel(other) : ''}</th>
                <th className="pb-2 text-right font-normal">Difference</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-border-strong">
                <td className="py-2 font-medium">Whole semester</td>
                <td className="py-2">
                  <Score v={rows.sa.pooledMean} n={rows.sa.totalRatings} />
                </td>
                <td className="py-2">
                  <Score v={rows.sb.pooledMean} n={rows.sb.totalRatings} />
                </td>
                <td className="py-2 text-right text-xs tabular">{rows.sa.pooledMean != null && rows.sb.pooledMean != null ? signed(rows.sa.pooledMean - rows.sb.pooledMean) : '—'}</td>
              </tr>
              {rows.rows.map((r, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="py-1.5 text-xs font-medium">{r.label}</td>
                  <td className="py-1.5">{r.a ? <Score v={r.a.mean} n={r.a.ratingCount} /> : <span className="text-xs text-faint">not in this semester</span>}</td>
                  <td className="py-1.5">{r.b ? <Score v={r.b.mean} n={r.b.ratingCount} /> : <span className="text-xs text-faint">not in this semester</span>}</td>
                  <td className="py-1.5 text-right text-xs tabular">{r.a?.mean != null && r.b?.mean != null ? signed(r.a.mean - r.b.mean) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function signed(x: number) {
  return `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(1)}`
}
