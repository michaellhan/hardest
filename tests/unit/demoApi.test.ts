import { beforeEach, describe, expect, it } from 'vitest'

// The demo API persists to localStorage; give node a tiny in-memory one.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage

const { createDemoApi } = await import('@/lib/api/demo')

async function setup() {
  const api = createDemoApi()
  const path = await api.resolvePath('harvard', 'math-55a', 'fall-2026', 'pset-4', 'p2')
  return { api, path: path! }
}

describe('demo API (in-browser sandbox)', () => {
  beforeEach(() => store.clear())

  it('resolves the canonical example URL', async () => {
    const { path } = await setup()
    expect(path.course?.code).toBe('MATH 55A')
    expect(path.offering?.slug).toBe('fall-2026')
    expect(path.problem).not.toBeNull()
  })

  it('requires sign-in to rate, keeps one rating per user, and updates aggregates', async () => {
    const { api, path } = await setup()
    const pid = path.problem!.id
    await expect(api.rate({ problemId: pid, difficulty: 7, timeMinutes: null, completion: null })).rejects.toMatchObject({ hint: 'auth_required' })
    const before = (await api.getProblem(pid))!.stats!.rating_count
    await api.auth.sendEmailLink('me@example.edu', '/')
    await api.rate({ problemId: pid, difficulty: 7, timeMinutes: 45, completion: null })
    await api.rate({ problemId: pid, difficulty: 3, timeMinutes: 45, completion: null })
    const after = (await api.getProblem(pid))!.stats!
    expect(after.rating_count).toBe(before + 1)
    const mine = await api.myRatings(path.offering!.id)
    expect(mine.filter((r) => r.problem_id === pid)).toHaveLength(1)
    expect(mine.find((r) => r.problem_id === pid)?.difficulty).toBe(3)
    await api.clearRating(pid)
    expect((await api.getProblem(pid))!.stats!.rating_count).toBe(before)
  })

  it('never exposes individual ratings in the public overview', async () => {
    const { api, path } = await setup()
    const ov = await api.getOverview(path.offering!.id)
    const json = JSON.stringify(ov)
    expect(json).not.toMatch(/user_id|demo-user/)
  })

  it('publishes an assignment, then detects it as a duplicate', async () => {
    const { api, path } = await setup()
    await api.auth.sendEmailLink('me@example.edu', '/')
    const payload = {
      offering_id: path.offering!.id,
      assignment: { title: 'Problem Set 42', assignment_type: 'problem_set' as const, assignment_number: 42, due_date: null, description: null },
      publish_statements: true,
      force_distinct: false,
      problems: [
        { label: '1', title: null, statement_markdown: 'Prove that every group of order $p^2$ is abelian.', statement_source: 'manual' as const, source_page_start: null, source_page_end: null },
        { label: '2', title: null, statement_markdown: null, statement_source: 'none' as const, source_page_start: null, source_page_end: null, children: [
          { label: 'a', title: null, statement_markdown: null, statement_source: 'none' as const, source_page_start: null, source_page_end: null },
        ] },
      ],
    }
    const res = await api.publishAssignment(payload)
    expect(res.assignment_slug).toBe('pset-42')
    expect(res.created).toBe(3)
    const dups = await api.findDuplicates({ offeringId: path.offering!.id, title: 'Problem Set 42', type: 'problem_set', number: 42, checksum: null, labels: ['1', '2'], textSample: null })
    expect(dups[0]?.assignment_id).toBe(res.assignment_id)
    await expect(api.publishAssignment(payload)).rejects.toMatchObject({ hint: 'duplicate_assignment' })
    // Adding to the existing assignment only creates what's missing.
    const more = await api.publishAssignment({ ...payload, assignment: undefined, assignment_id: res.assignment_id, problems: [...payload.problems, { ...payload.problems[0], label: '3' }] })
    expect(more.created).toBe(1)
    expect(more.skipped).toEqual(['1', '2'])
  })

  it('moderator-only actions are refused for normal users', async () => {
    const { api, path } = await setup()
    await api.auth.sendEmailLink('me@example.edu', '/')
    await expect(api.moderationQueue()).rejects.toMatchObject({ hint: 'forbidden' })
    api.demo!.setRole('moderator')
    await expect(api.moderationQueue()).resolves.toBeTruthy()
    expect(path.problem).toBeTruthy()
  })

  it('merging problems preserves ratings', async () => {
    const { api, path } = await setup()
    await api.auth.sendEmailLink('me@example.edu', '/')
    api.demo!.setRole('moderator')
    const ov = await api.getOverview(path.offering!.id)
    const ps = ov.assignments.find((a) => a.slug === 'pset-1')!
    const [src, dst] = ps.problems.filter((p) => !p.parent_problem_id && p.stats)
    const total = (src.stats?.rating_count ?? 0) + (dst.stats?.rating_count ?? 0)
    const res = await api.mergeProblems(src.id, dst.id)
    const merged = (await api.getProblem(dst.id))!.stats!
    // Voters who rated both keep one rating, so total = moved + kept.
    expect(merged.rating_count).toBe(total - res.conflicts)
    const redirect = await api.resolvePath('harvard', 'math-55a', 'fall-2026', 'pset-1', src.slug)
    expect(redirect?.problem?.id).toBe(dst.id)
    expect(redirect?.redirected).toBe(true)
  })
})
