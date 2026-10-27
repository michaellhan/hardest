import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DB_TESTS, TestDb, problems, tag } from './helpers.ts'

interface Resolved {
  university: { id: string } | null
  course: { id: string; slug: string } | null
  offering: { id: string } | null
  assignment: { id: string; slug: string } | null
  problem: { id: string; slug: string } | null
  redirected: boolean
}

describe.skipIf(!DB_TESTS)('catalog hierarchy, slugs, and paths', () => {
  let db: TestDb
  let owner: string
  let mod: string
  let cat: Awaited<ReturnType<TestDb['createCatalog']>>
  let pset4: { assignment_id: string; assignment_slug: string }

  const resolve = (uid: string | null, ...path: Array<string | null>) => {
    const args = [...cat.path, ...path]
    return db.rpc<Resolved>(uid, 'resolve_path', args)
  }

  beforeAll(async () => {
    db = new TestDb()
    owner = await db.createUser()
    mod = await db.createUser({ role: 'moderator' })
    cat = await db.createCatalog()
  })
  afterAll(() => db?.close())

  it('creates university → course → offering through the RPCs', async () => {
    const u = await db.createUser()
    const t = tag()
    const uni = await db.rpc<{ id: string; slug: string; existing: boolean; status: string }>(mod, 'create_university', [`Hierarchy College ${t}`, `HC ${t}`])
    expect(uni).toMatchObject({ existing: false, status: 'active', slug: `hc-${t}` })
    // same name again → returns the existing row
    expect(await db.rpc(u, 'create_university', [`hierarchy college ${t}`])).toMatchObject({ id: uni.id, existing: true })

    const course = await db.rpc<{ id: string; slug: string }>(u, 'create_course', [uni.id, 'math 55a', 'Algebra'])
    expect(course.slug).toBe('math-55a')
    expect(await db.one(`select code from public.courses where id = $1`, [course.id])).toEqual({ code: 'MATH 55A' })
    // "MATH-55A" normalizes to the same code → existing
    expect(await db.rpc(u, 'create_course', [uni.id, 'MATH-55A', 'Dup'])).toMatchObject({ id: course.id, existing: true })

    const off = await db.rpc<{ id: string; slug: string }>(u, 'create_offering', [course.id, 2026, 'fall'])
    expect(off.slug).toBe('fall-2026')
    const sec = await db.rpc<{ slug: string }>(u, 'create_offering', [course.id, 2026, 'fall', 'Section B'])
    expect(sec.slug).toBe('fall-2026-section-b')
    expect(await db.rpc(u, 'create_offering', [course.id, 2026, 'fall'])).toMatchObject({ id: off.id, existing: true })
    expect(await db.one(`select academic_year from public.course_offerings where id = $1`, [off.id])).toEqual({ academic_year: '2026-27' })
  })

  it('publishes an assignment with canonical slugs (pset-4, p2, p3a)', async () => {
    pset4 = await db.publish(owner, {
      offering_id: cat.offering.id,
      assignment: { title: 'Problem Set 4', assignment_type: 'problem_set', assignment_number: 4 },
      problems: [
        { label: '1', statement_markdown: 'Prove that $1 + 1 = 2$.' },
        { label: '2' },
        { label: '3', children: [{ label: 'a' }, { label: 'b' }] },
        { label: 'Essay Prompt A' },
      ],
    })
    expect(pset4.assignment_slug).toBe('pset-4')
    const res = pset4 as unknown as { created: number; skipped: string[] }
    expect(res.created).toBe(6)
    expect(res.skipped).toEqual([])

    const rows = await db.sql<{ slug: string; label: string; parent: string | null; display_order: number; statement_source: string }>(
      `select p.slug, p.label, pp.slug as parent, p.display_order, p.statement_source
         from public.problems p left join public.problems pp on pp.id = p.parent_problem_id
        where p.assignment_id = $1 order by p.slug`,
      [pset4.assignment_id],
    )
    expect(rows.map((r) => [r.slug, r.parent])).toEqual([
      ['essay-prompt-a', null],
      ['p1', null],
      ['p2', null],
      ['p3', null],
      ['p3a', 'p3'],
      ['p3b', 'p3'],
    ])
    expect(rows.find((r) => r.slug === 'p1')!.statement_source).toBe('manual')
    expect(rows.find((r) => r.slug === 'p2')!.statement_source).toBe('none')
    // every problem gets a 'create' revision
    expect((await db.one<{ n: number }>(
      `select count(*)::int as n from public.problem_revisions r join public.problems p on p.id = r.problem_id
        where p.assignment_id = $1 and r.kind = 'create' and r.editor_id = $2`, [pset4.assignment_id, owner])).n).toBe(6)

    const a = await db.one<{ display_order: number; created_by: string }>(`select display_order, created_by from public.assignments where id = $1`, [pset4.assignment_id])
    expect(a).toEqual({ display_order: 400, created_by: owner })
  })

  it('keeps slugs unique within their parent', async () => {
    // force a second "Problem Set 4" → pset-4-2
    const again = await db.publish(owner, {
      offering_id: cat.offering.id,
      force_distinct: true,
      assignment: { title: 'Problem Set 4', assignment_type: 'problem_set', assignment_number: 4 },
      problems: problems('1'),
    })
    expect(again.assignment_slug).toBe('pset-4-2')

    // add_problem: duplicate label refused; slugs derived from the label/parent
    await expect(db.rpc(owner, 'add_problem', [pset4.assignment_id, '2'])).rejects.toMatchObject({ hint: 'duplicate_labels' })
    expect(await db.rpc(owner, 'add_problem', [pset4.assignment_id, '2a'])).toMatchObject({ slug: 'p2a' })
    const p3 = (await db.problemsBySlug(pset4.assignment_id)).p3
    expect(await db.rpc(owner, 'add_problem', [pset4.assignment_id, 'ii', p3.id])).toMatchObject({ slug: 'p3-ii' })
    expect(await db.rpc(owner, 'add_problem', [pset4.assignment_id, 'Bonus'])).toMatchObject({ slug: 'bonus' })
    // a different label that slugifies to a taken slug gets a numeric suffix
    expect(await db.rpc(owner, 'add_problem', [pset4.assignment_id, 'Bonus!'])).toMatchObject({ slug: 'bonus-2' })
  })

  it('refuses duplicate labels inside one payload', async () => {
    await expect(
      db.publish(owner, { offering_id: cat.offering.id, assignment: { title: `Lab ${tag()}`, assignment_type: 'lab' }, problems: problems('1', ' 1 ') }),
    ).rejects.toMatchObject({ hint: 'duplicate_labels' })
  })

  it('adds only the missing problems and parts to an existing assignment', async () => {
    const res = await db.publish(owner, {
      offering_id: cat.offering.id,
      assignment_id: pset4.assignment_id,
      problems: problems('1', ['3', ['a', 'c']], '5'),
    })
    expect(res.created).toBe(2) // p3c and p5
    expect(res.skipped).toEqual(['1', '3'])
    const bySlug = await db.problemsBySlug(pset4.assignment_id)
    expect(bySlug.p3c.parent_problem_id).toBe(bySlug.p3.id)
    expect(bySlug.p5).toBeDefined()
  })

  it('resolve_path finds every level, case-insensitively', async () => {
    const r = await resolve(null, 'PSET-4', 'P3A')
    const bySlug = await db.problemsBySlug(pset4.assignment_id)
    expect(r.university!.id).toBe(cat.university.id)
    expect(r.course!.id).toBe(cat.course.id)
    expect(r.offering!.id).toBe(cat.offering.id)
    expect(r.assignment).toEqual({ id: pset4.assignment_id, slug: 'pset-4' })
    expect(r.problem).toEqual({ id: bySlug.p3a.id, slug: 'p3a' })
    expect(r.redirected).toBe(false)

    expect(await db.rpc(null, 'resolve_path', ['no-such-university', 'x'])).toBeNull()
    const missing = await resolve(null, 'pset-404', null)
    expect(missing.assignment).toBeNull()
  })

  it('resolve_path follows old slugs after a label rename', async () => {
    const before = (await db.problemsBySlug(pset4.assignment_id)).p2
    await db.rpc(mod, 'propose_edit', [before.id, JSON.stringify({ label: '7' })])
    const after = await db.one<{ slug: string; label: string }>(`select slug, label from public.problems where id = $1`, [before.id])
    expect(after).toEqual({ slug: 'p7', label: '7' })
    expect(await db.sql(`select entity_id from public.slug_aliases where entity_type = 'problem' and scope_id = $1 and old_slug = 'p2'`, [pset4.assignment_id])).toEqual([
      { entity_id: before.id },
    ])

    const viaOld = await resolve(null, 'pset-4', 'p2')
    expect(viaOld.problem).toEqual({ id: before.id, slug: 'p7' })
    expect(viaOld.redirected).toBe(true)
    // the canonical slug still resolves without a redirect
    expect((await resolve(null, 'pset-4', 'p7')).redirected).toBe(false)

    // a new problem can take over the freed slug p2; the canonical slug then wins over the alias
    const p2 = await db.rpc<{ id: string; slug: string }>(owner, 'add_problem', [pset4.assignment_id, '2'])
    expect(p2.slug).toBe('p2')
    expect((await resolve(null, 'pset-4', 'p2')).problem).toEqual({ id: p2.id, slug: 'p2' })
  })

  it('resolve_path follows course slug aliases', async () => {
    const newSlug = `${cat.course.slug}-renamed`
    await db.sql(`insert into public.slug_aliases (entity_type, scope_id, old_slug, entity_id) values ('course', $1, $2, $3)`, [
      cat.university.id, cat.course.slug, cat.course.id,
    ])
    await db.sql(`update public.courses set slug = $2 where id = $1`, [cat.course.id, newSlug])
    try {
      const r = await db.rpc<Resolved>(null, 'resolve_path', [cat.university.slug, cat.course.slug, cat.offering.slug, 'pset-4'])
      expect(r.course!.slug).toBe(newSlug)
      expect(r.assignment!.id).toBe(pset4.assignment_id)
      expect(r.redirected).toBe(true)
    } finally {
      await db.sql(`update public.courses set slug = $2 where id = $1`, [cat.course.id, cat.course.slug])
      await db.sql(`delete from public.slug_aliases where entity_id = $1`, [cat.course.id])
    }
  })

  it('resolve_path redirects merged problems and assignments, for anonymous visitors too', async () => {
    const dup = await db.publish(owner, {
      offering_id: cat.offering.id,
      assignment: { title: `Practice ${tag()}`, assignment_type: 'other' },
      problems: problems('1', '9'),
    })
    const dupProblems = await db.problemsBySlug(dup.assignment_id)
    const target = await db.problemsBySlug(pset4.assignment_id)

    // merge one problem into another assignment's problem
    await db.rpc(mod, 'merge_problems', [dupProblems.p1.id, target.p1.id])
    for (const uid of [null, owner, await db.createUser()]) {
      const r = await resolve(uid, dup.assignment_slug, 'p1')
      expect(r.problem).toEqual({ id: target.p1.id, slug: 'p1' })
      expect(r.assignment).toEqual({ id: pset4.assignment_id, slug: 'pset-4' })
      expect(r.redirected).toBe(true)
    }

    // merge the rest of the assignment
    await db.rpc(mod, 'merge_assignments', [dup.assignment_id, pset4.assignment_id])
    for (const uid of [null, await db.createUser()]) {
      const r = await resolve(uid, dup.assignment_slug, null)
      expect(r.assignment).toEqual({ id: pset4.assignment_id, slug: 'pset-4' })
      expect(r.redirected).toBe(true)
      const r9 = await resolve(uid, dup.assignment_slug, 'p9')
      expect(r9.problem?.slug).toBe('p9')
      expect(r9.assignment!.id).toBe(pset4.assignment_id)
    }
  })

  describe('duplicate detection', () => {
    let off: string
    let original: { assignment_id: string }

    beforeAll(async () => {
      off = (await db.createCatalog()).offering.id
      original = await db.publish(owner, {
        offering_id: off,
        assignment: { title: 'Problem Set 4', assignment_type: 'problem_set', assignment_number: 4 },
        problems: [
          { label: '1', statement_markdown: 'Let V be a finite-dimensional vector space over a field F and let T be a linear operator on V. Prove that the kernel of T is a subspace.' },
          { label: '2', statement_markdown: 'Show that every finite group of even order contains an element of order two, using a pairing argument.' },
          { label: '3' },
        ],
      })
    })

    it('publishing a near-identical assignment raises duplicate_assignment', async () => {
      const u = await db.createUser()
      for (const title of ['Problem Set 4', 'problem set #4', 'PROBLEM-SET 4']) {
        await expect(
          db.publish(u, { offering_id: off, assignment: { title, assignment_type: 'problem_set' }, problems: problems('1') }),
        ).rejects.toMatchObject({ hint: 'duplicate_assignment', detail: original.assignment_id })
      }
      // different title but the same number and type
      await expect(
        db.publish(u, { offering_id: off, assignment: { title: 'PS 4 (algebra)', assignment_type: 'problem_set', assignment_number: 4 }, problems: problems('1') }),
      ).rejects.toMatchObject({ hint: 'duplicate_assignment' })
      // same number but a different type is fine
      const lab = await db.publish(u, { offering_id: off, assignment: { title: 'Lab 4', assignment_type: 'lab', assignment_number: 4 }, problems: problems('1') })
      expect(lab.assignment_slug).toBe('lab-4')
    })

    it('force_distinct publishes anyway', async () => {
      const u = await db.createUser()
      const res = await db.publish(u, {
        offering_id: off,
        force_distinct: true,
        assignment: { title: 'Problem Set 4', assignment_type: 'problem_set', assignment_number: 4 },
        problems: problems('1'),
      })
      expect(res.assignment_slug).toBe('pset-4-2')
    })

    it('find_assignment_duplicates scores candidates and explains why', async () => {
      type Dup = { assignment_id: string; score: number; reasons: string[]; same_offering: boolean; problem_count: number; offering_label: string }
      const strong = await db.asAnon((q) =>
        q<Dup>(`select * from public.find_assignment_duplicates($1, 'Problem Set 4', 'problem_set', 4, null, array['1','2','3'])`, [off]),
      )
      const top = strong.find((d) => d.assignment_id === original.assignment_id)!
      expect(strong[0].score).toBe(top.score)
      expect(top.score).toBeCloseTo(1.7, 5) // same title 0.9 + same number 0.8
      expect(top.reasons).toEqual(expect.arrayContaining(['Same title', 'Same assignment number', 'Matching problem labels']))
      expect(top.same_offering).toBe(true)
      expect(top.problem_count).toBe(3)
      expect(top.offering_label).toBe('Fall 2026')
      // sorted by score
      expect(strong.map((d) => d.score)).toEqual([...strong.map((d) => d.score)].sort((a, b) => b - a))

      const text = await db.asAnon((q) =>
        q<Dup>(
          `select * from public.find_assignment_duplicates($1, 'Homework A', null, null, null, '{}',
             'Let V be a finite-dimensional vector space over a field F and let T be a linear operator on V. Prove that the kernel of T is a subspace. Show that every finite group of even order contains an element of order two, using a pairing argument.')`,
          [off],
        ),
      )
      expect(text.find((d) => d.assignment_id === original.assignment_id)?.reasons).toContain('Similar problem text')

      const none = await db.asAnon((q) => q<Dup>(`select * from public.find_assignment_duplicates($1, 'Final Project Proposal', 'project', null)`, [off]))
      expect(none).toEqual([])
    })

    it('flags the same uploaded file across offerings by checksum', async () => {
      const u = await db.createUser()
      const checksum = 'ab'.repeat(32)
      const doc = await db.rpc<{ id: string; storage_path: string }>(u, 'register_source_document', [off, '../../etc/Problem Set 9.pdf', 'pdf', 1234, checksum.toUpperCase()])
      expect(doc.storage_path).toBe(`${u}/${doc.id}/Problem_Set_9.pdf`)
      const pub = await db.publish(u, {
        offering_id: off,
        source_document_id: doc.id,
        assignment: { title: 'Problem Set 9', assignment_type: 'problem_set', assignment_number: 9 },
        problems: problems('1'),
      })
      expect(await db.one(`select processing_status, assignment_id from public.source_documents where id = $1`, [doc.id])).toEqual({
        processing_status: 'published', assignment_id: pub.assignment_id,
      })

      const other = (await db.createCatalog()).offering.id
      const dups = await db.asUser(u, (q) =>
        q<{ assignment_id: string; same_offering: boolean; reasons: string[] }>(
          `select * from public.find_assignment_duplicates($1, 'Totally different', null, null, $2)`, [other, checksum]),
      )
      expect(dups).toEqual([expect.objectContaining({ assignment_id: pub.assignment_id, same_offering: false, reasons: ['The same file was uploaded before'] })])
    })
  })
})
