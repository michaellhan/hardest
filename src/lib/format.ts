import type { AssignmentType, CompletionStatus, Offering, OverviewAssignment, Term } from './types'

export const TERM_LABELS: Record<Term, string> = {
  fall: 'Fall',
  spring: 'Spring',
  summer: 'Summer',
  winter: 'Winter',
  january: 'January',
  full_year: 'Full year',
}

export const TERM_ORDER: Record<Term, number> = { january: 0, winter: 0, spring: 1, summer: 2, fall: 3, full_year: 3 }

export function offeringLabel(o: Pick<Offering, 'term' | 'year' | 'section'>) {
  return `${TERM_LABELS[o.term]} ${o.year}${o.section ? ` · ${o.section}` : ''}`
}

export function sortOfferings<T extends Pick<Offering, 'term' | 'year' | 'section'>>(list: T[]): T[] {
  return [...list].sort((a, b) => b.year - a.year || TERM_ORDER[b.term] - TERM_ORDER[a.term] || a.section.localeCompare(b.section))
}

export const ASSIGNMENT_TYPE_LABELS: Record<AssignmentType, string> = {
  problem_set: 'Problem set',
  homework: 'Homework',
  lab: 'Lab',
  essay: 'Essay',
  project: 'Project',
  reading_response: 'Reading response',
  quiz: 'Quiz',
  exam: 'Exam',
  other: 'Other',
}

const SHORT_PREFIX: Partial<Record<AssignmentType, string>> = {
  problem_set: 'PS',
  homework: 'HW',
  lab: 'Lab',
  essay: 'Essay',
  project: 'Proj',
  reading_response: 'RR',
  quiz: 'Quiz',
  exam: 'Exam',
}

/** Compact row label for narrow screens: "Problem Set 4" → "PS 4". */
export function shortAssignmentTitle(a: Pick<OverviewAssignment, 'title' | 'assignment_type' | 'assignment_number'>) {
  const prefix = SHORT_PREFIX[a.assignment_type]
  if (prefix && a.assignment_number != null) return `${prefix} ${formatNumber(a.assignment_number)}`
  return a.title.length > 14 ? a.title.slice(0, 13) + '…' : a.title
}

export function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)))
}

export function formatScore(v: number | null | undefined) {
  return v == null ? '—' : v.toFixed(1)
}

export function formatMinutes(m: number | null | undefined) {
  if (m == null) return '—'
  if (m < 60) return `${Math.round(m)} min`
  const h = m / 60
  if (h < 10) return `${Number(h.toFixed(1))} h`
  return `${Math.round(h)} h`
}

export function formatCount(n: number, noun: string, plural = noun + 's') {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function relativeTime(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`
  return formatDate(iso)
}

export const COMPLETION_LABELS: Record<CompletionStatus, string> = {
  solved_independently: 'Solved independently',
  solved_with_help: 'Solved with help',
  attempted_not_solved: 'Attempted, not solved',
  not_attempted: 'Not attempted / only reviewed',
}

/** Time buckets are stored as representative minutes so medians stay meaningful. */
export const TIME_BUCKETS: Array<{ label: string; short: string; minutes: number }> = [
  { label: 'Less than 15 minutes', short: '<15m', minutes: 10 },
  { label: '15–30 minutes', short: '15–30m', minutes: 22 },
  { label: '30–60 minutes', short: '30–60m', minutes: 45 },
  { label: '1–2 hours', short: '1–2h', minutes: 90 },
  { label: '2–4 hours', short: '2–4h', minutes: 180 },
  { label: '4+ hours', short: '4h+', minutes: 300 },
]

export function bucketForMinutes(m: number | null) {
  return TIME_BUCKETS.find((b) => b.minutes === m) ?? null
}
