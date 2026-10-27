import { summarizeAssignment, LOW_SAMPLE, type AssignmentSummary } from '@/lib/stats'
import { countColor, difficultyColor, timeColor, type Swatch, type Theme } from '@/lib/scale'
import { formatScore, shortAssignmentTitle } from '@/lib/format'
import type { MyRating, OfferingOverview, OverviewAssignment, OverviewProblem } from '@/lib/types'

export type Metric = 'mean' | 'median' | 'time' | 'count'
export type SortMode = 'chronological' | 'hardest' | 'most_rated'

export interface HeatmapOptions {
  metric: Metric
  sort: SortMode
  showNumbers: boolean
  showCounts: boolean
  onlyRated: boolean
  expand: boolean
}

export const DEFAULT_OPTIONS: HeatmapOptions = {
  metric: 'mean',
  sort: 'chronological',
  showNumbers: true,
  showCounts: false,
  onlyRated: false,
  expand: false,
}

export type MineState = 'rated' | 'partial' | 'stale' | null

export interface CellModel {
  key: string
  /** The problem to open when the cell is activated (the unit itself, or the part). */
  problem: OverviewProblem
  assignment: OverviewAssignment
  label: string
  /** e.g. "3(b)" */
  fullLabel: string
  title: string | null
  count: number
  mean: number | null
  median: number | null
  timeMinutes: number | null
  timeCount: number
  derived: boolean
  parts: number
  ratedParts: number
  groupStart: boolean
  mine: MineState
  myRating: number | null
}

export interface RowModel {
  assignment: OverviewAssignment
  summary: AssignmentSummary
  shortTitle: string
  cells: CellModel[]
}

export interface HeatmapModel {
  rows: RowModel[]
  columns: number
  wide: boolean
  maxCount: number
  hiddenRows: number
}

function partLabel(parent: string, part: string) {
  return /^[a-z]{1,2}$|^[ivx]+$/i.test(part) ? `${parent}(${part})` : `${parent}.${part}`
}

export function buildHeatmap(overview: OfferingOverview, mine: Record<string, MyRating> | undefined, opts: HeatmapOptions): HeatmapModel {
  const rows: RowModel[] = []
  let hiddenRows = 0
  for (const assignment of overview.assignments) {
    const summary = summarizeAssignment(assignment)
    const cells: CellModel[] = []
    for (const unit of summary.units) {
      const p = unit.problem
      if (opts.expand && unit.parts.length) {
        unit.parts.forEach((part, i) => {
          const r = mine?.[part.id]
          cells.push({
            key: part.id, problem: part, assignment, label: partLabel(p.label, part.label), fullLabel: partLabel(p.label, part.label),
            title: part.title ?? p.title, count: part.stats?.rating_count ?? 0, mean: part.stats?.mean ?? null, median: part.stats?.median ?? null,
            timeMinutes: part.stats && part.stats.time_count > 0 ? part.stats.median_time_minutes : null, timeCount: part.stats?.time_count ?? 0,
            derived: false, parts: 0, ratedParts: 0, groupStart: i === 0, mine: r ? (r.stale ? 'stale' : 'rated') : null, myRating: r && !r.stale ? r.difficulty : null,
          })
        })
      } else {
        const rateable = unit.parts.length ? unit.parts : [p]
        const mineCount = rateable.filter((x) => mine?.[x.id] && !mine[x.id].stale).length
        const stale = rateable.some((x) => mine?.[x.id]?.stale)
        const own = !unit.parts.length ? mine?.[p.id] : undefined
        cells.push({
          key: p.id, problem: p, assignment, label: p.label, fullLabel: p.label, title: p.title, count: unit.stats.count, mean: unit.stats.mean,
          median: unit.stats.median, timeMinutes: unit.stats.timeMinutes,
          timeCount: unit.parts.length ? unit.parts.reduce((n, x) => n + (x.stats?.time_count ?? 0), 0) : p.stats?.time_count ?? 0,
          derived: unit.stats.derived, parts: unit.parts.length, ratedParts: unit.stats.ratedParts, groupStart: true,
          mine: stale ? 'stale' : mineCount === 0 ? null : mineCount === rateable.length ? 'rated' : 'partial',
          myRating: own && !own.stale ? own.difficulty : null,
        })
      }
    }
    const visible = opts.onlyRated ? cells.filter((c) => c.count > 0) : cells
    if (opts.onlyRated && visible.length === 0) {
      hiddenRows++
      continue
    }
    rows.push({ assignment, summary, shortTitle: shortAssignmentTitle(assignment), cells: visible })
  }

  if (opts.sort === 'hardest') rows.sort((a, b) => (b.summary.mean ?? -1) - (a.summary.mean ?? -1))
  else if (opts.sort === 'most_rated') rows.sort((a, b) => b.summary.ratingCount - a.summary.ratingCount)
  else
    rows.sort((a, b) => {
      const da = a.assignment.due_date
      const dbb = b.assignment.due_date
      if (da && dbb && da !== dbb) return da.localeCompare(dbb)
      return a.assignment.display_order - b.assignment.display_order
    })

  const allCells = rows.flatMap((r) => r.cells)
  return {
    rows,
    columns: Math.max(0, ...rows.map((r) => r.cells.length)),
    // Long labels ("Draft", "Milestone 2", "Essay Prompt A") don't fit in a square cell: switch to wide cells.
    wide: allCells.some((c) => c.label.length > 4),
    maxCount: Math.max(1, ...allCells.map((c) => c.count)),
    hiddenRows,
  }
}

export interface CellAppearance {
  swatch: Swatch | null
  text: string
  state: 'value' | 'unrated' | 'no-data'
  lowSample: boolean
}

export function cellAppearance(cell: Pick<CellModel, 'count' | 'mean' | 'median' | 'timeMinutes'>, metric: Metric, theme: Theme, maxCount: number): CellAppearance {
  if (cell.count === 0) return { swatch: null, text: '—', state: 'unrated', lowSample: false }
  const lowSample = cell.count < LOW_SAMPLE
  switch (metric) {
    case 'mean':
    case 'median': {
      const v = metric === 'mean' ? cell.mean : cell.median
      if (v == null) return { swatch: null, text: '·', state: 'no-data', lowSample }
      return { swatch: difficultyColor(v, theme), text: metric === 'median' && Number.isInteger(v) ? String(v) : formatScore(v), state: 'value', lowSample }
    }
    case 'time': {
      if (cell.timeMinutes == null) return { swatch: null, text: '·', state: 'no-data', lowSample }
      const m = cell.timeMinutes
      return { swatch: timeColor(m, theme), text: m < 60 ? `${Math.round(m)}m` : `${Number((m / 60).toFixed(m < 600 ? 1 : 0))}h`, state: 'value', lowSample }
    }
    case 'count':
      return { swatch: countColor(cell.count, maxCount, theme), text: String(cell.count), state: 'value', lowSample: false }
  }
}

export const METRIC_LABELS: Record<Metric, string> = {
  mean: 'Average difficulty',
  median: 'Median difficulty',
  time: 'Median time',
  count: 'Ratings',
}
