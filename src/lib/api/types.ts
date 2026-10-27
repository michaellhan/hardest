import type {
  AppRole,
  AuthUser,
  Course,
  CourseSearchResult,
  DocumentVisibility,
  DuplicateCandidate,
  FeaturedOffering,
  FileKind,
  ModerationQueue,
  MyRating,
  Offering,
  OfferingOverview,
  ProblemDetail,
  ProblemSearchResult,
  ProblemStats,
  Profile,
  PublishPayload,
  PublishResult,
  RatingInput,
  ReportKind,
  ResolvedPath,
  RevisionEntry,
  Term,
  University,
} from '../types'

export class ApiError extends Error {
  code?: string
  hint?: string
  detail?: string
  constructor(message: string, opts: { code?: string; hint?: string; detail?: string } = {}) {
    super(message)
    this.name = 'ApiError'
    Object.assign(this, opts)
  }
}

export interface CourseWithOfferings extends Course {
  offerings: Offering[]
}

export interface RatedOffering {
  offering: Offering
  course: Course
  university: University
  rated: number
  last_rated_at: string
}

export interface SavedCourse {
  course: Course
  university: University
  offerings: Offering[]
}

export interface ProblemChanges {
  label?: string
  title?: string | null
  statement_markdown?: string | null
}

export interface AuthAdapter {
  getUser(): Promise<AuthUser | null>
  onChange(cb: (user: AuthUser | null) => void): () => void
  /** Sends a magic link + one-time code. `next` is the in-app path to return to. */
  sendEmailLink(email: string, next: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  signInWithGoogle(next: string): Promise<void>
  signOut(): Promise<void>
  googleEnabled: boolean
}

export interface Api {
  mode: 'supabase' | 'demo'
  auth: AuthAdapter

  // ── reads (public)
  listUniversities(): Promise<University[]>
  listCourses(universityId: string): Promise<CourseWithOfferings[]>
  searchCourses(q: string, universityId?: string | null): Promise<CourseSearchResult[]>
  featuredOfferings(limit?: number): Promise<FeaturedOffering[]>
  resolvePath(uni: string, course: string, offering?: string, assignment?: string, problem?: string): Promise<ResolvedPath | null>
  getOverview(offeringId: string): Promise<OfferingOverview>
  getProblem(problemId: string): Promise<ProblemDetail | null>
  getHistory(problemId: string): Promise<RevisionEntry[]>
  searchProblems(q: string, offeringId?: string | null): Promise<ProblemSearchResult[]>
  documentUrl(storagePath: string): Promise<string | null>

  // ── ratings (signed in)
  myRatings(offeringId: string): Promise<MyRating[]>
  rate(input: RatingInput): Promise<ProblemStats | null>
  clearRating(problemId: string): Promise<ProblemStats | null>
  myRatedOfferings(): Promise<RatedOffering[]>

  // ── my stuff
  getProfile(): Promise<Profile | null>
  updateProfile(patch: { display_name?: string | null; show_name?: boolean }): Promise<void>
  savedCourses(): Promise<SavedCourse[]>
  setSaved(courseId: string, saved: boolean): Promise<void>

  // ── contributions
  createUniversity(input: { name: string; short_name?: string; domain?: string }): Promise<{ id: string; slug: string; existing: boolean; status: string }>
  createCourse(input: { universityId: string; code: string; name: string; description?: string; department?: string }): Promise<{ id: string; slug: string; existing: boolean }>
  createOffering(input: { courseId: string; year: number; term: Term; section?: string; instructor?: string }): Promise<{ id: string; slug: string; existing: boolean }>
  registerDocument(input: {
    offeringId: string
    filename: string
    fileType: FileKind
    sizeBytes: number
    checksum: string | null
    pageCount: number | null
    visibility: DocumentVisibility
    storeFile: boolean
  }): Promise<{ id: string; storage_path: string | null }>
  uploadDocument(storagePath: string, file: File): Promise<void>
  findDuplicates(input: {
    offeringId: string
    title: string
    type: string | null
    number: number | null
    checksum: string | null
    labels: string[]
    textSample: string | null
  }): Promise<DuplicateCandidate[]>
  publishAssignment(payload: PublishPayload): Promise<PublishResult>
  addProblem(input: { assignmentId: string; label: string; parentId?: string | null; title?: string | null; statement?: string | null }): Promise<{ id: string; slug: string }>
  proposeEdit(problemId: string, changes: ProblemChanges, note: string | null, material: boolean): Promise<{ applied: boolean; proposal_id?: string }>
  report(input: {
    problemId?: string | null
    assignmentId?: string | null
    kind: ReportKind
    details: string
    duplicateOfProblemId?: string | null
    duplicateOfAssignmentId?: string | null
  }): Promise<void>
  submitFeedback(message: string, page: string): Promise<void>

  // ── moderation
  moderationQueue(): Promise<ModerationQueue>
  reviewProposal(id: string, approve: boolean, note: string | null, material: boolean | null): Promise<void>
  revertRevision(revisionId: string): Promise<void>
  resolveReport(id: string, status: 'resolved' | 'dismissed', note: string | null): Promise<void>
  setContentStatus(type: 'universities' | 'courses' | 'course_offerings' | 'assignments' | 'problems', id: string, status: 'active' | 'hidden'): Promise<void>
  mergeProblems(sourceId: string, targetId: string): Promise<{ moved_ratings: number; conflicts: number }>
  mergeAssignments(sourceId: string, targetId: string): Promise<{ merged_problems: number; moved_problems: number }>

  /** Demo mode only. */
  demo?: {
    setRole(role: AppRole): void
    reset(): void
  }
}
