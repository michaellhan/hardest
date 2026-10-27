import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_TESTS, TestDb, problems, tag } from './helpers.ts'

describe.skipIf(!DB_TESTS)('edits, proposals, and merges', () => {
  let db: TestDb
  let owner: string
  let mod: string
  let offeringId: string

  beforeAll(async () => {
    db = new TestDb()
    owner = await db.createUser()
    mod = await db.createUser({ role: 'moderator' })
    offeringId = (await db.createCatalog()).offering.id
  })
  afterAll(() => db?.close())

  const problemRow = (id: string) =>
    db.one<{ label: string; title: string | null; statement_markdown: string | null; statement_source: string; extraction_status: string; rating_epoch: number }>(
      `select label, title, statement_markdown, statement_source, extraction_status, rating_epoch from public.problems where id = $1`,
      [id],
    )

  describe('propose_edit', () => {
    let p: Record<string, { id: string }>
    let raters: string[]

    beforeAll(async () => {
      const res = await db.publish(owner, {
        offering_id: offeringId,
        assignment: { title: `Edits ${tag()}`, assignment_type: 'homework', assignment_number: 1 },
        problems: problems('1', '2', '3'),
      })
      p = await db.problemsBySlug(res.assignment_id)
      raters = await db.createUsers(2)
    })

    it('filling an empty statement applies directly and is recorded', async () => {
      const u = await db.createUser()
      const res = await db.rpc(u, 'propose_edit', [p.p1.id, JSON.stringify({ statement_markdown: '  Compute $\\int_0^1 x\\,dx$.  ' }), 'from the PDF'])
      expect(res).toEqual({ applied: true })
      expect(await problemRow(p.p1.id)).toMatchObject({
        statement_markdown: 'Compute $\\int_0^1 x\\,dx$.', statement_source: 'manual', extraction_status: 'reviewed', rating_epoch: 1,
      })
      const rev = await db.one<{ kind: string; editor_id: string; before: { statement_markdown: string | null }; after: { statement_markdown: string }; note: string }>(
        `select kind, editor_id, before, after, note from public.problem_revisions where problem_id = $1 and kind <> 'create'`, [p.p1.id])
      expect(rev).toMatchObject({ kind: 'statement', editor_id: u, note: 'from the PDF' })
      expect(rev.before.statement_markdown).toBeNull()
      expect(rev.after.statement_markdown).toBe('Compute $\\int_0^1 x\\,dx$.')
    })

    it('a normal user cannot flag a material change when filling a statement', async () => {
      const u = await db.createUser()
      await db.rpc(raters[0], 'rate_problem', [p.p2.id, 4])
      expect(await db.rpc(u, 'propose_edit', [p.p2.id, JSON.stringify({ statement_markdown: 'Statement two.' }), null, true])).toEqual({ applied: true })
      expect((await problemRow(p.p2.id)).rating_epoch).toBe(1)
      expect((await db.stats(p.p2.id)).rating_count).toBe(1)
    })

    it('rejects unsupported fields and empty labels', async () => {
      const u = await db.createUser()
      await expect(db.rpc(u, 'propose_edit', [p.p3.id, JSON.stringify({ rating_epoch: 9 })])).rejects.toThrow(/Unsupported field/)
      await expect(db.rpc(u, 'propose_edit', [p.p3.id, JSON.stringify({ label: '  ' })])).rejects.toThrow(/Label cannot be empty/)
    })

    it('editing existing content creates a proposal; a moderator approval with a material change starts a new rating epoch', async () => {
      await db.rpc(raters[0], 'rate_problem', [p.p1.id, 5, 30])
      await db.rpc(raters[1], 'rate_problem', [p.p1.id, 7, 60])
      expect((await db.stats(p.p1.id)).rating_count).toBe(2)

      const editor = await db.createUser()
      const changes = { statement_markdown: 'Compute $\\int_0^2 x^2\\,dx$.' }
      const res = await db.rpc<{ applied: boolean; proposal_id: string }>(editor, 'propose_edit', [p.p1.id, JSON.stringify(changes), 'bounds were wrong', true])
      expect(res.applied).toBe(false)
      // nothing changed yet
      expect((await problemRow(p.p1.id)).statement_markdown).toBe('Compute $\\int_0^1 x\\,dx$.')
      await expect(db.rpc(editor, 'propose_edit', [p.p1.id, JSON.stringify(changes)])).rejects.toMatchObject({ hint: 'duplicate_proposal' })
      // the detail view counts pending proposals
      expect((await db.rpc<{ pending_proposals: number }>(null, 'get_problem_detail', [p.p1.id])).pending_proposals).toBe(1)

      await db.rpc(mod, 'review_proposal', [res.proposal_id, true, 'checked against the PDF'])
      expect(await problemRow(p.p1.id)).toMatchObject({ statement_markdown: changes.statement_markdown, rating_epoch: 2 })
      expect(await db.one(`select status, reviewer_id from public.edit_proposals where id = $1`, [res.proposal_id])).toEqual({ status: 'approved', reviewer_id: mod })
      const rev = await db.one<{ editor_id: string; material_change: boolean; note: string }>(
        `select editor_id, material_change, note from public.problem_revisions where problem_id = $1 order by created_at desc limit 1`, [p.p1.id])
      expect(rev).toEqual({ editor_id: editor, material_change: true, note: 'bounds were wrong — approved: checked against the PDF' })
      expect(await db.one(`select action from public.moderation_actions where target_id = $1`, [res.proposal_id])).toEqual({ action: 'approve_proposal' })

      // old ratings are kept but excluded from the aggregate, and shown as stale to their authors
      expect(await db.sql(`select epoch from public.ratings where problem_id = $1`, [p.p1.id])).toEqual([{ epoch: 1 }, { epoch: 1 }])
      const s = await db.stats(p.p1.id)
      expect(s).toMatchObject({ rating_count: 0, mean: null, median: null, time_count: 0 })
      expect(await db.rpc(null, 'get_problem_detail', [p.p1.id])).toMatchObject({ stats: null })
      const mine = await db.asUser(raters[0], (q) => q<{ problem_id: string; stale: boolean }>(`select problem_id, stale from public.my_ratings($1)`, [offeringId]))
      expect(mine.find((r) => r.problem_id === p.p1.id)!.stale).toBe(true)

      // re-rating counts again in the new epoch
      const after = await db.rpc<{ rating_count: number; mean: string }>(raters[0], 'rate_problem', [p.p1.id, 9])
      expect(after.rating_count).toBe(1)
      expect(Number(after.mean)).toBe(9)
      expect(await db.one(`select epoch from public.ratings where problem_id = $1 and user_id = $2`, [p.p1.id, raters[0]])).toEqual({ epoch: 2 })
    })

    it('a rejected proposal changes nothing; a moderator edit applies directly; revert restores', async () => {
      const editor = await db.createUser()
      const before = await problemRow(p.p2.id)
      const res = await db.rpc<{ proposal_id: string }>(editor, 'propose_edit', [p.p2.id, JSON.stringify({ title: 'Spam title' })])
      await db.rpc(mod, 'review_proposal', [res.proposal_id, false, 'no'])
      expect(await problemRow(p.p2.id)).toEqual(before)
      expect(await db.one(`select status from public.edit_proposals where id = $1`, [res.proposal_id])).toEqual({ status: 'rejected' })
      await expect(db.rpc(mod, 'review_proposal', [res.proposal_id, true])).rejects.toMatchObject({ code: 'P0002' })

      expect(await db.rpc(mod, 'propose_edit', [p.p2.id, JSON.stringify({ title: 'Better title', statement_markdown: 'Rewritten.' })])).toEqual({ applied: true })
      expect(await problemRow(p.p2.id)).toMatchObject({ title: 'Better title', statement_markdown: 'Rewritten.', rating_epoch: 1 })

      const rev = await db.one<{ id: string }>(`select id from public.problem_revisions where problem_id = $1 and editor_id = $2`, [p.p2.id, mod])
      await db.rpc(mod, 'revert_revision', [rev.id])
      expect(await problemRow(p.p2.id)).toMatchObject({ title: null, statement_markdown: 'Statement two.', rating_epoch: 1 })
      expect(await db.one(`select kind, editor_id from public.problem_revisions where problem_id = $1 order by created_at desc limit 1`, [p.p2.id])).toEqual({ kind: 'revert', editor_id: mod })

      // clearing the statement resets its source
      await db.rpc(mod, 'propose_edit', [p.p2.id, JSON.stringify({ statement_markdown: '' })])
      expect(await problemRow(p.p2.id)).toMatchObject({ statement_markdown: null, statement_source: 'none', extraction_status: 'none' })
    })

    it('a moderator material edit bumps the epoch immediately', async () => {
      await db.rpc(raters[1], 'rate_problem', [p.p3.id, 6])
      await db.rpc(mod, 'propose_edit', [p.p3.id, JSON.stringify({ statement_markdown: 'New question.' }), 'replaced', true])
      expect((await problemRow(p.p3.id)).rating_epoch).toBe(2)
      expect((await db.stats(p.p3.id)).rating_count).toBe(0)
    })
  })

  describe('merge_problems', () => {
    it('moves ratings, keeps the newer rating for conflicting voters, recomputes stats, and redirects', async () => {
      const res = await db.publish(owner, {
        offering_id: offeringId,
        assignment: { title: `Merges ${tag()}`, assignment_type: 'problem_set', assignment_number: 50 },
        problems: [{ label: '1' }, { label: '2', statement_markdown: 'Source statement.' }],
      })
      const p = await db.problemsBySlug(res.assignment_id)
      const target = p.p1.id
      const source = p.p2.id
      const [u1, u2, u3, u4] = await db.createUsers(4)
      // each call is its own transaction, so updated_at strictly increases in this order
      await db.rpc(u1, 'rate_problem', [source, 5, 20])
      await db.rpc(u4, 'rate_problem', [source, 9]) // older than u4's target rating → dropped
      await db.rpc(u2, 'rate_problem', [target, 8]) // older than u2's source rating → replaced
      await db.rpc(u3, 'rate_problem', [target, 6])
      await db.rpc(u4, 'rate_problem', [target, 2])
      await db.rpc(u2, 'rate_problem', [source, 3, 45, 'solved_independently'])

      const out = await db.rpc(mod, 'merge_problems', [source, target])
      expect(out).toEqual({ moved_ratings: 1, conflicts: 2 })

      const ratings = await db.sql<{ user_id: string; difficulty: number; time_minutes: number | null }>(
        `select user_id, difficulty, time_minutes from public.ratings where problem_id = $1`, [target])
      const byUser = Object.fromEntries(ratings.map((r) => [r.user_id, r]))
      expect(ratings).toHaveLength(4)
      expect(byUser[u1]).toMatchObject({ difficulty: 5, time_minutes: 20 })
      expect(byUser[u2]).toMatchObject({ difficulty: 3, time_minutes: 45 })
      expect(byUser[u3]).toMatchObject({ difficulty: 6 })
      expect(byUser[u4]).toMatchObject({ difficulty: 2 })
      expect(await db.sql(`select 1 from public.ratings where problem_id = $1`, [source])).toHaveLength(0)

      const s = await db.stats(target)
      expect(s).toMatchObject({ rating_count: 4, mean: 4, median: 4, time_count: 2, median_time_minutes: 32.5 })
      expect(s.histogram).toEqual([0, 1, 1, 0, 1, 1, 0, 0, 0, 0])
      expect((await db.stats(source)).rating_count).toBe(0)

      expect(await db.one(`select merged_into, status from public.problems where id = $1`, [source])).toEqual({ merged_into: target, status: 'hidden' })
      // the target inherits the statement it was missing
      expect((await problemRow(target)).statement_markdown).toBe('Source statement.')
      const log = await db.one<{ details: { conflicts: unknown[]; moved_ratings: number } }>(
        `select details from public.moderation_actions where action = 'merge_problems' and target_id = $1`, [target])
      expect(log.details.conflicts).toHaveLength(2)
      expect(await db.one(`select kind from public.problem_revisions where problem_id = $1 and kind = 'merge'`, [target])).toEqual({ kind: 'merge' })

      // the merged problem can't be rated or merged again
      await expect(db.rpc(u3, 'rate_problem', [source, 5])).rejects.toMatchObject({ hint: 'problem_merged' })
      await expect(db.rpc(mod, 'merge_problems', [source, target])).rejects.toMatchObject({ code: 'P0002' })
      await expect(db.rpc(mod, 'merge_problems', [target, target])).rejects.toThrow(/itself/)

      // and it disappears from the overview
      const overview = await db.rpc<{ assignments: Array<{ id: string; problems: Array<{ id: string }> }> }>(null, 'get_offering_overview', [offeringId])
      const ids = overview.assignments.find((a) => a.id === res.assignment_id)!.problems.map((x) => x.id)
      expect(ids).toEqual([target])
    })

    it('ratings that were stale on the source (older question version) stay excluded after a merge', async () => {
      const res = await db.publish(owner, {
        offering_id: offeringId,
        assignment: { title: `Stale merge ${tag()}`, assignment_type: 'problem_set', assignment_number: 52 },
        problems: [{ label: '1' }, { label: '2', statement_markdown: 'Old version.' }],
      })
      const p = await db.problemsBySlug(res.assignment_id)
      const target = p.p1.id
      const source = p.p2.id
      const [u1, u2, u3, u4] = await db.createUsers(4)
      await db.rpc(u4, 'rate_problem', [target, 6])
      await db.rpc(u1, 'rate_problem', [source, 2]) // becomes stale
      await db.rpc(u4, 'rate_problem', [source, 1]) // becomes stale, but newer than u4's target rating
      await db.rpc(mod, 'propose_edit', [source, JSON.stringify({ statement_markdown: 'New version.' }), null, true])
      await db.rpc(u3, 'rate_problem', [source, 9])
      await db.rpc(u2, 'rate_problem', [target, 5])
      expect((await db.stats(source)).rating_count).toBe(1)

      await db.rpc(mod, 'merge_problems', [source, target])

      // current votes: u4 keeps 6 (their newer vote was for an outdated question), u3's 9 moves, u2's 5 stays
      const s = await db.stats(target)
      expect(s).toMatchObject({ rating_count: 3, mean: 6.667, median: 6 })
      expect(await db.one(`select difficulty from public.ratings where user_id = $1 and problem_id = $2`, [u4, target])).toEqual({ difficulty: 6 })
      // u1's outdated vote is kept, still marked stale
      const mine = await db.asUser(u1, (q) => q<{ problem_id: string; difficulty: number; stale: boolean }>(`select * from public.my_ratings($1)`, [offeringId]))
      expect(mine.filter((r) => r.problem_id === target)).toEqual([expect.objectContaining({ difficulty: 2, stale: true })])
      // and re-rating makes it count again
      await db.rpc(u1, 'rate_problem', [target, 4])
      expect((await db.stats(target)).rating_count).toBe(4)
    })

    it('merges same-labelled parts and moves the rest', async () => {
      const res = await db.publish(owner, {
        offering_id: offeringId,
        assignment: { title: `Parts ${tag()}`, assignment_type: 'problem_set', assignment_number: 51 },
        problems: problems(['4', ['a', 'b']], ['5', ['a']]),
      })
      const p = await db.problemsBySlug(res.assignment_id)
      const [u1, u2, u3] = await db.createUsers(3)
      await db.rpc(u1, 'rate_problem', [p.p4a.id, 4])
      await db.rpc(u2, 'rate_problem', [p.p4b.id, 7])
      await db.rpc(u3, 'rate_problem', [p.p5a.id, 6])

      await db.rpc(mod, 'merge_problems', [p.p4.id, p.p5.id])

      const after = await db.problemsBySlug(res.assignment_id)
      expect(after.p5b.id).toBe(p.p4b.id) // moved under the target, re-slugged
      expect(after.p5b.parent_problem_id).toBe(p.p5.id)
      expect(await db.one(`select merged_into from public.problems where id = $1`, [p.p4a.id])).toEqual({ merged_into: p.p5a.id })
      expect((await db.stats(p.p5a.id)).rating_count).toBe(2)
      expect((await db.stats(p.p4b.id)).rating_count).toBe(1)
      expect(await db.sql(`select 1 from public.ratings where problem_id = $1`, [p.p4a.id])).toHaveLength(0)
      // the merge flag doesn't leak out of the transaction: the parent with parts still can't be rated
      await expect(db.rpc(u1, 'rate_problem', [p.p5.id, 5])).rejects.toMatchObject({ hint: 'rate_parts' })
    })
  })

  describe('merge_assignments', () => {
    it('merges matching problems, moves the rest with fresh slugs, and hides the source', async () => {
      const target = await db.publish(owner, {
        offering_id: offeringId,
        assignment: { title: `Target ${tag()}`, assignment_type: 'other' },
        problems: problems('1', '2', 'P6'),
      })
      const source = await db.publish(owner, {
        offering_id: offeringId,
        assignment: { title: `Source ${tag()}`, assignment_type: 'other' },
        problems: problems('1', '6', ['7', ['a']]),
      })
      const tp = await db.problemsBySlug(target.assignment_id)
      const sp = await db.problemsBySlug(source.assignment_id)
      const [u1, u2] = await db.createUsers(2)
      await db.rpc(u1, 'rate_problem', [sp.p1.id, 4])
      await db.rpc(u2, 'rate_problem', [tp.p1.id, 6])
      await db.rpc(u2, 'rate_problem', [sp.p6.id, 5])
      await db.rpc(u1, 'rate_problem', [sp.p7a.id, 8])

      expect(await db.rpc(mod, 'merge_assignments', [source.assignment_id, target.assignment_id])).toEqual({ merged_problems: 1, moved_problems: 2 })

      const after = await db.sql<{ id: string; slug: string; label: string; merged_into: string | null }>(
        `select id, slug, label, merged_into from public.problems where assignment_id = $1 and merged_into is null order by slug`, [target.assignment_id])
      expect(after.map((r) => [r.label, r.slug])).toEqual([
        ['1', 'p1'], ['2', 'p2'], ['P6', 'p6'], ['6', 'p6-2'], ['7', 'p7'], ['a', 'p7a'],
      ])
      expect(after.find((r) => r.label === '6')!.id).toBe(sp.p6.id)
      expect(await db.stats(tp.p1.id)).toMatchObject({ rating_count: 2, mean: 5 })
      expect((await db.stats(sp.p6.id)).rating_count).toBe(1)
      expect((await db.stats(sp.p7a.id)).rating_count).toBe(1)

      expect(await db.one(`select merged_into, status from public.assignments where id = $1`, [source.assignment_id])).toEqual({
        merged_into: target.assignment_id, status: 'hidden',
      })
      const overview = await db.rpc<{ assignments: Array<{ id: string; problems: unknown[] }> }>(null, 'get_offering_overview', [offeringId])
      expect(overview.assignments.map((a) => a.id)).not.toContain(source.assignment_id)
      expect(overview.assignments.find((a) => a.id === target.assignment_id)!.problems).toHaveLength(6)

      // a merged assignment no longer accepts new problems or edits
      await expect(db.rpc(owner, 'add_problem', [source.assignment_id, '99'])).rejects.toMatchObject({ code: 'P0002' })
      await expect(db.rpc(mod, 'merge_assignments', [source.assignment_id, target.assignment_id])).rejects.toMatchObject({ code: 'P0002' })
    })
  })
})
