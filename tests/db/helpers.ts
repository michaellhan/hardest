/**
 * Helpers for the database test suite (run with `npm run test:db`, which sets DB_TESTS=1 and DATABASE_URL).
 *
 * Every statement runs on a pooled connection as the superuser that owns the database, unless it goes through
 * `asUser` / `asAnon`, which mimic what PostgREST does for a Supabase request: inside a transaction,
 * `set local role authenticated|anon` and set the JWT `sub` claim that the shim's auth.uid() reads.
 */
import pg from 'pg'
import { randomUUID } from 'node:crypto'

export const DB_TESTS = !!process.env.DB_TESTS

export type Q = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>
export type Role = 'user' | 'moderator' | 'admin'

/** Short random suffix for names/slugs, so test files can share one database and run in parallel. */
export function tag() {
  return Math.random().toString(36).slice(2, 8)
}

export class TestDb {
  readonly pool: pg.Pool

  constructor() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (run via npm run test:db)')
    this.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 16 })
  }

  close() {
    return this.pool.end()
  }

  /** Runs a statement as the superuser (bypasses RLS and grants; auth.uid() is null, like the service role). */
  async sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query(text, params)
    return res.rows as T[]
  }

  async one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> {
    const rows = await this.sql<T>(text, params)
    if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}: ${text}`)
    return rows[0]
  }

  /** Runs `fn` in a transaction as the given database role and JWT subject; commits on success, rolls back on error. */
  async as<T>(role: 'authenticated' | 'anon', uid: string | null, fn: (q: Q) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      await client.query(`set local role ${role}`)
      await client.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', $2, true)`, [
        uid ?? '',
        role,
      ])
      const q: Q = async (text, params = []) => (await client.query(text, params)).rows
      const out = await fn(q)
      await client.query('commit')
      return out
    } catch (e) {
      await client.query('rollback').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  }

  asUser<T>(uid: string, fn: (q: Q) => Promise<T>) {
    return this.as('authenticated', uid, fn)
  }

  asAnon<T>(fn: (q: Q) => Promise<T>) {
    return this.as('anon', null, fn)
  }

  /** Calls `public.<fn>(...args)` as a user (or anon when uid is null) and returns its single result value. */
  async rpc<T = unknown>(uid: string | null, fn: string, args: unknown[] = []): Promise<T> {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(', ')
    const run = async (q: Q) => (await q<{ r: T }>(`select public.${fn}(${placeholders}) as r`, args))[0].r
    return uid ? this.asUser(uid, run) : this.asAnon(run)
  }

  /** Creates an auth user (the on_auth_user_created trigger creates the profile) with an optional role. */
  async createUser(opts: { role?: Role; name?: string } = {}): Promise<string> {
    const id = randomUUID()
    await this.sql(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      `test-${id}@example.test`,
      JSON.stringify(opts.name ? { full_name: opts.name } : {}),
    ])
    if (opts.role && opts.role !== 'user') await this.sql(`update public.profiles set role = $2 where id = $1`, [id, opts.role])
    return id
  }

  async createUsers(n: number, opts: { role?: Role } = {}) {
    const ids: string[] = []
    for (let i = 0; i < n; i++) ids.push(await this.createUser(opts))
    return ids
  }

  /** An active university → course → offering, created directly as the superuser. */
  async createCatalog(opts: { status?: 'active' | 'pending' | 'hidden' } = {}) {
    const t = tag()
    const university = await this.one<{ id: string; slug: string }>(
      `insert into public.universities (name, short_name, slug, status) values ($1, $2, $3, $4) returning id, slug`,
      [`Test University ${t}`, `TU${t}`, `tu-${t}`, opts.status ?? 'active'],
    )
    const course = await this.one<{ id: string; slug: string }>(
      `insert into public.courses (university_id, code, name, slug) values ($1, $2, $3, $4) returning id, slug`,
      [university.id, `TEST ${t.toUpperCase()}`, `Test Course ${t}`, `test-${t}`],
    )
    const offering = await this.one<{ id: string; slug: string }>(
      `insert into public.course_offerings (course_id, year, term, slug) values ($1, 2026, 'fall', 'fall-2026') returning id, slug`,
      [course.id],
    )
    return { university, course, offering, path: [university.slug, course.slug, offering.slug] as const }
  }

  /** publish_assignment as `uid`. */
  publish(uid: string, payload: PublishPayload) {
    return this.rpc<{ assignment_id: string; assignment_slug: string; created: number; skipped: string[] }>(uid, 'publish_assignment', [
      JSON.stringify(payload),
    ])
  }

  /** problems of an assignment keyed by slug */
  async problemsBySlug(assignmentId: string) {
    const rows = await this.sql<{ id: string; slug: string; label: string; parent_problem_id: string | null }>(
      `select id, slug, label, parent_problem_id from public.problems where assignment_id = $1`,
      [assignmentId],
    )
    return Object.fromEntries(rows.map((r) => [r.slug, r])) as Record<string, (typeof rows)[number]>
  }

  stats(problemId: string) {
    return this.one<ProblemStats>(
      `select rating_count, mean::float8 as mean, median::float8 as median, stddev::float8 as stddev, histogram, time_count,
              median_time_minutes::float8 as median_time_minutes, completion
         from public.problem_stats where problem_id = $1`,
      [problemId],
    )
  }
}

export interface ProblemStats {
  rating_count: number
  mean: number | null
  median: number | null
  stddev: number | null
  histogram: number[]
  time_count: number
  median_time_minutes: number | null
  completion: Record<string, number>
}

export interface PublishNode {
  label: string
  title?: string
  statement_markdown?: string
  children?: PublishNode[]
}

export interface PublishPayload {
  offering_id: string
  assignment_id?: string
  assignment?: { title: string; assignment_type?: string; assignment_number?: number | null; due_date?: string; description?: string }
  source_document_id?: string
  publish_statements?: boolean
  force_distinct?: boolean
  problems: PublishNode[]
}

/** `{ label: '3', children: ['a', 'b'] }` shorthand → publish nodes */
export function problems(...labels: Array<string | [string, string[]]>): PublishNode[] {
  return labels.map((l) => (Array.isArray(l) ? { label: l[0], children: l[1].map((c) => ({ label: c })) } : { label: l }))
}
