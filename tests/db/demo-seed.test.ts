import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CATALOG, HARVARD } from '../../src/lib/demo/catalog.ts'
import { buildDemoDataset } from '../../src/lib/demo/dataset.ts'
import { DB_TESTS, TestDb } from './helpers.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8')

describe.skipIf(!DB_TESTS)('seed.sql, seed-demo.sql, remove-demo.sql', () => {
  let db: TestDb
  const ds = buildDemoDataset()
  const offeringCount = CATALOG.reduce((n, c) => n + c.offerings.length, 0)

  const catalogCounts = () =>
    db.one<{ courses: number; offerings: number; active: boolean }>(
      `select (select count(*)::int from public.courses c join public.universities u on u.id = c.university_id where u.slug = $1) as courses,
              (select count(*)::int from public.course_offerings o join public.courses c on c.id = o.course_id
                 join public.universities u on u.id = c.university_id where u.slug = $1) as offerings,
              (select status = 'active' from public.universities where slug = $1) as active`,
      [HARVARD.slug],
    )
  const demoCounts = () =>
    db.one<{ users: number; profiles: number; assignments: number; problems: number; ratings: number }>(
      `select (select count(*)::int from auth.users where id = any($1::uuid[])) as users,
              (select count(*)::int from public.profiles where is_demo) as profiles,
              (select count(*)::int from public.assignments where is_demo) as assignments,
              (select count(*)::int from public.problems p join public.assignments a on a.id = p.assignment_id where a.is_demo) as problems,
              (select count(*)::int from public.ratings where user_id = any($1::uuid[])) as ratings`,
      [ds.demoUserIds],
    )

  beforeAll(() => {
    db = new TestDb()
  })
  afterAll(async () => {
    // leave the database as the test script created it
    await db?.sql(read('supabase/remove-demo.sql'))
    await db?.close()
  })

  it('seed.sql provides the real catalog skeleton with the dataset ids, and is idempotent', async () => {
    await db.sql(read('supabase/seed.sql'))
    expect(await catalogCounts()).toEqual({ courses: CATALOG.length, offerings: offeringCount, active: true })
    const ids = await db.sql<{ id: string }>(`select id from public.course_offerings where id = any($1::uuid[])`, [ds.offerings.map((o) => o.id)])
    expect(ids).toHaveLength(offeringCount)
    // no assignments or ratings in the real catalog
    expect(await db.one(`select count(*)::int as n from public.assignments where course_offering_id = any($1::uuid[]) and not is_demo`, [ds.offerings.map((o) => o.id)])).toEqual({ n: 0 })
  })

  it('seed-demo.sql applies cleanly, flags everything as demo, and produces correct aggregates', async () => {
    await db.sql(read('supabase/seed-demo.sql'))
    expect(await demoCounts()).toEqual({
      users: ds.demoUserIds.length,
      profiles: ds.demoUserIds.length,
      assignments: ds.assignments.length,
      problems: ds.problems.length,
      ratings: ds.ratings.length,
    })

    // every demo problem has a stats row equal to a recomputation from the raw ratings
    const mismatches = await db.sql(
      `select p.id, s.rating_count, x.n, s.mean, x.mean, s.median, x.median
         from public.problems p join public.assignments a on a.id = p.assignment_id and a.is_demo
         left join public.problem_stats s on s.problem_id = p.id
         left join lateral (select count(*)::int as n, round(avg(difficulty), 3) as mean,
                                   percentile_cont(0.5) within group (order by difficulty)::numeric(4, 1) as median,
                                   count(time_minutes)::int as tn
                              from public.ratings r where r.problem_id = p.id and r.epoch = p.rating_epoch) x on true
        where s.problem_id is null or s.rating_count <> x.n or s.mean is distinct from x.mean or s.median is distinct from x.median
           or s.time_count <> x.tn or (select sum(h) from unnest(s.histogram) h) <> x.n`,
    )
    expect(mismatches).toEqual([])

    // ratings only on leaf problems
    expect(await db.one(`select count(*)::int as n from public.ratings r where exists (select 1 from public.problems c where c.parent_problem_id = r.problem_id)`)).toEqual({ n: 0 })

    // the demo shows up in the public overview, without user ids
    const offering = ds.offerings[0]
    const overview = await db.rpc<{ assignments: Array<{ is_demo: boolean; problems: unknown[] }> }>(null, 'get_offering_overview', [offering.id])
    const expected = ds.assignments.filter((a) => a.course_offering_id === offering.id)
    expect(overview.assignments).toHaveLength(expected.length)
    expect(overview.assignments.every((a) => a.is_demo)).toBe(true)
    expect(JSON.stringify(overview)).not.toContain(ds.demoUserIds[0])

    // re-running is a no-op
    await db.sql(read('supabase/seed-demo.sql'))
    expect((await demoCounts()).ratings).toBe(ds.ratings.length)
  })

  it('remove-demo.sql removes all demo data and leaves the catalog and real ratings intact', async () => {
    // a real user who rated a demo problem and a (real) problem in the catalog
    const real = await db.createUser()
    const offering = ds.offerings[0]
    const pub = await db.publish(real, {
      offering_id: offering.id,
      assignment: { title: 'Real Midterm Review', assignment_type: 'other' },
      problems: [{ label: '1' }],
    })
    const realProblem = (await db.problemsBySlug(pub.assignment_id)).p1.id
    const demoLeaf = ds.ratings[0].problem_id
    await db.rpc(real, 'rate_problem', [realProblem, 6])
    await db.rpc(real, 'rate_problem', [demoLeaf, 6])

    await db.sql(read('supabase/remove-demo.sql'))
    expect(await demoCounts()).toEqual({ users: 0, profiles: 0, assignments: 0, problems: 0, ratings: 0 })
    expect(await db.sql(`select 1 from public.problems where id = any($1::uuid[])`, [ds.problems.map((p) => p.id)])).toEqual([])
    expect(await db.sql(`select 1 from public.problem_stats where problem_id = any($1::uuid[])`, [ds.problems.map((p) => p.id)])).toEqual([])
    expect(await catalogCounts()).toEqual({ courses: CATALOG.length, offerings: offeringCount, active: true })

    // the real contribution survives
    expect(await db.one(`select status from public.assignments where id = $1`, [pub.assignment_id])).toEqual({ status: 'active' })
    expect((await db.stats(realProblem)).rating_count).toBe(1)
    expect(await db.one(`select count(*)::int as n from public.ratings where user_id = $1`, [real])).toEqual({ n: 1 })

    // idempotent
    await db.sql(read('supabase/remove-demo.sql'))
    await db.sql(`delete from public.assignments where id = $1`, [pub.assignment_id])
  })
})
