import type { OfferingOverview, OverviewAssignment, OverviewProblem, ProblemStats } from '@/lib/types'
import { computeProblemStats } from '@/lib/stats'

export function stats(values: number[], times: number[] = []): ProblemStats | null {
  return computeProblemStats(values.map((d, i) => ({ difficulty: d, time_minutes: times[i] ?? null, completion_status: null })))
}

let n = 0
export function problem(label: string, values: number[] = [], extra: Partial<OverviewProblem> = {}): OverviewProblem {
  n++
  return { id: `p${n}`, parent_problem_id: null, label, slug: `p${label}`, display_order: n, title: null, has_statement: false, stats: stats(values), ...extra }
}

export function assignment(title: string, problems: OverviewProblem[], extra: Partial<OverviewAssignment> = {}): OverviewAssignment {
  n++
  return {
    id: `a${n}`, title, slug: title.toLowerCase().replace(/\s+/g, '-'), assignment_type: 'problem_set', assignment_number: null, display_order: n,
    due_date: null, description: null, is_demo: false, status: 'active', created_at: '2026-09-01T00:00:00Z', source_document_id: null, problems, ...extra,
  }
}

export function overview(...assignments: OverviewAssignment[]): OfferingOverview {
  return { assignments }
}
