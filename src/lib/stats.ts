import type { CompletionStatus, OfferingOverview, OverviewAssignment, OverviewProblem, ProblemStats } from './types'

/**
 * Aggregation methodology (also documented on /about):
 *
 * Problem   – mean, median, sample SD, and histogram of 1–10 ratings; median self-reported time.
 *             Computed in Postgres (private.refresh_problem_stats); computeProblemStats mirrors it exactly
 *             for demo mode and tests.
 * Unit      – a top-level problem. If it has parts, its difficulty is the unweighted mean of its rated parts'
 *             means (so a part with many votes doesn't dominate), its count is the sum of the parts' counts,
 *             and its time is the sum of the parts' median times when every rated part has time data.
 * Assignment– unweighted mean of its rated units' means. Unrated units are excluded (never treated as 0)
 *             and the coverage ("4 of 6 problems rated") is always shown next to it.
 * Ranking   – "hardest" lists sort by a Bayesian-adjusted mean, (n·mean + m·prior) / (n + m) with m = 5 and
 *             prior = the offering's pooled mean rating, so one 10/10 vote can't outrank 45 votes averaging 9.
 *             Raw means are always displayed alongside.
 */

export const LOW_SAMPLE = 3
export const BAYES_M = 5

export interface RawRating {
  difficulty: number
  time_minutes: number | null
  completion_status: CompletionStatus | null
}

const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits

/** Linear-interpolated median, matching Postgres percentile_cont(0.5). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = (s.length - 1) / 2
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

export function computeProblemStats(ratings: RawRating[]): ProblemStats | null {
  const n = ratings.length
  if (n === 0) return null
  const d = ratings.map((r) => r.difficulty)
  const mean = d.reduce((a, b) => a + b, 0) / n
  const sd = n > 1 ? Math.sqrt(d.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null
  const histogram = Array.from({ length: 10 }, (_, i) => d.filter((x) => x === i + 1).length)
  const times = ratings.map((r) => r.time_minutes).filter((t): t is number => t != null)
  const completion: Partial<Record<CompletionStatus, number>> = {
    solved_independently: 0,
    solved_with_help: 0,
    attempted_not_solved: 0,
    not_attempted: 0,
  }
  for (const r of ratings) if (r.completion_status) completion[r.completion_status] = (completion[r.completion_status] ?? 0) + 1
  return {
    rating_count: n,
    mean: round(mean, 3),
    median: median(d),
    stddev: sd == null ? null : round(sd, 3),
    histogram,
    time_count: times.length,
    median_time_minutes: median(times),
    completion,
  }
}

/** Postgres numeric columns arrive as strings through some clients; normalize defensively. */
export function normalizeStats(s: ProblemStats | null | undefined): ProblemStats | null {
  if (!s || !s.rating_count) return null
  const num = (v: unknown) => (v == null ? null : Number(v))
  return {
    rating_count: Number(s.rating_count),
    mean: num(s.mean),
    median: num(s.median),
    stddev: num(s.stddev),
    histogram: (s.histogram ?? []).map(Number),
    time_count: Number(s.time_count ?? 0),
    median_time_minutes: num(s.median_time_minutes),
    completion: s.completion ?? {},
  }
}

export function histogramMedian(hist: number[]): number | null {
  const n = hist.reduce((a, b) => a + b, 0)
  if (n === 0) return null
  const at = (k: number) => {
    let acc = 0
    for (let i = 0; i < hist.length; i++) {
      acc += hist[i]
      if (k < acc) return i + 1
    }
    return hist.length
  }
  const pos = (n - 1) / 2
  const lo = at(Math.floor(pos))
  const hi = at(Math.ceil(pos))
  return lo + (hi - lo) * (pos - Math.floor(pos))
}

export function addHistograms(hs: number[][]): number[] {
  const out = Array(10).fill(0)
  for (const h of hs) h.forEach((v, i) => (out[i] += v))
  return out
}

export function bayesianMean(mean: number, n: number, prior: number, m = BAYES_M) {
  return (n * mean + m * prior) / (n + m)
}

/** Standard error of the mean; null when it can't be estimated. */
export function standardError(stats: ProblemStats | null) {
  if (!stats || stats.stddev == null || stats.rating_count < 2) return null
  return stats.stddev / Math.sqrt(stats.rating_count)
}

// ───────────────────────── units (top-level problems) ─────────────────────────

export interface UnitStats {
  count: number
  mean: number | null
  median: number | null
  timeMinutes: number | null
  histogram: number[]
  /** true when derived from parts rather than rated directly */
  derived: boolean
  ratedParts: number
  totalParts: number
}

export interface Unit {
  problem: OverviewProblem
  parts: OverviewProblem[]
  stats: UnitStats
}

export function unitStats(problem: OverviewProblem, parts: OverviewProblem[]): UnitStats {
  if (parts.length === 0) {
    const s = problem.stats
    return {
      count: s?.rating_count ?? 0,
      mean: s?.mean ?? null,
      median: s?.median ?? null,
      timeMinutes: s && s.time_count > 0 ? s.median_time_minutes : null,
      histogram: s?.histogram ?? Array(10).fill(0),
      derived: false,
      ratedParts: s ? 1 : 0,
      totalParts: 1,
    }
  }
  const rated = parts.filter((p) => p.stats && p.stats.rating_count > 0)
  // Legacy direct ratings on a parent are used only when none of its parts are rated.
  if (rated.length === 0 && problem.stats) return { ...unitStats(problem, []), totalParts: parts.length, ratedParts: 0 }
  const histogram = addHistograms(rated.map((p) => p.stats!.histogram))
  const timed = rated.filter((p) => p.stats!.time_count > 0 && p.stats!.median_time_minutes != null)
  return {
    count: rated.reduce((a, p) => a + p.stats!.rating_count, 0),
    mean: rated.length ? rated.reduce((a, p) => a + p.stats!.mean!, 0) / rated.length : null,
    median: histogramMedian(histogram),
    timeMinutes: rated.length > 0 && timed.length === rated.length ? timed.reduce((a, p) => a + p.stats!.median_time_minutes!, 0) : null,
    histogram,
    derived: true,
    ratedParts: rated.length,
    totalParts: parts.length,
  }
}

export function buildUnits(assignment: OverviewAssignment): Unit[] {
  const tops = assignment.problems.filter((p) => !p.parent_problem_id).sort((a, b) => a.display_order - b.display_order)
  const byParent = new Map<string, OverviewProblem[]>()
  for (const p of assignment.problems) {
    if (!p.parent_problem_id) continue
    const list = byParent.get(p.parent_problem_id) ?? []
    list.push(p)
    byParent.set(p.parent_problem_id, list)
  }
  return tops.map((problem) => {
    const parts = (byParent.get(problem.id) ?? []).sort((a, b) => a.display_order - b.display_order)
    return { problem, parts, stats: unitStats(problem, parts) }
  })
}

/** Problems a student can rate: parts, plus top-level problems without parts. */
export function rateableProblems(assignment: OverviewAssignment): OverviewProblem[] {
  return buildUnits(assignment).flatMap((u) => (u.parts.length ? u.parts : [u.problem]))
}

export function displayLabel(problem: Pick<OverviewProblem, 'label'>, parentLabel?: string | null) {
  if (!parentLabel) return problem.label
  return /^[a-z]{1,2}$|^[ivx]+$/i.test(problem.label) ? `${parentLabel}(${problem.label})` : `${parentLabel}.${problem.label}`
}

// ───────────────────────── assignment & course summaries ─────────────────────────

export interface AssignmentSummary {
  assignment: OverviewAssignment
  units: Unit[]
  mean: number | null
  ratedUnits: number
  totalUnits: number
  totalRateable: number
  ratedRateable: number
  ratingCount: number
  hardest: Unit | null
  workloadMinutes: number | null
  workloadCoverage: number // fraction of units with time data
  histogram: number[]
}

export function summarizeAssignment(assignment: OverviewAssignment): AssignmentSummary {
  const units = buildUnits(assignment)
  const rated = units.filter((u) => u.stats.mean != null)
  const rateable = rateableProblems(assignment)
  const timed = units.filter((u) => u.stats.timeMinutes != null)
  const hardest = rated.length ? rated.reduce((a, b) => (b.stats.mean! > a.stats.mean! ? b : a)) : null
  return {
    assignment,
    units,
    mean: rated.length ? rated.reduce((a, u) => a + u.stats.mean!, 0) / rated.length : null,
    ratedUnits: rated.length,
    totalUnits: units.length,
    totalRateable: rateable.length,
    ratedRateable: rateable.filter((p) => p.stats && p.stats.rating_count > 0).length,
    ratingCount: units.reduce((a, u) => a + u.stats.count, 0),
    hardest,
    // Only report a workload when at least half of the problems have time data.
    workloadMinutes: units.length && timed.length / units.length >= 0.5 ? timed.reduce((a, u) => a + u.stats.timeMinutes!, 0) : null,
    workloadCoverage: units.length ? timed.length / units.length : 0,
    histogram: addHistograms(units.map((u) => u.stats.histogram)),
  }
}

export interface RankedProblem {
  problem: OverviewProblem
  parentLabel: string | null
  assignment: OverviewAssignment
  mean: number
  count: number
  adjusted: number
}

export interface CourseSummary {
  assignments: AssignmentSummary[]
  totalAssignments: number
  totalProblems: number
  ratedProblems: number
  totalRatings: number
  pooledMean: number | null
  histogram: number[]
  hardest: RankedProblem[] // Bayesian-adjusted ranking
  hardestAssignment: AssignmentSummary | null
}

export function summarizeCourse(overview: OfferingOverview): CourseSummary {
  const assignments = overview.assignments.map(summarizeAssignment)
  const leaves: Array<{ problem: OverviewProblem; parentLabel: string | null; assignment: OverviewAssignment }> = []
  for (const a of assignments) {
    for (const u of a.units) {
      if (u.parts.length) for (const p of u.parts) leaves.push({ problem: p, parentLabel: u.problem.label, assignment: a.assignment })
      else leaves.push({ problem: u.problem, parentLabel: null, assignment: a.assignment })
    }
  }
  const histogram = addHistograms(leaves.map((l) => l.problem.stats?.histogram ?? []))
  const totalRatings = histogram.reduce((a, b) => a + b, 0)
  const pooledMean = totalRatings ? histogram.reduce((a, c, i) => a + c * (i + 1), 0) / totalRatings : null
  const prior = pooledMean ?? 5.5
  const hardest = leaves
    .filter((l) => l.problem.stats && l.problem.stats.mean != null)
    .map((l) => ({
      ...l,
      mean: l.problem.stats!.mean!,
      count: l.problem.stats!.rating_count,
      adjusted: bayesianMean(l.problem.stats!.mean!, l.problem.stats!.rating_count, prior),
    }))
    .sort((a, b) => b.adjusted - a.adjusted || b.count - a.count)
  const ratedAssignments = assignments.filter((a) => a.mean != null && a.ratedUnits >= Math.min(2, a.totalUnits))
  return {
    assignments,
    totalAssignments: assignments.length,
    totalProblems: leaves.length,
    ratedProblems: leaves.filter((l) => l.problem.stats && l.problem.stats.rating_count > 0).length,
    totalRatings,
    pooledMean,
    histogram,
    hardest,
    hardestAssignment: ratedAssignments.length ? ratedAssignments.reduce((a, b) => (b.mean! > a.mean! ? b : a)) : null,
  }
}

/**
 * Optimistic aggregate after the current user's vote changes from `prev` to `next` (either may be null).
 * Exact for difficulty (ratings are integers, so the histogram determines mean/median/SD); time and
 * completion fields keep their previous values until the server responds.
 */
export function applyVoteToStats(stats: ProblemStats | null, prev: number | null, next: number | null): ProblemStats | null {
  const hist = [...(stats?.histogram ?? Array(10).fill(0))]
  if (prev != null) hist[prev - 1] = Math.max(0, hist[prev - 1] - 1)
  if (next != null) hist[next - 1] += 1
  const n = hist.reduce((a, b) => a + b, 0)
  if (n === 0) return null
  const mean = hist.reduce((a, c, i) => a + c * (i + 1), 0) / n
  const sd = n > 1 ? Math.sqrt(hist.reduce((a, c, i) => a + c * (i + 1 - mean) ** 2, 0) / (n - 1)) : null
  return {
    rating_count: n,
    mean: Math.round(mean * 1000) / 1000,
    median: histogramMedian(hist),
    stddev: sd == null ? null : Math.round(sd * 1000) / 1000,
    histogram: hist,
    time_count: stats?.time_count ?? 0,
    median_time_minutes: stats?.median_time_minutes ?? null,
    completion: stats?.completion ?? {},
  }
}
