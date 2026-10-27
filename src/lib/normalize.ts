import type { AssignmentType, OverviewAssignment, OverviewProblem, Term } from './types'

/** "MATH 55A", "math55a", "Math-55a" → "math55a" (matches public.normalize_code in SQL). */
export function normalizeCode(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

const TERM_WORDS: Array<[RegExp, Term]> = [
  [/^(fall|autumn|fa|f)$/, 'fall'],
  [/^(spring|sp|s)$/, 'spring'],
  [/^(summer|su)$/, 'summer'],
  [/^(winter|wi)$/, 'winter'],
  [/^(january|jterm|j-term|wintersession)$/, 'january'],
]

/**
 * Pulls a semester out of a course query: "math 55a fall 2026" → { text: "math 55a", term: "fall", year: 2026 }.
 * Also understands "F26", "fall26", "2026".
 */
export function parseCourseQuery(q: string): { text: string; term: Term | null; year: number | null } {
  let term: Term | null = null
  let year: number | null = null
  const rest: string[] = []
  for (const raw of q.trim().split(/\s+/)) {
    const tok = raw.toLowerCase().replace(/[,.]/g, '')
    const compact = tok.match(/^(fall|spring|summer|winter|fa|sp|su|f|s)'?(\d{2}|\d{4})$/)
    if (compact && !term) {
      term = TERM_WORDS.find(([re]) => re.test(compact[1]))?.[1] ?? null
      year = compact[2].length === 2 ? 2000 + Number(compact[2]) : Number(compact[2])
      continue
    }
    if (/^(19|20)\d{2}$/.test(tok) && year == null) {
      year = Number(tok)
      continue
    }
    const t = tok.length >= 4 || /^(fa|sp|su|wi)$/.test(tok) ? TERM_WORDS.find(([re]) => re.test(tok))?.[1] : undefined
    if (t && !term) {
      term = t
      continue
    }
    rest.push(raw)
  }
  return { text: rest.join(' '), term, year }
}

const ASSIGNMENT_WORDS: Array<[RegExp, AssignmentType]> = [
  [/^(pset|ps|problemset|problem-set|set)$/, 'problem_set'],
  [/^(hw|homework|assignment|a)$/, 'homework'],
  [/^(lab)$/, 'lab'],
  [/^(essay)$/, 'essay'],
  [/^(project|proj)$/, 'project'],
  [/^(quiz)$/, 'quiz'],
  [/^(exam|midterm|final)$/, 'exam'],
]

export interface ProblemQuery {
  assignmentType: AssignmentType | null
  assignmentNumber: number | null
  problemLabel: string | null
  text: string
}

/** "pset 4 problem 2", "ps4 p2", "hw 3 #2b", "4.2", "pset 4 3(a)" */
export function parseProblemQuery(q: string): ProblemQuery {
  let s = ` ${q.toLowerCase()} `
  s = s.replace(/problem\s+set/g, 'pset').replace(/\s+/g, ' ')
  const out: ProblemQuery = { assignmentType: null, assignmentNumber: null, problemLabel: null, text: q.trim() }
  const dotted = s.match(/^\s*(\d+)\s*[./]\s*(\d+[a-z]?)\s*$/)
  if (dotted) return { ...out, assignmentNumber: Number(dotted[1]), problemLabel: dotted[2], text: '' }
  const assign = s.match(/\b(pset|ps|hw|homework|assignment|lab|essay|project|proj|quiz|exam)\s*#?\s*(\d+)\b/)
  if (assign) {
    out.assignmentType = ASSIGNMENT_WORDS.find(([re]) => re.test(assign[1]))?.[1] ?? null
    out.assignmentNumber = Number(assign[2])
    s = s.replace(assign[0], ' ')
  }
  const prob =
    s.match(/\b(?:problem|prob|question|q|p|exercise|ex|#)\s*\.?\s*(\d+)\s*(?:\(?([a-z]|[ivx]+)\)?)?(?=\s|$)/) ??
    (assign ? s.match(/(?:^|\s)(\d+)\s*(?:\(([a-z]|[ivx]+)\)|([a-z]))?(?=\s|$)/) : null)
  if (prob) {
    out.problemLabel = prob[1] + (prob[2] ?? prob[3] ?? '')
    s = s.replace(prob[0], ' ')
  }
  out.text = s.trim()
  return out
}

export interface ProblemHit {
  assignment: OverviewAssignment
  problem: OverviewProblem
  parentLabel: string | null
  score: number
}

/** Client-side search within one offering's heatmap data. */
export function searchOffering(assignments: OverviewAssignment[], q: string, limit = 8): ProblemHit[] {
  const query = parseProblemQuery(q)
  const text = query.text.toLowerCase()
  const hits: ProblemHit[] = []
  for (const a of assignments) {
    const numMatch = query.assignmentNumber != null && a.assignment_number === query.assignmentNumber
    const typeMatch = !query.assignmentType || query.assignmentType === a.assignment_type ||
      (query.assignmentType === 'homework' && a.assignment_type === 'problem_set') ||
      (query.assignmentType === 'problem_set' && a.assignment_type === 'homework')
    if (query.assignmentNumber != null && !(numMatch && typeMatch)) continue
    const byId = new Map(a.problems.map((p) => [p.id, p]))
    for (const p of a.problems) {
      const parent = p.parent_problem_id ? byId.get(p.parent_problem_id) : null
      const combined = ((parent?.label ?? '') + p.label).toLowerCase().replace(/[^a-z0-9]/g, '')
      let score = 0
      if (query.problemLabel) {
        const want = query.problemLabel.replace(/[^a-z0-9]/g, '')
        if (combined === want) score += 3
        else if (!parent && p.label.toLowerCase() === want) score += 3
        else if (combined.startsWith(want) && parent && parent.label.toLowerCase() === want) score += 1
        else continue
      } else if (numMatch) {
        score += parent ? 0.5 : 1
      }
      if (text) {
        const hay = `${a.title} ${p.title ?? ''} ${p.label}`.toLowerCase()
        if (hay.includes(text)) score += 1
        else if (!query.problemLabel && !numMatch) continue
      }
      if (score > 0) hits.push({ assignment: a, problem: p, parentLabel: parent?.label ?? null, score })
    }
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, limit)
}
