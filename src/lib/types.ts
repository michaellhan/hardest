export type Term = 'fall' | 'spring' | 'summer' | 'winter' | 'january' | 'full_year'
export type AssignmentType =
  | 'problem_set'
  | 'homework'
  | 'lab'
  | 'essay'
  | 'project'
  | 'reading_response'
  | 'quiz'
  | 'exam'
  | 'other'
export type CompletionStatus = 'solved_independently' | 'solved_with_help' | 'attempted_not_solved' | 'not_attempted'
export type ContentStatus = 'pending' | 'active' | 'hidden'
export type StatementSource = 'none' | 'manual' | 'pdf' | 'latex' | 'markdown' | 'text' | 'docx' | 'ai_assisted'
export type DocumentVisibility = 'private' | 'public'
export type AppRole = 'user' | 'moderator' | 'admin'
export type ReportKind = 'incorrect_statement' | 'duplicate' | 'incorrect_parsing' | 'content_concern' | 'other'
export type FileKind = 'pdf' | 'tex' | 'markdown' | 'text' | 'docx' | 'pasted'

export interface University {
  id: string
  name: string
  short_name: string | null
  slug: string
  domain: string | null
  status: ContentStatus
  is_demo?: boolean
}

export interface Course {
  id: string
  university_id: string
  code: string
  name: string
  description: string | null
  slug: string
  department?: string | null
  status: ContentStatus
  is_demo?: boolean
}

export interface Offering {
  id: string
  course_id: string
  year: number
  term: Term
  academic_year: string
  section: string
  instructor: string | null
  slug: string
  status: ContentStatus
  is_demo?: boolean
}

/** Aggregates for one problem, computed in Postgres (problem_stats) or by lib/stats in demo mode. */
export interface ProblemStats {
  rating_count: number
  mean: number | null
  median: number | null
  stddev: number | null
  histogram: number[] // length 10, index 0 = difficulty 1
  time_count: number
  median_time_minutes: number | null
  completion: Partial<Record<CompletionStatus, number>>
}

export interface OverviewProblem {
  id: string
  parent_problem_id: string | null
  label: string
  slug: string
  display_order: number
  title: string | null
  has_statement: boolean
  stats: ProblemStats | null
}

export interface OverviewAssignment {
  id: string
  title: string
  slug: string
  assignment_type: AssignmentType
  assignment_number: number | null
  display_order: number
  due_date: string | null
  description: string | null
  is_demo: boolean
  status: ContentStatus
  created_at: string
  source_document_id: string | null
  problems: OverviewProblem[]
}

export interface OfferingOverview {
  assignments: OverviewAssignment[]
}

export interface ResolvedPath {
  university: University
  course: Course | null
  offerings: Offering[]
  offering: Offering | null
  assignment: { id: string; slug: string } | null
  problem: { id: string; slug: string } | null
  redirected: boolean
}

export interface SourceDocumentRef {
  id: string
  filename: string
  file_type: FileKind
  storage_path: string | null
  visibility: DocumentVisibility
  page_count: number | null
}

export interface ProblemDetail {
  problem: {
    id: string
    assignment_id: string
    parent_problem_id: string | null
    label: string
    slug: string
    title: string | null
    statement_markdown: string | null
    statement_source: StatementSource
    source_page_start: number | null
    source_page_end: number | null
    source_location: string | null
    extraction_status: string
    rating_epoch: number
    updated_at: string
  }
  parent_label: string | null
  stats: ProblemStats | null
  source_document: SourceDocumentRef | null
  revision_count: number
  pending_proposals: number
}

export interface MyRating {
  problem_id: string
  difficulty: number
  time_minutes: number | null
  completion_status: CompletionStatus | null
  stale: boolean
  updated_at: string
}

export interface RatingInput {
  problemId: string
  difficulty: number
  timeMinutes: number | null
  completion: CompletionStatus | null
}

export interface CourseSearchResult {
  course_id: string
  university_id: string
  university_slug: string
  university_name: string
  university_short_name: string | null
  code: string
  name: string
  slug: string
  description: string | null
  offerings: Array<{ id: string; slug: string; term: Term; year: number; section: string; instructor: string | null }>
  score: number
}

export interface ProblemSearchResult {
  problem_id: string
  label: string
  parent_label: string | null
  problem_slug: string
  assignment_title: string
  assignment_slug: string
  offering_slug: string
  course_code: string
  course_slug: string
  university_slug: string
  snippet: string
}

export interface FeaturedOffering {
  offering_id: string
  offering_slug: string
  term: Term
  year: number
  section: string
  course_code: string
  course_name: string
  course_slug: string
  university_slug: string
  university_name: string
  assignment_count: number
  problem_count: number
  rating_count: number
  is_demo: boolean
}

export interface RevisionEntry {
  id: string
  kind: string
  before: { label?: string; title?: string | null; statement_markdown?: string | null } | null
  after: { label?: string; title?: string | null; statement_markdown?: string | null } | null
  note: string | null
  material_change: boolean
  created_at: string
  is_mine: boolean
}

export interface DuplicateCandidate {
  assignment_id: string
  title: string
  slug: string
  offering_id: string
  offering_label: string
  same_offering: boolean
  problem_count: number
  score: number
  reasons: string[]
}

export interface PublishProblemNode {
  label: string
  title: string | null
  statement_markdown: string | null
  statement_source: StatementSource
  source_page_start: number | null
  source_page_end: number | null
  children?: PublishProblemNode[]
}

export interface PublishPayload {
  offering_id: string
  assignment_id?: string | null
  assignment?: {
    title: string
    assignment_type: AssignmentType
    assignment_number: number | null
    due_date: string | null
    description: string | null
  }
  source_document_id?: string | null
  publish_statements: boolean
  force_distinct: boolean
  problems: PublishProblemNode[]
}

export interface PublishResult {
  assignment_id: string
  assignment_slug: string
  created: number
  skipped: string[]
}

export interface ProblemContext {
  assignment_id: string
  assignment_title: string
  assignment_slug: string
  offering_slug: string
  course_code: string
  course_slug: string
  university_slug: string
  problem_count?: number
  problem_id?: string
  problem_label?: string
  problem_slug?: string
  parent_label?: string | null
  rating_count?: number
  status?: ContentStatus
  created_at?: string
}

export interface ModerationQueue {
  proposals: Array<{
    id: string
    problem_id: string
    changes: { label?: string; title?: string | null; statement_markdown?: string | null }
    note: string | null
    material_change: boolean
    created_at: string
    current: { label: string; title: string | null; statement_markdown: string | null }
    context: ProblemContext
  }>
  reports: Array<{
    id: string
    kind: ReportKind
    details: string | null
    created_at: string
    problem_id: string | null
    assignment_id: string | null
    duplicate_of_problem_id: string | null
    duplicate_of_assignment_id: string | null
    context: ProblemContext | null
    duplicate_context: ProblemContext | null
  }>
  universities: University[]
  recent_assignments: ProblemContext[]
  recent_courses: Array<{ id: string; code: string; name: string; slug: string; status: ContentStatus; university_slug: string; created_at: string }>
}

export interface Profile {
  id: string
  display_name: string | null
  show_name: boolean
  role: AppRole
}

export interface AuthUser {
  id: string
  email: string | null
  isDemo: boolean
}
