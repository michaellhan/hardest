/**
 * LOCAL DEMO MODE.
 * An in-browser implementation of the Api, backed by DEMO / SYNTHETIC data (lib/demo). Changes made here
 * (your ratings, uploads, edits) are stored only in this browser's localStorage — other visitors never see
 * them and nothing is sent to a server. The UI shows a persistent banner whenever this mode is active.
 */
import { buildDemoDataset, nameUuid, type DemoDataset } from '../demo/dataset'
import { normalizeCode, slugify } from '../normalize'
import { textSimilarity } from '../parser'
import { computeProblemStats, type RawRating } from '../stats'
import { trigramSimilarity, wordSimilarity } from '../trigram'
import { offeringLabel } from '../format'
import type {
  AppRole,
  AssignmentType,
  AuthUser,
  CompletionStatus,
  ContentStatus,
  Course,
  DocumentVisibility,
  FileKind,
  ModerationQueue,
  MyRating,
  Offering,
  OverviewAssignment,
  ProblemContext,
  PublishProblemNode,
  ReportKind,
  RevisionEntry,
  StatementSource,
  University,
} from '../types'
import { ApiError, type Api, type ProblemChanges } from './types'

const STORAGE_KEY = 'hardest:demo:v1'
const LOCAL_USER = 'local-demo-user'

interface AssignmentRow {
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
  status: ContentStatus
  merged_into: string | null
  source_document_id: string | null
  created_by: string | null
  created_at: string
}

interface ProblemRow {
  id: string
  assignment_id: string
  parent_problem_id: string | null
  label: string
  slug: string
  display_order: number
  title: string | null
  statement_markdown: string | null
  statement_source: StatementSource
  source_page_start: number | null
  source_page_end: number | null
  extraction_status: string
  rating_epoch: number
  status: ContentStatus
  merged_into: string | null
  created_by: string | null
  updated_at: string
}

interface Revision {
  id: string
  problem_id: string
  editor: string | null
  kind: string
  before: ProblemChanges | null
  after: ProblemChanges | null
  note: string | null
  material_change: boolean
  created_at: string
}

interface Proposal {
  id: string
  problem_id: string
  changes: ProblemChanges
  note: string | null
  material_change: boolean
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

interface Report {
  id: string
  problem_id: string | null
  assignment_id: string | null
  kind: ReportKind
  details: string | null
  duplicate_of_problem_id: string | null
  duplicate_of_assignment_id: string | null
  status: 'open' | 'resolved' | 'dismissed'
  created_at: string
}

interface Doc {
  id: string
  course_offering_id: string
  assignment_id: string | null
  filename: string
  file_type: FileKind
  storage_path: string | null
  visibility: DocumentVisibility
  page_count: number | null
  checksum: string | null
  dataUrl?: string
}

type Event =
  | { t: 'university'; row: University }
  | { t: 'course'; row: Course }
  | { t: 'offering'; row: Offering }
  | { t: 'document'; row: Doc }
  | { t: 'publish'; payload: Parameters<Api['publishAssignment']>[0]; ids: string[]; at: string }
  | { t: 'addProblem'; input: Parameters<Api['addProblem']>[0]; id: string; at: string }
  | { t: 'propose'; problemId: string; changes: ProblemChanges; note: string | null; material: boolean; id: string; at: string }
  | { t: 'review'; id: string; approve: boolean; note: string | null; material: boolean | null; at: string }
  | { t: 'revert'; revisionId: string; at: string; id: string }
  | { t: 'report'; row: Report }
  | { t: 'resolve'; id: string; status: 'resolved' | 'dismissed' }
  | { t: 'status'; type: string; id: string; status: 'active' | 'hidden' }
  | { t: 'mergeProblems'; s: string; t2: string }
  | { t: 'mergeAssignments'; s: string; t2: string }

interface LocalState {
  user: { id: string; email: string } | null
  role: AppRole
  ratings: Record<string, MyRating & { epoch: number }>
  saved: string[]
  profile: { display_name: string | null; show_name: boolean }
  events: Event[]
  feedback: Array<{ message: string; page: string; at: string }>
}

const freshLocal = (): LocalState => ({
  user: null,
  role: 'user',
  ratings: {},
  saved: [],
  profile: { display_name: null, show_name: false },
  events: [],
  feedback: [],
})

function loadLocal(): LocalState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...freshLocal(), ...JSON.parse(raw) } : freshLocal()
  } catch {
    return freshLocal()
  }
}

const delay = <T,>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const uuid = () => (globalThis.crypto?.randomUUID?.() ?? nameUuid(String(Math.random())))
const now = () => new Date().toISOString()

class DemoDb {
  universities: University[] = []
  courses: Course[] = []
  offerings: Offering[] = []
  assignments: AssignmentRow[] = []
  problems: ProblemRow[] = []
  synthetic = new Map<string, RawRating[]>()
  revisions: Revision[] = []
  proposals: Proposal[] = []
  reports: Report[] = []
  documents: Doc[] = []
  local: LocalState

  constructor(base: DemoDataset, local: LocalState) {
    this.local = local
    this.universities = base.universities.map((u) => ({ ...u, is_demo: false }))
    this.courses = base.courses.map((c) => ({ ...c }))
    this.offerings = base.offerings.map((o) => ({ ...o }))
    this.assignments = base.assignments.map((a) => ({ ...a, status: 'active', merged_into: null, source_document_id: null, created_by: null }))
    this.problems = base.problems.map((p) => ({
      ...p,
      statement_source: p.statement_markdown ? 'manual' : 'none',
      source_page_start: null,
      source_page_end: null,
      extraction_status: p.statement_markdown ? 'reviewed' : 'none',
      rating_epoch: 1,
      status: 'active',
      merged_into: null,
      created_by: null,
      updated_at: '2026-09-01T12:00:00Z',
    }))
    for (const r of base.ratings) {
      const list = this.synthetic.get(r.problem_id) ?? []
      list.push(r)
      this.synthetic.set(r.problem_id, list)
    }
    for (const e of local.events) {
      try {
        this.apply(e)
      } catch (err) {
        console.warn('Skipping demo event that no longer applies', e, err)
      }
    }
  }

  // ───────── derived reads
  stats(problemId: string) {
    const p = this.problems.find((x) => x.id === problemId)
    const list = [...(this.synthetic.get(problemId) ?? [])]
    const mine = this.local.ratings[problemId]
    if (mine && p && mine.epoch === p.rating_epoch) list.push(mine)
    return computeProblemStats(list)
  }

  visible<T extends { status: ContentStatus }>(row: T) {
    return row.status === 'active' || this.local.role !== 'user'
  }

  children(id: string) {
    return this.problems.filter((p) => p.parent_problem_id === id && !p.merged_into)
  }

  context(problemId: string | null, assignmentId?: string | null): ProblemContext | null {
    const p = problemId ? this.problems.find((x) => x.id === problemId) : null
    const a = this.assignments.find((x) => x.id === (p?.assignment_id ?? assignmentId))
    if (!a) return null
    const o = this.offerings.find((x) => x.id === a.course_offering_id)!
    const c = this.courses.find((x) => x.id === o.course_id)!
    const u = this.universities.find((x) => x.id === c.university_id)!
    return {
      assignment_id: a.id, assignment_title: a.title, assignment_slug: a.slug, offering_slug: o.slug, course_code: c.code, course_slug: c.slug,
      university_slug: u.slug, status: a.status, created_at: a.created_at,
      problem_count: this.problems.filter((x) => x.assignment_id === a.id && !x.merged_into).length,
      ...(p ? {
        problem_id: p.id, problem_label: p.label, problem_slug: p.slug,
        parent_label: p.parent_problem_id ? this.problems.find((x) => x.id === p.parent_problem_id)?.label ?? null : null,
        rating_count: this.stats(p.id)?.rating_count ?? 0,
      } : {}),
    }
  }

  freeSlug(taken: (s: string) => boolean, base: string, exclude?: string) {
    let s = base
    let i = 1
    while (taken(s) && s !== exclude) s = `${base}-${++i}`
    return s
  }

  problemSlug(assignmentId: string, label: string, parentSlug: string | null, excludeId?: string) {
    const l = label.trim().toLowerCase()
    const base = !parentSlug
      ? /^[0-9]+[a-z]?$/.test(l) ? `p${l}` : slugify(label)
      : /^[a-z]$/.test(l) && /[0-9]$/.test(parentSlug) ? parentSlug + l : `${parentSlug}-${slugify(label)}`
    return this.freeSlug((s) => this.problems.some((p) => p.assignment_id === assignmentId && p.slug === s && p.id !== excludeId), base)
  }

  // ───────── mutations (also used to replay the event log)
  apply(e: Event) {
    switch (e.t) {
      case 'university':
        this.universities.push(e.row)
        break
      case 'course':
        this.courses.push(e.row)
        break
      case 'offering':
        this.offerings.push(e.row)
        break
      case 'document':
        this.documents.push(e.row)
        break
      case 'publish':
        this.publish(e.payload, e.ids, e.at)
        break
      case 'addProblem': {
        const a = this.assignments.find((x) => x.id === e.input.assignmentId)
        if (!a) throw new ApiError('Assignment not found.')
        const siblings = this.problems.filter((p) => p.assignment_id === a.id && p.parent_problem_id === (e.input.parentId ?? null) && !p.merged_into)
        if (siblings.some((p) => p.label.toLowerCase() === e.input.label.trim().toLowerCase())) throw new ApiError('A problem with that label already exists.')
        this.insertProblem(a.id, e.input.parentId ?? null, {
          label: e.input.label, title: e.input.title ?? null, statement_markdown: e.input.statement ?? null, statement_source: 'manual',
          source_page_start: null, source_page_end: null,
        }, siblings.length + 1, true, e.id, e.at)
        break
      }
      case 'propose': {
        const p = this.problems.find((x) => x.id === e.problemId)
        if (!p) throw new ApiError('Problem not found.')
        const keys = Object.keys(e.changes)
        const fills = keys.length === 1 && keys[0] === 'statement_markdown' && !p.statement_markdown
        if (this.local.role !== 'user' || fills) this.applyChange(p, e.changes, e.note, e.material && this.local.role !== 'user', 'statement', e.at)
        else this.proposals.push({ id: e.id, problem_id: p.id, changes: e.changes, note: e.note, material_change: e.material, status: 'pending', created_at: e.at })
        break
      }
      case 'review': {
        const pr = this.proposals.find((x) => x.id === e.id && x.status === 'pending')
        if (!pr) throw new ApiError('Proposal not found or already reviewed.')
        if (e.approve) {
          const p = this.problems.find((x) => x.id === pr.problem_id)!
          this.applyChange(p, pr.changes, pr.note, e.material ?? pr.material_change, 'statement', e.at)
        }
        pr.status = e.approve ? 'approved' : 'rejected'
        break
      }
      case 'revert': {
        const r = this.revisions.find((x) => x.id === e.revisionId)
        if (!r?.before) throw new ApiError('Nothing to revert to.')
        const p = this.problems.find((x) => x.id === r.problem_id)!
        this.applyChange(p, r.before, `Reverted to version from ${r.created_at.slice(0, 16).replace('T', ' ')}`, false, 'revert', e.at)
        break
      }
      case 'report':
        this.reports.push(e.row)
        break
      case 'resolve': {
        const r = this.reports.find((x) => x.id === e.id)
        if (r) r.status = e.status
        break
      }
      case 'status': {
        const table = { universities: this.universities, courses: this.courses, course_offerings: this.offerings, assignments: this.assignments, problems: this.problems }[e.type] as Array<{ id: string; status: ContentStatus }> | undefined
        const row = table?.find((x) => x.id === e.id)
        if (row) row.status = e.status
        break
      }
      case 'mergeProblems':
        this.mergeProblems(e.s, e.t2)
        break
      case 'mergeAssignments':
        this.mergeAssignments(e.s, e.t2)
        break
    }
  }

  applyChange(p: ProblemRow, changes: ProblemChanges, note: string | null, material: boolean, kind: string, at: string) {
    const before = { label: p.label, title: p.title, statement_markdown: p.statement_markdown }
    if (changes.label && changes.label !== p.label) {
      const parent = p.parent_problem_id ? this.problems.find((x) => x.id === p.parent_problem_id) : null
      if (this.problems.some((x) => x.assignment_id === p.assignment_id && x.parent_problem_id === p.parent_problem_id && x.id !== p.id && x.label.toLowerCase() === changes.label!.toLowerCase())) {
        throw new ApiError('A problem with that label already exists.')
      }
      p.label = changes.label.trim()
      p.slug = this.problemSlug(p.assignment_id, p.label, parent?.slug ?? null, p.id)
    }
    if ('title' in changes) p.title = changes.title?.trim() || null
    if ('statement_markdown' in changes) {
      p.statement_markdown = changes.statement_markdown?.trim() || null
      p.statement_source = p.statement_markdown ? (p.statement_source === 'none' ? 'manual' : p.statement_source) : 'none'
      p.extraction_status = p.statement_markdown ? 'reviewed' : 'none'
    }
    if (material) p.rating_epoch += 1
    p.updated_at = at
    this.revisions.push({
      id: nameUuid(`rev:${p.id}:${at}:${this.revisions.length}`), problem_id: p.id, editor: LOCAL_USER, kind, before,
      after: { label: p.label, title: p.title, statement_markdown: p.statement_markdown }, note, material_change: material, created_at: at,
    })
  }

  insertProblem(assignmentId: string, parentId: string | null, node: PublishProblemNode, order: number, publishStatement: boolean, id: string, at: string) {
    const parent = parentId ? this.problems.find((x) => x.id === parentId) : null
    const stmt = publishStatement ? node.statement_markdown?.trim() || null : null
    const row: ProblemRow = {
      id, assignment_id: assignmentId, parent_problem_id: parentId, label: node.label.trim(),
      slug: this.problemSlug(assignmentId, node.label, parent?.slug ?? null), display_order: order, title: node.title?.trim() || null,
      statement_markdown: stmt, statement_source: stmt ? node.statement_source || 'manual' : 'none', source_page_start: node.source_page_start,
      source_page_end: node.source_page_end, extraction_status: stmt ? 'reviewed' : 'none', rating_epoch: 1, status: 'active', merged_into: null,
      created_by: LOCAL_USER, updated_at: at,
    }
    this.problems.push(row)
    this.revisions.push({ id: nameUuid(`rev:create:${id}`), problem_id: id, editor: LOCAL_USER, kind: 'create', before: null, after: { label: row.label, title: row.title, statement_markdown: stmt }, note: null, material_change: false, created_at: at })
    return row
  }

  publish(payload: Parameters<Api['publishAssignment']>[0], ids: string[], at: string) {
    let idx = 0
    const nextId = () => ids[idx++] ?? nameUuid(`gen:${at}:${idx}`)
    const labels = payload.problems.map((p) => p.label.trim().toLowerCase())
    if (new Set(labels).size !== labels.length) throw new ApiError('Problem labels must be unique.', { hint: 'duplicate_labels' })
    let a: AssignmentRow | undefined
    if (payload.assignment_id) {
      a = this.assignments.find((x) => x.id === payload.assignment_id)
      if (!a) throw new ApiError('Assignment not found.')
    } else {
      const meta = payload.assignment!
      if (!payload.force_distinct) {
        const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        const dup = this.assignments.find((x) => x.course_offering_id === payload.offering_id && !x.merged_into && x.status !== 'hidden' &&
          (norm(x.title) === norm(meta.title) || (meta.assignment_number != null && x.assignment_number === meta.assignment_number && x.assignment_type === meta.assignment_type)))
        if (dup) throw new ApiError('This assignment may already exist.', { hint: 'duplicate_assignment', detail: dup.id })
      }
      const base = meta.assignment_number != null && meta.assignment_type !== 'other'
        ? `${meta.assignment_type === 'problem_set' ? 'pset' : meta.assignment_type === 'homework' ? 'hw' : meta.assignment_type === 'reading_response' ? 'response' : meta.assignment_type}-${slugify(String(meta.assignment_number))}`
        : slugify(meta.title)
      const existing = this.assignments.filter((x) => x.course_offering_id === payload.offering_id)
      a = {
        id: nextId(), course_offering_id: payload.offering_id, title: meta.title.trim(), slug: this.freeSlug((s) => existing.some((x) => x.slug === s), base),
        assignment_type: meta.assignment_type, assignment_number: meta.assignment_number,
        display_order: meta.assignment_number != null ? Math.round(meta.assignment_number * 100) : Math.max(0, ...existing.map((x) => x.display_order)) + 100,
        due_date: meta.due_date, description: meta.description, is_demo: false, status: 'active', merged_into: null,
        source_document_id: payload.source_document_id ?? null, created_by: LOCAL_USER, created_at: at,
      }
      this.assignments.push(a)
    }
    let created = 0
    const skipped: string[] = []
    let order = Math.max(0, ...this.problems.filter((p) => p.assignment_id === a!.id && !p.parent_problem_id).map((p) => p.display_order))
    for (const node of payload.problems) {
      const existing = this.problems.find((p) => p.assignment_id === a!.id && !p.parent_problem_id && !p.merged_into && p.label.toLowerCase() === node.label.trim().toLowerCase())
      if (!existing) {
        const row = this.insertProblem(a.id, null, node, ++order, payload.publish_statements, nextId(), at)
        created++
        node.children?.forEach((c, i) => {
          this.insertProblem(a!.id, row.id, c, i + 1, payload.publish_statements, nextId(), at)
          created++
        })
      } else {
        skipped.push(node.label)
        for (const c of node.children ?? []) {
          const kids = this.children(existing.id)
          if (!kids.some((k) => k.label.toLowerCase() === c.label.trim().toLowerCase())) {
            this.insertProblem(a.id, existing.id, c, kids.length + 1, payload.publish_statements, nextId(), at)
            created++
          }
        }
      }
    }
    if (payload.source_document_id) {
      const d = this.documents.find((x) => x.id === payload.source_document_id)
      if (d) d.assignment_id = a.id
      a.source_document_id = a.source_document_id ?? payload.source_document_id
    }
    return { assignment_id: a.id, assignment_slug: a.slug, created, skipped }
  }

  mergeProblems(sourceId: string, targetId: string): { moved_ratings: number; conflicts: number } {
    const s = this.problems.find((x) => x.id === sourceId && !x.merged_into)
    const t = this.problems.find((x) => x.id === targetId && !x.merged_into)
    if (!s || !t || s.id === t.id) throw new ApiError('Both problems must exist and not already be merged.')
    const moved = this.synthetic.get(s.id) ?? []
    this.synthetic.set(t.id, [...(this.synthetic.get(t.id) ?? []), ...moved])
    this.synthetic.delete(s.id)
    let conflicts = 0
    const mine = this.local.ratings[s.id]
    if (mine) {
      const theirs = this.local.ratings[t.id]
      if (theirs) conflicts++
      if (!theirs || mine.updated_at > theirs.updated_at) this.local.ratings[t.id] = { ...mine, problem_id: t.id, epoch: t.rating_epoch }
      delete this.local.ratings[s.id]
    }
    for (const child of this.children(s.id)) {
      const match = this.children(t.id).find((c) => c.label.toLowerCase() === child.label.toLowerCase())
      if (match) this.mergeProblems(child.id, match.id)
      else {
        child.parent_problem_id = t.id
        child.assignment_id = t.assignment_id
        child.slug = this.problemSlug(t.assignment_id, child.label, t.slug, child.id)
      }
    }
    if (!t.statement_markdown && s.statement_markdown) t.statement_markdown = s.statement_markdown
    s.merged_into = t.id
    s.status = 'hidden'
    return { moved_ratings: moved.length + (mine ? 1 : 0), conflicts }
  }

  mergeAssignments(sourceId: string, targetId: string) {
    const s = this.assignments.find((x) => x.id === sourceId && !x.merged_into)
    const t = this.assignments.find((x) => x.id === targetId && !x.merged_into)
    if (!s || !t || s.id === t.id) throw new ApiError('Both assignments must exist and not already be merged.')
    let merged = 0
    let moved = 0
    for (const p of this.problems.filter((x) => x.assignment_id === s.id && !x.parent_problem_id && !x.merged_into)) {
      const match = this.problems.find((x) => x.assignment_id === t.id && !x.parent_problem_id && !x.merged_into && x.label.toLowerCase() === p.label.toLowerCase())
      if (match) {
        this.mergeProblems(p.id, match.id)
        merged++
      } else {
        p.assignment_id = t.id
        p.slug = this.problemSlug(t.id, p.label, null, p.id)
        p.display_order = Math.max(0, ...this.problems.filter((x) => x.assignment_id === t.id && !x.parent_problem_id).map((x) => x.display_order)) + 1
        for (const c of this.children(p.id)) {
          c.assignment_id = t.id
          c.slug = this.problemSlug(t.id, c.label, p.slug, c.id)
        }
        moved++
      }
    }
    s.merged_into = t.id
    s.status = 'hidden'
    return { merged_problems: merged, moved_problems: moved }
  }
}

export function createDemoApi(): Api {
  let local = loadLocal()
  let db = new DemoDb(buildDemoDataset(), local)
  const listeners = new Set<(u: AuthUser | null) => void>()

  const persist = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(local))
    } catch {
      /* quota or disabled storage: demo still works for this tab */
    }
  }
  const user = (): AuthUser | null => (local.user ? { id: local.user.id, email: local.user.email, isDemo: true } : null)
  const requireUser = () => {
    if (!local.user) throw new ApiError('Sign in to contribute.', { hint: 'auth_required' })
    return local.user
  }
  const requireMod = () => {
    requireUser()
    if (local.role === 'user') throw new ApiError('Moderator permission required.', { hint: 'forbidden' })
  }
  const record = (e: Event) => {
    db.apply(e)
    local.events.push(e)
    persist()
  }
  const notify = () => listeners.forEach((cb) => cb(user()))

  const offeringsOf = (courseId: string) => db.offerings.filter((o) => o.course_id === courseId && db.visible(o))

  const api: Api = {
    mode: 'demo',
    auth: {
      googleEnabled: false,
      async getUser() {
        return user()
      },
      onChange(cb) {
        listeners.add(cb)
        return () => listeners.delete(cb)
      },
      async sendEmailLink(email) {
        // Demo: no email is sent. Signing in creates a local, browser-only identity.
        local.user = { id: LOCAL_USER, email: email || 'demo@example.edu' }
        persist()
        notify()
      },
      async verifyCode() {
        local.user = local.user ?? { id: LOCAL_USER, email: 'demo@example.edu' }
        persist()
        notify()
      },
      async signInWithGoogle() {
        throw new ApiError('Google sign-in is not available in demo mode.')
      },
      async signOut() {
        local.user = null
        local.role = 'user'
        persist()
        notify()
      },
    },

    async listUniversities() {
      return delay(db.universities.filter((u) => db.visible(u)))
    },
    async listCourses(universityId) {
      return delay(
        db.courses
          .filter((c) => c.university_id === universityId && db.visible(c))
          .map((c) => ({ ...c, offerings: offeringsOf(c.id) }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      )
    },
    async searchCourses(q, universityId) {
      const qn = normalizeCode(q)
      const ql = q.trim().toLowerCase()
      const results = db.courses
        .filter((c) => db.visible(c) && (!universityId || c.university_id === universityId))
        .map((c) => {
          const u = db.universities.find((x) => x.id === c.university_id)!
          const code = normalizeCode(c.code)
          const score = Math.max(
            !qn ? 0.3 : code === qn ? 1 : code.startsWith(qn) ? 0.92 : qn.length >= 2 && code.includes(qn) ? 0.8 : 0,
            trigramSimilarity(code, qn) * 0.8,
            ql.length >= 3 ? wordSimilarity(ql, c.name) * 0.85 : 0,
            ql.length >= 4 ? wordSimilarity(ql, c.description ?? '') * 0.5 : 0,
            ql.length >= 3 && (u.name.toLowerCase().includes(ql) || u.short_name?.toLowerCase() === ql) ? 0.6 : 0,
          )
          return {
            course_id: c.id, university_id: u.id, university_slug: u.slug, university_name: u.name, university_short_name: u.short_name, code: c.code,
            name: c.name, slug: c.slug, description: c.description,
            offerings: offeringsOf(c.id).map((o) => ({ id: o.id, slug: o.slug, term: o.term, year: o.year, section: o.section, instructor: o.instructor })),
            score,
          }
        })
        .filter((r) => r.score >= 0.3)
        .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code))
      return delay(results.slice(0, 20), 30)
    },
    async featuredOfferings(limit = 6) {
      const rows = db.offerings.filter((o) => db.visible(o)).map((o) => {
        const c = db.courses.find((x) => x.id === o.course_id)!
        const u = db.universities.find((x) => x.id === c.university_id)!
        const as = db.assignments.filter((a) => a.course_offering_id === o.id && !a.merged_into && a.status === 'active')
        const ps = db.problems.filter((p) => as.some((a) => a.id === p.assignment_id) && !p.merged_into && p.status === 'active')
        return {
          offering_id: o.id, offering_slug: o.slug, term: o.term, year: o.year, section: o.section, course_code: c.code, course_name: c.name,
          course_slug: c.slug, university_slug: u.slug, university_name: u.short_name ?? u.name, assignment_count: as.length, problem_count: ps.length,
          rating_count: ps.reduce((n, p) => n + (db.stats(p.id)?.rating_count ?? 0), 0), is_demo: as.some((a) => a.is_demo),
        }
      })
      return delay(rows.sort((a, b) => b.rating_count - a.rating_count || b.problem_count - a.problem_count || b.year - a.year).slice(0, limit))
    },
    async resolvePath(uniSlug, courseSlug, offeringSlug, assignmentSlug, problemSlug) {
      const u = db.universities.find((x) => x.slug === uniSlug.toLowerCase())
      if (!u) return delay(null)
      const c = db.courses.find((x) => x.university_id === u.id && x.slug === courseSlug.toLowerCase())
      if (!c) return delay({ university: u, course: null, offerings: [], offering: null, assignment: null, problem: null, redirected: false })
      const o = offeringSlug ? db.offerings.find((x) => x.course_id === c.id && x.slug === offeringSlug.toLowerCase()) ?? null : null
      let redirected = false
      let a = o && assignmentSlug ? db.assignments.find((x) => x.course_offering_id === o.id && x.slug === assignmentSlug.toLowerCase()) ?? null : null
      while (a?.merged_into) {
        a = db.assignments.find((x) => x.id === a!.merged_into) ?? null
        redirected = true
      }
      let p = a && problemSlug ? db.problems.find((x) => x.assignment_id === a!.id && x.slug === problemSlug.toLowerCase()) ?? null : null
      while (p?.merged_into) {
        p = db.problems.find((x) => x.id === p!.merged_into) ?? null
        redirected = true
      }
      if (p && a && p.assignment_id !== a.id) a = db.assignments.find((x) => x.id === p!.assignment_id) ?? a
      return delay({
        university: u, course: c, offerings: offeringsOf(c.id), offering: o, assignment: a ? { id: a.id, slug: a.slug } : null,
        problem: p ? { id: p.id, slug: p.slug } : null, redirected,
      })
    },
    async getOverview(offeringId) {
      const assignments: OverviewAssignment[] = db.assignments
        .filter((a) => a.course_offering_id === offeringId && !a.merged_into && a.status !== 'hidden')
        .sort((a, b) => a.display_order - b.display_order || (a.assignment_number ?? 1e9) - (b.assignment_number ?? 1e9) || a.created_at.localeCompare(b.created_at))
        .map((a) => ({
          id: a.id, title: a.title, slug: a.slug, assignment_type: a.assignment_type, assignment_number: a.assignment_number, display_order: a.display_order,
          due_date: a.due_date, description: a.description, is_demo: a.is_demo, status: a.status, created_at: a.created_at, source_document_id: a.source_document_id,
          problems: db.problems
            .filter((p) => p.assignment_id === a.id && !p.merged_into && p.status !== 'hidden')
            .sort((x, y) => x.display_order - y.display_order)
            .map((p) => ({
              id: p.id, parent_problem_id: p.parent_problem_id, label: p.label, slug: p.slug, display_order: p.display_order, title: p.title,
              has_statement: Boolean(p.statement_markdown), stats: db.stats(p.id),
            })),
        }))
      return delay({ assignments }, 80)
    },
    async getProblem(problemId) {
      const p = db.problems.find((x) => x.id === problemId)
      if (!p) return delay(null)
      const a = db.assignments.find((x) => x.id === p.assignment_id)!
      const doc = db.documents.find((d) => d.id === a.source_document_id)
      return delay({
        problem: {
          id: p.id, assignment_id: p.assignment_id, parent_problem_id: p.parent_problem_id, label: p.label, slug: p.slug, title: p.title,
          statement_markdown: p.statement_markdown, statement_source: p.statement_source, source_page_start: p.source_page_start,
          source_page_end: p.source_page_end, source_location: null, extraction_status: p.extraction_status, rating_epoch: p.rating_epoch, updated_at: p.updated_at,
        },
        parent_label: p.parent_problem_id ? db.problems.find((x) => x.id === p.parent_problem_id)?.label ?? null : null,
        stats: db.stats(p.id),
        source_document: doc ? { id: doc.id, filename: doc.filename, file_type: doc.file_type, storage_path: doc.storage_path, visibility: doc.visibility, page_count: doc.page_count } : null,
        revision_count: db.revisions.filter((r) => r.problem_id === p.id).length,
        pending_proposals: db.proposals.filter((x) => x.problem_id === p.id && x.status === 'pending').length,
      })
    },
    async getHistory(problemId) {
      const rows: RevisionEntry[] = db.revisions
        .filter((r) => r.problem_id === problemId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => ({ id: r.id, kind: r.kind, before: r.before, after: r.after, note: r.note, material_change: r.material_change, created_at: r.created_at, is_mine: r.editor === LOCAL_USER }))
      return delay(rows)
    },
    async searchProblems(q, offeringId) {
      const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2)
      if (!words.length) return []
      const hits = db.problems
        .filter((p) => p.statement_markdown && !p.merged_into && p.status === 'active')
        .map((p) => {
          const text = `${p.title ?? ''} ${p.statement_markdown}`.toLowerCase()
          return { p, score: words.filter((w) => text.includes(w)).length / words.length }
        })
        .filter(({ p, score }) => score >= 0.99 && (!offeringId || db.assignments.find((a) => a.id === p.assignment_id)?.course_offering_id === offeringId))
        .slice(0, 20)
      return delay(
        hits.map(({ p }) => {
          const ctx = db.context(p.id)!
          const text = p.statement_markdown!
          const i = Math.max(0, text.toLowerCase().indexOf(words[0]) - 60)
          return {
            problem_id: p.id, label: p.label, parent_label: ctx.parent_label ?? null, problem_slug: p.slug, assignment_title: ctx.assignment_title,
            assignment_slug: ctx.assignment_slug, offering_slug: ctx.offering_slug, course_code: ctx.course_code, course_slug: ctx.course_slug,
            university_slug: ctx.university_slug, snippet: (i > 0 ? '…' : '') + text.slice(i, i + 160) + (text.length > i + 160 ? '…' : ''),
          }
        }),
      )
    },
    async documentUrl(path) {
      return db.documents.find((d) => d.storage_path === path)?.dataUrl ?? null
    },

    async myRatings(offeringId) {
      if (!local.user) return []
      const ids = new Set(db.assignments.filter((a) => a.course_offering_id === offeringId).map((a) => a.id))
      return delay(
        Object.values(local.ratings)
          .filter((r) => ids.has(db.problems.find((p) => p.id === r.problem_id)?.assignment_id ?? ''))
          .map((r) => ({ ...r, stale: r.epoch !== db.problems.find((p) => p.id === r.problem_id)?.rating_epoch })),
        20,
      )
    },
    async rate({ problemId, difficulty, timeMinutes, completion }) {
      requireUser()
      const p = db.problems.find((x) => x.id === problemId)
      if (!p || p.merged_into) throw new ApiError('Problem not found.')
      if (db.children(p.id).length) throw new ApiError('Rate the individual parts of this problem.', { hint: 'rate_parts' })
      if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10) throw new ApiError('Difficulty must be an integer from 1 to 10.')
      local.ratings[problemId] = {
        problem_id: problemId, difficulty, time_minutes: timeMinutes, completion_status: completion as CompletionStatus | null, stale: false,
        updated_at: now(), epoch: p.rating_epoch,
      }
      persist()
      return delay(db.stats(problemId), 120)
    },
    async clearRating(problemId) {
      requireUser()
      delete local.ratings[problemId]
      persist()
      return delay(db.stats(problemId), 80)
    },
    async myRatedOfferings() {
      if (!local.user) return []
      const byOffering = new Map<string, { rated: number; last: string }>()
      for (const r of Object.values(local.ratings)) {
        const p = db.problems.find((x) => x.id === r.problem_id)
        const a = p && db.assignments.find((x) => x.id === p.assignment_id)
        if (!a) continue
        const cur = byOffering.get(a.course_offering_id) ?? { rated: 0, last: '' }
        byOffering.set(a.course_offering_id, { rated: cur.rated + 1, last: r.updated_at > cur.last ? r.updated_at : cur.last })
      }
      return delay(
        [...byOffering.entries()]
          .map(([id, v]) => {
            const offering = db.offerings.find((o) => o.id === id)!
            const course = db.courses.find((c) => c.id === offering.course_id)!
            const university = db.universities.find((u) => u.id === course.university_id)!
            return { offering, course, university, rated: v.rated, last_rated_at: v.last }
          })
          .sort((a, b) => b.last_rated_at.localeCompare(a.last_rated_at)),
      )
    },

    async getProfile() {
      if (!local.user) return null
      return { id: local.user.id, display_name: local.profile.display_name, show_name: local.profile.show_name, role: local.role }
    },
    async updateProfile(patch) {
      requireUser()
      local.profile = { ...local.profile, ...patch, display_name: patch.display_name === undefined ? local.profile.display_name : patch.display_name }
      persist()
    },
    async savedCourses() {
      if (!local.user) return []
      return delay(
        local.saved
          .map((id) => db.courses.find((c) => c.id === id))
          .filter((c): c is Course => Boolean(c))
          .map((course) => ({ course, university: db.universities.find((u) => u.id === course.university_id)!, offerings: offeringsOf(course.id) })),
      )
    },
    async setSaved(courseId, saved) {
      requireUser()
      local.saved = saved ? [courseId, ...local.saved.filter((x) => x !== courseId)] : local.saved.filter((x) => x !== courseId)
      persist()
    },

    async createUniversity({ name, short_name, domain }) {
      requireUser()
      const existing = db.universities.find((u) => u.name.toLowerCase() === name.trim().toLowerCase() || trigramSimilarity(u.name, name) > 0.75 || (domain && u.domain === domain.toLowerCase()))
      if (existing) return { id: existing.id, slug: existing.slug, existing: true, status: existing.status }
      const slug = db.freeSlug((s) => db.universities.some((u) => u.slug === s), slugify(short_name || name))
      const status: ContentStatus = local.role === 'user' ? 'pending' : 'active'
      const row: University = { id: uuid(), name: name.trim(), short_name: short_name?.trim() || null, slug, domain: domain?.trim().toLowerCase() || null, status }
      record({ t: 'university', row })
      return { id: row.id, slug, existing: false, status }
    },
    async createCourse({ universityId, code, name, description, department }) {
      requireUser()
      const c = code.trim().replace(/\s+/g, ' ').toUpperCase()
      if (!normalizeCode(c)) throw new ApiError('Course code is required.')
      const existing = db.courses.find((x) => x.university_id === universityId && normalizeCode(x.code) === normalizeCode(c))
      if (existing) return { id: existing.id, slug: existing.slug, existing: true }
      const slug = db.freeSlug((s) => db.courses.some((x) => x.university_id === universityId && x.slug === s), slugify(c))
      const row: Course = { id: uuid(), university_id: universityId, code: c, name: name.trim(), description: description?.trim() || null, department: department?.trim() || null, slug, status: 'active' }
      record({ t: 'course', row })
      return { id: row.id, slug, existing: false }
    },
    async createOffering({ courseId, year, term, section = '', instructor }) {
      requireUser()
      const y = new Date().getFullYear()
      if (year < y - 30 || year > y + 2) throw new ApiError(`Choose a year between ${y - 30} and ${y + 2}.`)
      const existing = db.offerings.find((o) => o.course_id === courseId && o.year === year && o.term === term && o.section === section.trim())
      if (existing) return { id: existing.id, slug: existing.slug, existing: true }
      const base = `${term.replace('_', '-')}-${year}${section.trim() ? '-' + slugify(section) : ''}`
      const slug = db.freeSlug((s) => db.offerings.some((o) => o.course_id === courseId && o.slug === s), base)
      const academic_year = term === 'fall' || term === 'full_year' ? `${year}-${String((year + 1) % 100).padStart(2, '0')}` : `${year - 1}-${String(year % 100).padStart(2, '0')}`
      const row: Offering = { id: uuid(), course_id: courseId, year, term, academic_year, section: section.trim(), instructor: instructor?.trim() || null, slug, status: 'active' }
      record({ t: 'offering', row })
      return { id: row.id, slug, existing: false }
    },
    async registerDocument(input) {
      requireUser()
      const id = uuid()
      const path = input.storeFile && input.fileType !== 'pasted' ? `${LOCAL_USER}/${id}/${input.filename.replace(/[^A-Za-z0-9._-]+/g, '_')}` : null
      // Files themselves are not persisted in demo mode (localStorage is too small); only the record is.
      record({ t: 'document', row: { id, course_offering_id: input.offeringId, assignment_id: null, filename: input.filename, file_type: input.fileType, storage_path: path, visibility: input.visibility, page_count: input.pageCount, checksum: input.checksum } })
      return { id, storage_path: path }
    },
    async uploadDocument(path, file) {
      const doc = db.documents.find((d) => d.storage_path === path)
      if (doc && file.size < 4_000_000) doc.dataUrl = URL.createObjectURL(file) // session-only preview
    },
    async findDuplicates({ offeringId, title, type, number, checksum, labels, textSample }) {
      const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
      const out = db.assignments
        .filter((a) => !a.merged_into && a.status !== 'hidden' && (a.course_offering_id === offeringId || (checksum && db.documents.some((d) => d.assignment_id === a.id && d.checksum === checksum))))
        .map((a) => {
          const reasons: string[] = []
          let score = 0
          const sameFile = Boolean(checksum && db.documents.some((d) => d.assignment_id === a.id && d.checksum === checksum))
          if (sameFile) {
            reasons.push('The same file was uploaded before')
            score += 1
          }
          const sim = trigramSimilarity(norm(a.title), norm(title))
          if (norm(a.title) === norm(title)) {
            reasons.push('Same title')
            score += 0.9
          } else if (sim >= 0.5) {
            reasons.push('Similar title')
            score += Math.max(sim - 0.3, 0)
          }
          if (number != null && a.assignment_number === number && (!type || a.assignment_type === type)) {
            reasons.push('Same assignment number')
            score += 0.8
          }
          const theirLabels = db.problems.filter((p) => p.assignment_id === a.id && !p.parent_problem_id).map((p) => p.label.toLowerCase())
          if (labels.length && labels.filter((l) => theirLabels.includes(l.toLowerCase())).length >= Math.max(2, Math.floor(labels.length / 2))) reasons.push('Matching problem labels')
          const body = db.problems.filter((p) => p.assignment_id === a.id).map((p) => p.statement_markdown ?? '').join(' ')
          if (textSample && textSample.length > 80 && body.length > 80) {
            const ts = textSimilarity(body, textSample)
            if (ts >= 0.35) reasons.push('Similar problem text')
            score += Math.max(ts - 0.2, 0)
          }
          const o = db.offerings.find((x) => x.id === a.course_offering_id)!
          return {
            assignment_id: a.id, title: a.title, slug: a.slug, offering_id: o.id, offering_label: offeringLabel(o), same_offering: o.id === offeringId,
            problem_count: db.problems.filter((p) => p.assignment_id === a.id && !p.merged_into).length, score, reasons,
          }
        })
        .filter((d) => d.score >= 0.6 || d.reasons.includes('The same file was uploaded before'))
        .sort((x, y) => y.score - x.score)
      return delay(out.slice(0, 5), 120)
    },
    async publishAssignment(payload) {
      requireUser()
      const count = payload.problems.reduce((n, p) => n + 1 + (p.children?.length ?? 0), 0)
      if (!count) throw new ApiError('Add at least one problem.')
      if (count > 300) throw new ApiError('An assignment can have at most 300 problems.')
      const ids = Array.from({ length: count + 1 }, uuid)
      const at = now()
      // Validation errors are thrown before any row is added, so a failed publish records no event.
      const result = db.publish(structuredClone(payload), ids, at)
      local.events.push({ t: 'publish', payload, ids, at })
      persist()
      return delay(result, 200)
    },
    async addProblem(input) {
      requireUser()
      const id = uuid()
      record({ t: 'addProblem', input, id, at: now() })
      const p = db.problems.find((x) => x.id === id)!
      return { id, slug: p.slug }
    },
    async proposeEdit(problemId, changes, note, material) {
      requireUser()
      const id = uuid()
      const before = db.proposals.length
      record({ t: 'propose', problemId, changes, note, material, id, at: now() })
      return db.proposals.length > before ? { applied: false, proposal_id: id } : { applied: true }
    },
    async report(input) {
      requireUser()
      record({
        t: 'report',
        row: {
          id: uuid(), problem_id: input.problemId ?? null, assignment_id: input.assignmentId ?? null, kind: input.kind, details: input.details || null,
          duplicate_of_problem_id: input.duplicateOfProblemId ?? null, duplicate_of_assignment_id: input.duplicateOfAssignmentId ?? null, status: 'open', created_at: now(),
        },
      })
    },
    async submitFeedback(message, page) {
      local.feedback.push({ message, page, at: now() })
      persist()
    },

    async moderationQueue() {
      requireMod()
      const q: ModerationQueue = {
        proposals: db.proposals.filter((p) => p.status === 'pending').map((p) => {
          const prob = db.problems.find((x) => x.id === p.problem_id)!
          return { ...p, current: { label: prob.label, title: prob.title, statement_markdown: prob.statement_markdown }, context: db.context(prob.id)! }
        }),
        reports: db.reports.filter((r) => r.status === 'open').map((r) => ({
          ...r,
          context: db.context(r.problem_id, r.assignment_id),
          duplicate_context: r.duplicate_of_problem_id || r.duplicate_of_assignment_id ? db.context(r.duplicate_of_problem_id, r.duplicate_of_assignment_id) : null,
        })),
        universities: db.universities.filter((u) => u.status === 'pending'),
        recent_assignments: db.assignments.filter((a) => !a.is_demo && !a.merged_into).map((a) => db.context(null, a.id)!).reverse(),
        recent_courses: db.courses.filter((c) => !db.courses.slice(0, 7).includes(c)).map((c) => ({
          id: c.id, code: c.code, name: c.name, slug: c.slug, status: c.status, university_slug: db.universities.find((u) => u.id === c.university_id)!.slug, created_at: now(),
        })),
      }
      return delay(q)
    },
    async reviewProposal(id, approve, note, material) {
      requireMod()
      record({ t: 'review', id, approve, note, material, at: now() })
    },
    async revertRevision(revisionId) {
      requireMod()
      record({ t: 'revert', revisionId, at: now(), id: uuid() })
    },
    async resolveReport(id, status) {
      requireMod()
      record({ t: 'resolve', id, status })
    },
    async setContentStatus(type, id, status) {
      requireMod()
      record({ t: 'status', type, id, status })
    },
    async mergeProblems(s, t) {
      requireMod()
      const res = db.mergeProblems(s, t)
      local.events.push({ t: 'mergeProblems', s, t2: t })
      persist()
      return res
    },
    async mergeAssignments(s, t) {
      requireMod()
      const res = db.mergeAssignments(s, t)
      local.events.push({ t: 'mergeAssignments', s, t2: t })
      persist()
      return res
    },

    demo: {
      setRole(role) {
        local.role = role
        persist()
        notify()
      },
      reset() {
        local = freshLocal()
        persist()
        db = new DemoDb(buildDemoDataset(), local)
        notify()
      },
    },
  }
  return api
}
