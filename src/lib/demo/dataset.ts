import type { AssignmentType, CompletionStatus, Course, Offering, Term, University } from '../types'
import { CATALOG, HARVARD } from './catalog'
import { DEMO_CONTENT, type DemoProblem } from './content'
import { slugify } from '../normalize'

/**
 * Builds the demo database: the real catalog skeleton plus DEMO / SYNTHETIC assignments and ratings.
 * Deterministic (seeded PRNG + name-derived UUIDs), so the browser demo and supabase/seed-demo.sql agree.
 */

export interface DemoAssignmentRow {
  id: string
  course_offering_id: string
  title: string
  slug: string
  assignment_type: AssignmentType
  assignment_number: number | null
  display_order: number
  due_date: string | null
  description: string | null
  is_demo: boolean
  created_at: string
}

export interface DemoProblemRow {
  id: string
  assignment_id: string
  parent_problem_id: string | null
  label: string
  slug: string
  display_order: number
  title: string | null
  statement_markdown: string | null
}

export interface DemoRatingRow {
  user_id: string
  problem_id: string
  difficulty: number
  time_minutes: number | null
  completion_status: CompletionStatus | null
}

export interface DemoDataset {
  universities: University[]
  courses: Course[]
  offerings: Offering[]
  assignments: DemoAssignmentRow[]
  problems: DemoProblemRow[]
  ratings: DemoRatingRow[]
  demoUserIds: string[]
}

/** Stable UUID derived from a name (FNV-1a based; not cryptographic — only for reproducible demo ids). */
export function nameUuid(name: string): string {
  const parts: string[] = []
  for (let seed = 0; seed < 4; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b1)
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    parts.push((h >>> 0).toString(16).padStart(8, '0'))
  }
  const hex = parts.join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function academicYear(term: Term, year: number) {
  return term === 'fall' || term === 'full_year' ? `${year}-${String((year + 1) % 100).padStart(2, '0')}` : `${year - 1}-${String(year % 100).padStart(2, '0')}`
}

function problemSlug(label: string, parentSlug: string | null) {
  const l = label.trim().toLowerCase()
  if (!parentSlug) return /^[0-9]+[a-z]?$/.test(l) ? `p${l}` : slugify(label)
  return /^[a-z]$/.test(l) && /[0-9]$/.test(parentSlug) ? parentSlug + l : `${parentSlug}-${slugify(label)}`
}

function assignmentSlug(title: string, type: AssignmentType, n: number | null) {
  if (n == null || type === 'other') return slugify(title)
  const prefix = type === 'problem_set' ? 'pset' : type === 'homework' ? 'hw' : type === 'reading_response' ? 'response' : type
  return `${prefix}-${slugify(String(n))}`
}

const DEMO_USERS = 60

export function buildDemoDataset(): DemoDataset {
  const rand = mulberry32(55)
  const gauss = () => {
    const u = Math.max(rand(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
  }
  const university: University = { id: nameUuid('uni:harvard'), name: HARVARD.name, short_name: HARVARD.short_name, slug: HARVARD.slug, domain: HARVARD.domain, status: 'active' }
  const courses: Course[] = []
  const offerings: Offering[] = []
  const assignments: DemoAssignmentRow[] = []
  const problems: DemoProblemRow[] = []
  const ratings: DemoRatingRow[] = []
  const demoUserIds = Array.from({ length: DEMO_USERS }, (_, i) => nameUuid(`demo-user:${i}`))

  for (const c of CATALOG) {
    const courseId = nameUuid(`course:${c.key}`)
    courses.push({ id: courseId, university_id: university.id, code: c.code, name: c.name, description: c.description, slug: c.slug, department: c.department, status: 'active' })
    for (const o of c.offerings) {
      const offeringId = nameUuid(`offering:${c.key}:${o.key}`)
      offerings.push({
        id: offeringId, course_id: courseId, year: o.year, term: o.term, academic_year: academicYear(o.term, o.year), section: '',
        instructor: o.instructor ?? null, slug: `${o.term.replace('_', '-')}-${o.year}`, status: 'active',
      })
      const content = DEMO_CONTENT[c.key]?.[o.key] ?? []
      content.forEach((a, ai) => {
        const assignmentId = nameUuid(`assignment:${c.key}:${o.key}:${ai}`)
        assignments.push({
          id: assignmentId, course_offering_id: offeringId, title: a.title, slug: assignmentSlug(a.title, a.type, a.number), assignment_type: a.type,
          assignment_number: a.number, display_order: a.number != null ? a.number * 100 : (ai + 1) * 100, due_date: a.due,
          description: null, is_demo: true, created_at: `${a.due ?? '2026-09-01'}T12:00:00Z`,
        })
        const addProblem = (p: DemoProblem, order: number, parent: DemoProblemRow | null) => {
          const id = nameUuid(`problem:${assignmentId}:${parent?.label ?? ''}:${p.label}`)
          const row: DemoProblemRow = {
            id, assignment_id: assignmentId, parent_problem_id: parent?.id ?? null, label: p.label, slug: problemSlug(p.label, parent?.slug ?? null),
            display_order: order, title: p.title ?? null, statement_markdown: p.s ?? null,
          }
          problems.push(row)
          if (p.parts?.length) {
            p.parts.forEach((part, i) => addProblem(part, i + 1, row))
            return
          }
          // Synthetic votes: fewer for later assignments, jittered per problem; harder problems get a few more.
          const n = p.n ?? Math.max(0, Math.round(a.votes * (0.7 + rand() * 0.45) + (p.d - 5) * 0.6))
          const voters = [...demoUserIds].sort(() => rand() - 0.5).slice(0, Math.min(n, DEMO_USERS))
          for (const user of voters) {
            const difficulty = Math.min(10, Math.max(1, Math.round(p.d + gauss() * 1.25)))
            const hasTime = rand() < 0.62
            const minutes = hasTime ? Math.round(Math.min(900, Math.max(5, 12 * 1.38 ** p.d * Math.exp(gauss() * 0.45)))) : null
            const r = rand()
            const solveP = Math.max(0.15, 1 - (difficulty - 1) / 11)
            const completion: CompletionStatus | null = rand() < 0.35 ? null
              : r < solveP * 0.75 ? 'solved_independently' : r < solveP ? 'solved_with_help' : r < 0.94 ? 'attempted_not_solved' : 'not_attempted'
            ratings.push({ user_id: user, problem_id: id, difficulty, time_minutes: minutes, completion_status: completion })
          }
        }
        a.problems.forEach((p, i) => addProblem(p, i + 1, null))
      })
    }
  }
  return { universities: [university], courses, offerings, assignments, problems, ratings, demoUserIds }
}
