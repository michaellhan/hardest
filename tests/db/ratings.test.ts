import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_TESTS, TestDb, problems } from './helpers.ts'

describe.skipIf(!DB_TESTS)('ratings and aggregates', () => {
  let db: TestDb
  let owner: string
  let offeringId: string
  let p: Record<string, { id: string }>

  beforeAll(async () => {
    db = new TestDb()
    owner = await db.createUser()
    const cat = await db.createCatalog()
    offeringId = cat.offering.id
    const res = await db.publish(owner, {
      offering_id: offeringId,
      assignment: { title: 'Problem Set 1', assignment_type: 'problem_set', assignment_number: 1 },
      problems: problems('1', '2', '3', '4', '5', ['6', ['a', 'b']], '7'),
    })
    p = await db.problemsBySlug(res.assignment_id)
  })
  afterAll(() => db?.close())

  it('allows only one rating per user per problem (unique constraint)', async () => {
    const u = await db.createUser()
    await db.sql(`insert into public.ratings (user_id, problem_id, difficulty) values ($1, $2, 4)`, [u, p.p1.id])
    await expect(db.sql(`insert into public.ratings (user_id, problem_id, difficulty) values ($1, $2, 6)`, [u, p.p1.id])).rejects.toMatchObject({
      code: '23505',
      constraint: 'ratings_one_per_user',
    })
  })

  it('rejects difficulties outside 1–10 and out-of-range times', async () => {
    const u = await db.createUser()
    await expect(db.rpc(u, 'rate_problem', [p.p7.id, 11])).rejects.toMatchObject({ code: '23514' })
    await expect(db.rpc(u, 'rate_problem', [p.p7.id, 0])).rejects.toMatchObject({ code: '23514' })
    await expect(db.rpc(u, 'rate_problem', [p.p7.id, 5, 0])).rejects.toMatchObject({ code: '23514' })
  })

  it('rate_problem replaces an earlier rating instead of duplicating it, and clear_rating removes it', async () => {
    const u = await db.createUser()
    const first = await db.rpc<{ rating_count: number; mean: string }>(u, 'rate_problem', [p.p2.id, 3, 30, 'solved_with_help'])
    expect(first.rating_count).toBe(1)
    expect(Number(first.mean)).toBe(3)

    const second = await db.rpc<{ rating_count: number; mean: string; completion: Record<string, number> }>(u, 'rate_problem', [
      p.p2.id,
      8,
      null,
      'attempted_not_solved',
    ])
    expect(second.rating_count).toBe(1)
    expect(Number(second.mean)).toBe(8)
    expect(second.completion).toMatchObject({ solved_with_help: 0, attempted_not_solved: 1 })

    const rows = await db.sql<{ difficulty: number; time_minutes: number | null }>(
      `select difficulty, time_minutes from public.ratings where user_id = $1 and problem_id = $2`,
      [u, p.p2.id],
    )
    expect(rows).toEqual([{ difficulty: 8, time_minutes: null }])

    // the user sees their own rating through my_ratings
    const mine = await db.asUser(u, (q) => q<{ problem_id: string; difficulty: number; stale: boolean }>(`select * from public.my_ratings($1)`, [offeringId]))
    expect(mine).toEqual([expect.objectContaining({ problem_id: p.p2.id, difficulty: 8, stale: false })])

    const cleared = await db.rpc(u, 'clear_rating', [p.p2.id])
    expect(cleared).toBeNull()
    expect((await db.stats(p.p2.id)).rating_count).toBe(0)
    expect(await db.sql(`select 1 from public.ratings where user_id = $1 and problem_id = $2`, [u, p.p2.id])).toHaveLength(0)
  })

  it('maintains count, mean, median (even and odd), stddev, histogram, median time, and completion', async () => {
    const users = await db.createUsers(5)
    const votes: Array<[number, number | null, string | null]> = [
      [2, 10, 'solved_independently'],
      [4, 20, 'solved_independently'],
      [6, 30, 'solved_with_help'],
      [9, null, 'attempted_not_solved'],
    ]
    for (let i = 0; i < votes.length; i++) await db.rpc(users[i], 'rate_problem', [p.p3.id, ...votes[i]])

    let s = await db.stats(p.p3.id)
    expect(s.rating_count).toBe(4)
    expect(s.mean).toBe(5.25)
    expect(s.median).toBe(5) // even count: average of the middle two (4, 6)
    expect(s.stddev).toBeCloseTo(2.986, 3)
    expect(s.histogram).toEqual([0, 1, 0, 1, 0, 1, 0, 0, 1, 0])
    expect(s.time_count).toBe(3)
    expect(s.median_time_minutes).toBe(20)
    expect(s.completion).toEqual({ solved_independently: 2, solved_with_help: 1, attempted_not_solved: 1, not_attempted: 0 })

    await db.rpc(users[4], 'rate_problem', [p.p3.id, 7, 45, 'not_attempted'])
    s = await db.stats(p.p3.id)
    expect(s.rating_count).toBe(5)
    expect(s.mean).toBe(5.6)
    expect(s.median).toBe(6) // odd count
    expect(s.time_count).toBe(4)
    expect(s.median_time_minutes).toBe(25) // even number of times: (20 + 30) / 2
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(5)
    expect(s.completion.not_attempted).toBe(1)

    // the aggregate always equals a recomputation from the raw table
    const check = await db.one<{ n: number; mean: number; median: number }>(
      `select count(*)::int as n, round(avg(difficulty), 3)::float8 as mean,
              percentile_cont(0.5) within group (order by difficulty) as median
         from public.ratings where problem_id = $1`,
      [p.p3.id],
    )
    expect([s.rating_count, s.mean, s.median]).toEqual([check.n, check.mean, check.median])
  })

  it('keeps aggregates exact when many users rate the same problem concurrently', async () => {
    const users = await db.createUsers(12)
    const difficulties = users.map((_, i) => (i % 10) + 1)
    await Promise.all(users.map((u, i) => db.rpc(u, 'rate_problem', [p.p4.id, difficulties[i], 10 + i])))
    let s = await db.stats(p.p4.id)
    expect(s.rating_count).toBe(12)
    expect(s.mean).toBeCloseTo(difficulties.reduce((a, b) => a + b, 0) / 12, 3)
    expect(s.histogram.reduce((a, b) => a + b, 0)).toBe(12)

    // concurrent re-rates + clears
    await Promise.all(
      users.map((u, i) => (i < 4 ? db.rpc(u, 'clear_rating', [p.p4.id]) : db.rpc(u, 'rate_problem', [p.p4.id, 10]))),
    )
    s = await db.stats(p.p4.id)
    expect(s.rating_count).toBe(8)
    expect(s.mean).toBe(10)
    expect(s.histogram).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 8])
  })

  it('refuses ratings on a problem that has parts, but accepts ratings on the parts', async () => {
    const u = await db.createUser()
    await expect(db.rpc(u, 'rate_problem', [p.p6.id, 5])).rejects.toMatchObject({ hint: 'rate_parts' })
    // a direct insert goes through the same trigger
    await expect(
      db.asUser(u, (q) => q(`insert into public.ratings (problem_id, difficulty) values ($1, 5)`, [p.p6.id])),
    ).rejects.toMatchObject({ hint: 'rate_parts' })
    const s = await db.rpc<{ rating_count: number }>(u, 'rate_problem', [p.p6a.id, 5])
    expect(s.rating_count).toBe(1)
  })

  it('refuses ratings on hidden problems', async () => {
    const mod = await db.createUser({ role: 'moderator' })
    const u = await db.createUser()
    await db.rpc(mod, 'set_content_status', ['problems', p.p5.id, 'hidden'])
    await expect(db.rpc(u, 'rate_problem', [p.p5.id, 5])).rejects.toThrow(/not available/)
    await db.rpc(mod, 'set_content_status', ['problems', p.p5.id, 'active'])
    await db.rpc(u, 'rate_problem', [p.p5.id, 5])
  })

  it('throttles ratings with hint rate_limited', async () => {
    const u = await db.createUser()
    await db.rpc(u, 'rate_problem', [p.p1.id, 5])
    await db.sql(`insert into private.rate_limit_events (user_id, action) select $1, 'rating' from generate_series(1, 199)`, [u])
    await expect(db.rpc(u, 'rate_problem', [p.p7.id, 5])).rejects.toMatchObject({ hint: 'rate_limited', code: 'P0001' })
    // nothing was written
    expect(await db.sql(`select 1 from public.ratings where user_id = $1 and problem_id = $2`, [u, p.p7.id])).toHaveLength(0)
    // events outside the window don't count
    await db.sql(`update private.rate_limit_events set created_at = now() - interval '11 minutes' where user_id = $1`, [u])
    await db.rpc(u, 'rate_problem', [p.p7.id, 5])
  })

  it('throttles publishing, catalog creation, and proposals with hint rate_limited', async () => {
    const u = await db.createUser()
    await db.sql(`insert into private.rate_limit_events (user_id, action) select $1, 'publish' from generate_series(1, 20)`, [u])
    await expect(
      db.publish(u, { offering_id: offeringId, assignment: { title: 'Throttled' }, problems: problems('1') }),
    ).rejects.toMatchObject({ hint: 'rate_limited' })
    await expect(db.rpc(u, 'add_problem', [(await db.one<{ assignment_id: string }>(`select assignment_id from public.problems where id = $1`, [p.p1.id])).assignment_id, '99'])).rejects.toMatchObject({ hint: 'rate_limited' })

    await db.sql(`insert into private.rate_limit_events (user_id, action) select $1, 'catalog' from generate_series(1, 30)`, [u])
    await expect(db.rpc(u, 'create_university', ['Throttle University'])).rejects.toMatchObject({ hint: 'rate_limited' })

    await db.sql(`insert into private.rate_limit_events (user_id, action) select $1, 'proposal' from generate_series(1, 60)`, [u])
    await expect(db.rpc(u, 'propose_edit', [p.p1.id, JSON.stringify({ title: 'x' })])).rejects.toMatchObject({ hint: 'rate_limited' })
  })
})
