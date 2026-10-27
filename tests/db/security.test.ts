import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_TESTS, TestDb, problems, tag } from './helpers.ts'

const PERMISSION_DENIED = { code: '42501' }

describe.skipIf(!DB_TESTS)('row-level security and authorization', () => {
  let db: TestDb
  let alice: string
  let bob: string
  let mod: string
  let cat: Awaited<ReturnType<TestDb['createCatalog']>>
  let assignmentId: string
  let p: Record<string, { id: string }>

  beforeAll(async () => {
    db = new TestDb()
    alice = await db.createUser({ name: 'Alice Example' })
    bob = await db.createUser()
    mod = await db.createUser({ role: 'moderator' })
    cat = await db.createCatalog()
    const res = await db.publish(alice, {
      offering_id: cat.offering.id,
      assignment: { title: 'Problem Set 1', assignment_type: 'problem_set', assignment_number: 1 },
      problems: [{ label: '1', statement_markdown: 'Original statement.' }, { label: '2' }, { label: '3' }],
    })
    assignmentId = res.assignment_id
    p = await db.problemsBySlug(assignmentId)
    await db.rpc(alice, 'rate_problem', [p.p1.id, 7, 40, 'solved_with_help'])
    await db.rpc(bob, 'rate_problem', [p.p1.id, 3])
  })
  afterAll(() => db?.close())

  describe('anonymous visitors', () => {
    it('can read the public catalog, stats, and overview', async () => {
      await db.asAnon(async (q) => {
        expect(await q(`select id from public.universities where id = $1`, [cat.university.id])).toHaveLength(1)
        expect(await q(`select id from public.courses where id = $1`, [cat.course.id])).toHaveLength(1)
        expect(await q(`select id from public.course_offerings where id = $1`, [cat.offering.id])).toHaveLength(1)
        expect(await q(`select id from public.assignments where id = $1`, [assignmentId])).toHaveLength(1)
        expect(await q(`select id from public.problems where assignment_id = $1`, [assignmentId])).toHaveLength(3)
        expect(await q(`select rating_count from public.problem_stats where problem_id = $1`, [p.p1.id])).toEqual([{ rating_count: 2 }])
        const [{ o }] = await q<{ o: { assignments: Array<{ problems: Array<{ stats: { rating_count: number } | null }> }> } }>(
          `select public.get_offering_overview($1) as o`, [cat.offering.id])
        expect(o.assignments).toHaveLength(1)
        expect(o.assignments[0].problems[0].stats!.rating_count).toBe(2)
        const [{ d }] = await q<{ d: { problem: { statement_markdown: string }; revision_count: number; stats: { rating_count: number } } }>(
          `select public.get_problem_detail($1) as d`, [p.p1.id])
        expect(d.problem.statement_markdown).toBe('Original statement.')
        expect(d.stats.rating_count).toBe(2)
        // revisions themselves are moderator-only, but the count (and problem_history) are public
        expect(d.revision_count).toBe(1)
        expect(await q(`select id from public.problem_revisions where problem_id = $1`, [p.p1.id])).toEqual([])
        expect(await q(`select kind from public.problem_history($1)`, [p.p1.id])).toEqual([{ kind: 'create' }])
        const found = await q<{ course_id: string }>(`select course_id from public.search_courses($1)`, [cat.course.slug])
        expect(found.map((r) => r.course_id)).toContain(cat.course.id)
      })
    })

    it('cannot read the ratings table, profiles, or private schema', async () => {
      await expect(db.asAnon((q) => q(`select * from public.ratings`))).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(db.asAnon((q) => q(`select * from public.profiles`))).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(db.asAnon((q) => q(`select * from private.rate_limit_events`))).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(db.asAnon((q) => q(`select * from public.my_ratings($1)`, [cat.offering.id]))).rejects.toMatchObject(PERMISSION_DENIED)
    })

    it('cannot call write RPCs', async () => {
      const calls: Array<[string, unknown[]]> = [
        ['rate_problem', [p.p2.id, 5]],
        ['clear_rating', [p.p1.id]],
        ['publish_assignment', [JSON.stringify({ offering_id: cat.offering.id, assignment: { title: 'x' }, problems: [{ label: '1' }] })]],
        ['add_problem', [assignmentId, '9']],
        ['propose_edit', [p.p2.id, JSON.stringify({ statement_markdown: 'anon' })]],
        ['create_university', ['Anon University']],
        ['create_course', [cat.university.id, 'ANON 1', 'Anon']],
        ['create_offering', [cat.course.id, 2026, 'spring']],
        ['merge_problems', [p.p2.id, p.p3.id]],
        ['set_content_status', ['problems', p.p2.id, 'hidden']],
      ]
      for (const [fn, args] of calls) {
        await expect(db.rpc(null, fn, args), fn).rejects.toMatchObject(PERMISSION_DENIED)
      }
      expect(await db.sql(`select 1 from public.ratings where problem_id = $1`, [p.p2.id])).toEqual([])
    })

    it('cannot write tables directly', async () => {
      await expect(db.asAnon((q) => q(`insert into public.ratings (user_id, problem_id, difficulty) values ($1, $2, 5)`, [alice, p.p2.id]))).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(db.asAnon((q) => q(`update public.problems set label = 'x' where id = $1`, [p.p2.id]))).rejects.toMatchObject(PERMISSION_DENIED)
    })
  })

  describe('signed-in users', () => {
    it('see only their own ratings', async () => {
      const mine = await db.asUser(bob, (q) => q<{ user_id: string; difficulty: number }>(`select user_id, difficulty from public.ratings`))
      expect(mine).toEqual([{ user_id: bob, difficulty: 3 }])
      expect(await db.asUser(bob, (q) => q(`select * from public.ratings where user_id = $1`, [alice]))).toEqual([])
      const theirs = await db.asUser(bob, (q) => q<{ problem_id: string }>(`select * from public.my_ratings($1)`, [cat.offering.id]))
      expect(theirs).toHaveLength(1)
    })

    it("cannot create, change, or delete someone else's rating", async () => {
      await expect(
        db.asUser(bob, (q) => q(`insert into public.ratings (user_id, problem_id, difficulty) values ($1, $2, 1)`, [alice, p.p2.id])),
      ).rejects.toMatchObject(PERMISSION_DENIED) // new row violates row-level security policy
      const updated = await db.asUser(bob, (q) => q(`update public.ratings set difficulty = 1 where user_id = $1 returning id`, [alice]))
      expect(updated).toEqual([])
      const deleted = await db.asUser(bob, (q) => q(`delete from public.ratings where user_id = $1 returning id`, [alice]))
      expect(deleted).toEqual([])
      // nor move their own rating to someone else
      await expect(db.asUser(bob, (q) => q(`update public.ratings set user_id = $1 where user_id = $2`, [alice, bob]))).rejects.toMatchObject(PERMISSION_DENIED)
      expect(await db.one(`select difficulty from public.ratings where user_id = $1 and problem_id = $2`, [alice, p.p1.id])).toEqual({ difficulty: 7 })
    })

    it('cannot write content tables directly', async () => {
      const attempts = [
        [`insert into public.problems (assignment_id, label, slug) values ($1, 'x', 'px')`, [assignmentId]],
        [`update public.problems set statement_markdown = 'vandalized' where id = $1`, [p.p1.id]],
        [`delete from public.problems where id = $1`, [p.p1.id]],
        [`insert into public.assignments (course_offering_id, title, slug) values ($1, 'x', 'x')`, [cat.offering.id]],
        [`update public.assignments set title = 'x' where id = $1`, [assignmentId]],
        [`insert into public.universities (name, slug, status) values ('Fake U', 'fake-u-${tag()}', 'active')`, []],
        [`update public.courses set name = 'x' where id = $1`, [cat.course.id]],
        [`update public.problem_stats set rating_count = 1000 where problem_id = $1`, [p.p1.id]],
        [`insert into public.problem_stats (problem_id, rating_count) values ($1, 5)`, [p.p3.id]],
        [`insert into public.slug_aliases (entity_type, scope_id, old_slug, entity_id) values ('problem', $1, 'evil', $2)`, [assignmentId, p.p1.id]],
        [`insert into public.problem_revisions (problem_id, kind) values ($1, 'statement')`, [p.p1.id]],
        [`insert into public.edit_proposals (problem_id, changes) values ($1, '{}')`, [p.p1.id]],
        [`insert into public.moderation_actions (action, target_type, target_id) values ('x', 'x', $1)`, [p.p1.id]],
        [`insert into private.rate_limit_events (user_id, action) values ($1, 'x')`, [bob]],
        [`select private.refresh_problem_stats($1)`, [p.p1.id]],
      ] as const
      for (const [text, params] of attempts) {
        await expect(db.asUser(bob, (q) => q(text, [...params])), text).rejects.toMatchObject(PERMISSION_DENIED)
      }
      expect(await db.one(`select statement_markdown from public.problems where id = $1`, [p.p1.id])).toEqual({ statement_markdown: 'Original statement.' })
    })

    it('can edit their own display fields but not their role', async () => {
      await db.asUser(bob, (q) => q(`update public.profiles set display_name = 'Bob', show_name = true where id = $1`, [bob]))
      expect(await db.one(`select display_name, show_name from public.profiles where id = $1`, [bob])).toEqual({ display_name: 'Bob', show_name: true })
      await expect(db.asUser(bob, (q) => q(`update public.profiles set role = 'admin' where id = $1`, [bob]))).rejects.toMatchObject(PERMISSION_DENIED)
      await expect(db.asUser(bob, (q) => q(`update public.profiles set is_demo = true where id = $1`, [bob]))).rejects.toMatchObject(PERMISSION_DENIED)
      // other users' profiles are invisible
      expect(await db.asUser(bob, (q) => q(`select id from public.profiles where id = $1`, [alice]))).toEqual([])
      expect(await db.asUser(bob, (q) => q(`update public.profiles set display_name = 'x' where id = $1 returning id`, [alice]))).toEqual([])
    })

    it('cannot call moderator-only RPCs', async () => {
      const proposal = await db.rpc<{ proposal_id: string }>(bob, 'propose_edit', [p.p1.id, JSON.stringify({ statement_markdown: 'Bob version' })])
      const revision = await db.one<{ id: string }>(`select id from public.problem_revisions where problem_id = $1 limit 1`, [p.p1.id])
      const report = await db.asUser(bob, (q) =>
        q<{ id: string }>(`insert into public.moderation_reports (problem_id, kind) values ($1, 'duplicate') returning id`, [p.p2.id]))
      const calls: Array<[string, unknown[]]> = [
        ['merge_problems', [p.p2.id, p.p3.id]],
        ['merge_assignments', [assignmentId, assignmentId]],
        ['review_proposal', [proposal.proposal_id, true]],
        ['set_content_status', ['problems', p.p2.id, 'hidden']],
        ['revert_revision', [revision.id]],
        ['resolve_report', [report[0].id, 'dismissed']],
        ['moderation_queue', []],
      ]
      for (const [fn, args] of calls) {
        await expect(db.rpc(bob, fn, args), fn).rejects.toMatchObject({ code: '42501', hint: 'forbidden' })
      }
      await expect(db.rpc(bob, 'set_user_role', [bob, 'admin'])).rejects.toMatchObject({ code: '42501' })
      await expect(db.rpc(mod, 'set_user_role', [bob, 'admin'])).rejects.toMatchObject({ code: '42501' }) // admins only
      expect(await db.one(`select role from public.profiles where id = $1`, [bob])).toEqual({ role: 'user' })
      expect(await db.one(`select status from public.edit_proposals where id = $1`, [proposal.proposal_id])).toEqual({ status: 'pending' })
      expect(await db.one(`select status, merged_into from public.problems where id = $1`, [p.p2.id])).toEqual({ status: 'active', merged_into: null })

      // a moderator can
      const queue = await db.rpc<{ proposals: Array<{ id: string }> }>(mod, 'moderation_queue')
      expect(queue.proposals.map((x) => x.id)).toContain(proposal.proposal_id)
      await db.rpc(mod, 'resolve_report', [report[0].id, 'dismissed'])
      // reports and proposals are private to their author (and moderators)
      expect(await db.asUser(alice, (q) => q(`select id from public.edit_proposals where id = $1`, [proposal.proposal_id]))).toEqual([])
      expect(await db.asUser(alice, (q) => q(`select id from public.moderation_reports where id = $1`, [report[0].id]))).toEqual([])
      expect(await db.asUser(bob, (q) => q(`select id from public.edit_proposals where id = $1`, [proposal.proposal_id]))).toHaveLength(1)
      await db.rpc(mod, 'review_proposal', [proposal.proposal_id, false, 'not needed'])
    })

    it('an admin can change roles', async () => {
      const admin = await db.createUser({ role: 'admin' })
      const u = await db.createUser()
      await db.rpc(admin, 'set_user_role', [u, 'moderator'])
      expect(await db.one(`select role from public.profiles where id = $1`, [u])).toEqual({ role: 'moderator' })
      await db.rpc(admin, 'set_user_role', [u, 'user'])
    })

    it('hidden content is visible only to moderators', async () => {
      const res = await db.publish(alice, { offering_id: cat.offering.id, assignment: { title: `Hidden ${tag()}`, assignment_type: 'other' }, problems: problems('1') })
      const pid = (await db.problemsBySlug(res.assignment_id)).p1.id
      await db.rpc(mod, 'set_content_status', ['problems', pid, 'hidden'])
      expect(await db.asAnon((q) => q(`select id from public.problems where id = $1`, [pid]))).toEqual([])
      expect(await db.asUser(bob, (q) => q(`select id from public.problems where id = $1`, [pid]))).toEqual([])
      expect(await db.asUser(mod, (q) => q(`select id from public.problems where id = $1`, [pid]))).toHaveLength(1)
      const [{ o }] = await db.asAnon((q) => q<{ o: { assignments: Array<{ id: string; problems: unknown[] }> } }>(`select public.get_offering_overview($1) as o`, [cat.offering.id]))
      expect(o.assignments.find((a) => a.id === res.assignment_id)!.problems).toEqual([])
      expect(await db.one(`select action, moderator_id from public.moderation_actions where target_id = $1`, [pid])).toEqual({ action: 'set_status', moderator_id: mod })
    })
  })

  describe('pending universities', () => {
    it('are visible only to their creator and moderators until approved', async () => {
      const t = tag()
      const uni = await db.rpc<{ id: string; status: string }>(alice, 'create_university', [`Pending Institute ${t}`, `PI${t}`, `pi${t}.edu`])
      expect(uni.status).toBe('pending')
      const visible = (uid: string | null) => {
        const run = (q: (text: string, params?: unknown[]) => Promise<unknown[]>) => q(`select id from public.universities where id = $1`, [uni.id])
        return uid ? db.asUser(uid, run) : db.asAnon(run)
      }
      expect(await visible(alice)).toHaveLength(1)
      expect(await visible(mod)).toHaveLength(1)
      expect(await visible(bob)).toEqual([])
      expect(await visible(null)).toEqual([])

      // the creator can add a course; others cannot
      const course = await db.rpc<{ id: string }>(alice, 'create_course', [uni.id, 'PI 101', 'Pending Course'])
      await expect(db.rpc(bob, 'create_course', [uni.id, 'PI 102', 'Nope'])).rejects.toMatchObject({ code: 'P0002' })
      // and it doesn't show up in search for others
      const search = await db.asUser(bob, (q) => q<{ course_id: string }>(`select course_id from public.search_courses('PI 101')`))
      expect(search.map((r) => r.course_id)).not.toContain(course.id)

      await db.rpc(mod, 'set_content_status', ['universities', uni.id, 'active'])
      expect(await visible(bob)).toHaveLength(1)
      expect(await visible(null)).toHaveLength(1)
    })
  })

  it('get_offering_overview and problem_history never expose user ids', async () => {
    const [{ o }] = await db.asAnon((q) => q<{ o: unknown }>(`select public.get_offering_overview($1) as o`, [cat.offering.id]))
    const text = JSON.stringify(o)
    for (const uid of [alice, bob, mod]) expect(text).not.toContain(uid)
    expect(text).not.toMatch(/user_id|created_by|editor_id|proposer_id/)

    const [{ d }] = await db.asAnon((q) => q<{ d: unknown }>(`select public.get_problem_detail($1) as d`, [p.p1.id]))
    for (const uid of [alice, bob, mod]) expect(JSON.stringify(d)).not.toContain(uid)

    const history = await db.asUser(alice, (q) => q<Record<string, unknown>>(`select * from public.problem_history($1)`, [p.p1.id]))
    expect(history.length).toBeGreaterThan(0)
    for (const uid of [alice, bob, mod]) expect(JSON.stringify(history)).not.toContain(uid)
    expect(history.some((h) => h.is_mine === true)).toBe(true) // alice created the problem
    const bobs = await db.asUser(bob, (q) => q<{ is_mine: boolean }>(`select is_mine from public.problem_history($1)`, [p.p1.id]))
    expect(bobs.every((h) => h.is_mine === false)).toBe(true)
  })
})
