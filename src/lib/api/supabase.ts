import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { config } from '../env'
import { normalizeStats } from '../stats'
import type { AuthUser, Course, MyRating, Offering, OfferingOverview, ProblemDetail, ProblemStats, University } from '../types'
import { ApiError, type Api, type AuthAdapter } from './types'

type PgError = { message: string; code?: string; hint?: string; details?: string } | null

function check<T>(res: { data: T; error: PgError }): T {
  if (res.error) throw new ApiError(res.error.message, { code: res.error.code, hint: res.error.hint ?? undefined, detail: res.error.details ?? undefined })
  return res.data
}

function authCheck(res: { error: { message: string } | null }) {
  if (res.error) throw new ApiError(res.error.message)
}

const toUser = (u: User | null | undefined): AuthUser | null => (u ? { id: u.id, email: u.email ?? null, isDemo: false } : null)

function overviewFrom(raw: OfferingOverview | null): OfferingOverview {
  const assignments = raw?.assignments ?? []
  for (const a of assignments) {
    a.assignment_number = a.assignment_number == null ? null : Number(a.assignment_number)
    for (const p of a.problems) p.stats = normalizeStats(p.stats)
  }
  return { assignments }
}

export function createSupabaseApi(): Api {
  const sb: SupabaseClient = createClient(config.supabaseUrl!, config.supabaseAnonKey!, {
    auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  const redirect = (next: string) => `${config.siteUrl}/?next=${encodeURIComponent(next)}`

  const auth: AuthAdapter = {
    googleEnabled: config.googleAuth,
    async getUser() {
      const { data } = await sb.auth.getSession()
      return toUser(data.session?.user)
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(toUser(session?.user)))
      return () => data.subscription.unsubscribe()
    },
    async sendEmailLink(email, next) {
      check(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect(next), shouldCreateUser: true } }))
    },
    async verifyCode(email, code) {
      check(await sb.auth.verifyOtp({ email, token: code, type: 'email' }))
    },
    async signInWithGoogle(next) {
      authCheck(await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect(next) } }))
    },
    async signOut() {
      authCheck(await sb.auth.signOut())
    },
  }

  const uid = async () => {
    const { data } = await sb.auth.getSession()
    return data.session?.user.id ?? null
  }

  const api: Api = {
    mode: 'supabase',
    auth,

    async listUniversities() {
      return check(await sb.from('universities').select('*').eq('status', 'active').order('name')) as University[]
    },
    async listCourses(universityId) {
      const rows = check(
        await sb.from('courses').select('*, offerings:course_offerings(*)').eq('university_id', universityId).eq('status', 'active').order('code'),
      ) as Array<Course & { offerings: Offering[] }>
      return rows.map((c) => ({ ...c, offerings: c.offerings.filter((o) => o.status === 'active') }))
    },
    async searchCourses(q, universityId) {
      return check(await sb.rpc('search_courses', { q, p_university: universityId ?? null, p_limit: 20 }))
    },
    async featuredOfferings(limit = 6) {
      return check(await sb.rpc('featured_offerings', { p_limit: limit }))
    },
    async resolvePath(uni, course, offering, assignment, problem) {
      return check(
        await sb.rpc('resolve_path', {
          p_university: uni, p_course: course, p_offering: offering ?? null, p_assignment: assignment ?? null, p_problem: problem ?? null,
        }),
      )
    },
    async getOverview(offeringId) {
      return overviewFrom(check(await sb.rpc('get_offering_overview', { p_offering: offeringId })))
    },
    async getProblem(problemId) {
      const d = check(await sb.rpc('get_problem_detail', { p_problem: problemId })) as ProblemDetail | null
      if (d) d.stats = normalizeStats(d.stats)
      return d
    },
    async getHistory(problemId) {
      return check(await sb.rpc('problem_history', { p_problem: problemId }))
    },
    async searchProblems(q, offeringId) {
      return check(await sb.rpc('search_problems', { q, p_offering: offeringId ?? null, p_limit: 20 }))
    },
    async documentUrl(path) {
      const { data, error } = await sb.storage.from('source-documents').createSignedUrl(path, 60 * 30)
      return error ? null : data.signedUrl
    },

    async myRatings(offeringId) {
      if (!(await uid())) return []
      return (check(await sb.rpc('my_ratings', { p_offering: offeringId })) as MyRating[]) ?? []
    },
    async rate({ problemId, difficulty, timeMinutes, completion }) {
      const s = check(
        await sb.rpc('rate_problem', { p_problem: problemId, p_difficulty: difficulty, p_time_minutes: timeMinutes, p_completion: completion }),
      ) as ProblemStats | null
      return normalizeStats(s)
    },
    async clearRating(problemId) {
      return normalizeStats(check(await sb.rpc('clear_rating', { p_problem: problemId })))
    },
    async myRatedOfferings() {
      const rows = (check(await sb.rpc('my_rated_offerings')) as Array<{ offering_id: string; rated: number; last_rated_at: string }>) ?? []
      if (!rows.length) return []
      const offs = check(
        await sb.from('course_offerings').select('*, course:courses(*, university:universities(*))').in('id', rows.map((r) => r.offering_id)),
      ) as Array<Offering & { course: Course & { university: University } }>
      return rows
        .map((r) => {
          const o = offs.find((x) => x.id === r.offering_id)
          if (!o) return null
          const { course, ...offering } = o
          const { university, ...c } = course
          return { offering: offering as Offering, course: c as Course, university, rated: r.rated, last_rated_at: r.last_rated_at }
        })
        .filter((x) => x != null)
        .sort((a, b) => b.last_rated_at.localeCompare(a.last_rated_at))
    },

    async getProfile() {
      const id = await uid()
      if (!id) return null
      return check(await sb.from('profiles').select('id, display_name, show_name, role').eq('id', id).maybeSingle())
    },
    async updateProfile(patch) {
      const id = await uid()
      if (!id) throw new ApiError('Sign in first.', { hint: 'auth_required' })
      check(await sb.from('profiles').update(patch).eq('id', id))
    },
    async savedCourses() {
      if (!(await uid())) return []
      const rows = check(
        await sb.from('saved_courses').select('course:courses(*, university:universities(*), offerings:course_offerings(*))').order('created_at', { ascending: false }),
      ) as unknown as Array<{ course: Course & { university: University; offerings: Offering[] } }>
      return rows
        .filter((r) => r.course)
        .map(({ course: { university, offerings, ...course } }) => ({ course: course as Course, university, offerings }))
    },
    async setSaved(courseId, saved) {
      const id = await uid()
      if (!id) throw new ApiError('Sign in to save courses.', { hint: 'auth_required' })
      if (saved) {
        const { error } = await sb.from('saved_courses').insert({ user_id: id, course_id: courseId })
        if (error && error.code !== '23505') check({ data: null, error })
      } else check(await sb.from('saved_courses').delete().eq('user_id', id).eq('course_id', courseId))
    },

    async createUniversity(input) {
      return check(await sb.rpc('create_university', { p_name: input.name, p_short_name: input.short_name ?? null, p_domain: input.domain ?? null }))
    },
    async createCourse(input) {
      return check(
        await sb.rpc('create_course', {
          p_university: input.universityId, p_code: input.code, p_name: input.name, p_description: input.description ?? null, p_department: input.department ?? null,
        }),
      )
    },
    async createOffering(input) {
      return check(
        await sb.rpc('create_offering', {
          p_course: input.courseId, p_year: input.year, p_term: input.term, p_section: input.section ?? '', p_instructor: input.instructor ?? null,
        }),
      )
    },
    async registerDocument(input) {
      return check(
        await sb.rpc('register_source_document', {
          p_offering: input.offeringId, p_filename: input.filename, p_file_type: input.fileType, p_size_bytes: input.sizeBytes,
          p_checksum: input.checksum, p_page_count: input.pageCount, p_visibility: input.visibility, p_store_file: input.storeFile,
        }),
      )
    },
    async uploadDocument(path, file) {
      const { error } = await sb.storage.from('source-documents').upload(path, file, {
        upsert: false,
        contentType: file.type || 'application/octet-stream',
      })
      if (error) throw new ApiError(`Upload failed: ${error.message}`)
    },
    async findDuplicates(input) {
      return check(
        await sb.rpc('find_assignment_duplicates', {
          p_offering: input.offeringId, p_title: input.title, p_type: input.type, p_number: input.number, p_checksum: input.checksum,
          p_labels: input.labels, p_text_sample: input.textSample,
        }),
      )
    },
    async publishAssignment(payload) {
      return check(await sb.rpc('publish_assignment', { payload }))
    },
    async addProblem(input) {
      return check(
        await sb.rpc('add_problem', {
          p_assignment: input.assignmentId, p_label: input.label, p_parent: input.parentId ?? null, p_title: input.title ?? null, p_statement: input.statement ?? null,
        }),
      )
    },
    async proposeEdit(problemId, changes, note, material) {
      return check(await sb.rpc('propose_edit', { p_problem: problemId, p_changes: changes, p_note: note, p_material: material }))
    },
    async report(input) {
      const id = await uid()
      if (!id) throw new ApiError('Sign in to report problems.', { hint: 'auth_required' })
      check(
        await sb.from('moderation_reports').insert({
          reporter_id: id, problem_id: input.problemId ?? null, assignment_id: input.assignmentId ?? null, kind: input.kind,
          details: input.details || null, duplicate_of_problem_id: input.duplicateOfProblemId ?? null,
          duplicate_of_assignment_id: input.duplicateOfAssignmentId ?? null,
        }),
      )
    },
    async submitFeedback(message, page) {
      const id = await uid()
      if (!id) throw new ApiError('Sign in to send feedback.', { hint: 'auth_required' })
      check(await sb.from('feedback').insert({ user_id: id, message, page }))
    },

    async moderationQueue() {
      return check(await sb.rpc('moderation_queue'))
    },
    async reviewProposal(id, approve, note, material) {
      check(await sb.rpc('review_proposal', { p_proposal: id, p_approve: approve, p_note: note, p_material: material }))
    },
    async revertRevision(id) {
      check(await sb.rpc('revert_revision', { p_revision: id }))
    },
    async resolveReport(id, status, note) {
      check(await sb.rpc('resolve_report', { p_report: id, p_status: status, p_note: note }))
    },
    async setContentStatus(type, id, status) {
      check(await sb.rpc('set_content_status', { p_type: type, p_id: id, p_status: status }))
    },
    async mergeProblems(s, t) {
      return check(await sb.rpc('merge_problems', { p_source: s, p_target: t }))
    },
    async mergeAssignments(s, t) {
      return check(await sb.rpc('merge_assignments', { p_source: s, p_target: t }))
    },
  }
  return api
}
