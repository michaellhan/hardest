import { useId, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CheckCircle2, Plus, Search, Upload } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/input'
import { Badge, Skeleton } from '@/components/ui/misc'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/hooks/useAuth'
import { getApi } from '@/lib/api'
import type { CourseWithOfferings } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { normalizeCode } from '@/lib/normalize'
import { offeringLabel, sortOfferings, TERM_LABELS } from '@/lib/format'
import type { Term } from '@/lib/types'

interface UniPick {
  id: string
  slug: string
  name: string
  status: string
}
interface CoursePick {
  id: string
  slug: string
  code: string
  name: string
}
interface OfferingPick {
  id: string
  slug: string
  label: string
  existing: boolean
}

const TERMS = Object.keys(TERM_LABELS) as Term[]
const THIS_YEAR = new Date().getFullYear()
const MIN_YEAR = THIS_YEAR - 10
const MAX_YEAR = THIS_YEAR + 2

function defaultTerm(): Term {
  const m = new Date().getMonth() // 0 = January
  return m >= 6 ? 'fall' : 'spring'
}

export default function ContributePage() {
  const [params, setParams] = useSearchParams()
  const { user, openSignIn } = useAuth()
  const qc = useQueryClient()

  const [uniId, setUniId] = useState<string | null>(() => params.get('university'))
  const [courseId, setCourseId] = useState<string | null>(() => params.get('course'))
  const [createdUni, setCreatedUni] = useState<UniPick | null>(null)
  const [createdCourse, setCreatedCourse] = useState<CoursePick | null>(null)
  const [offering, setOffering] = useState<OfferingPick | null>(null)

  const unisQ = useQuery({ queryKey: ['universities'], queryFn: () => getApi().listUniversities(), staleTime: 5 * 60_000 })
  const coursesQ = useQuery({
    queryKey: ['courses', uniId],
    queryFn: () => getApi().listCourses(uniId!),
    enabled: Boolean(uniId),
    staleTime: 60_000,
  })

  // Resolve selections against loaded data; an unknown id from the URL is treated as "not chosen".
  const uniFromList = unisQ.data?.find((u) => u.id === uniId)
  const uni: UniPick | null = uniFromList
    ? { id: uniFromList.id, slug: uniFromList.slug, name: uniFromList.name, status: uniFromList.status }
    : createdUni?.id === uniId
      ? createdUni
      : null
  const uniPending = Boolean(uniId) && !uni && unisQ.isLoading

  const courseFromList = coursesQ.data?.find((c) => c.id === courseId)
  const course: CoursePick | null = uni
    ? courseFromList
      ? { id: courseFromList.id, slug: courseFromList.slug, code: courseFromList.code, name: courseFromList.name }
      : createdCourse?.id === courseId
        ? createdCourse
        : null
    : null
  const coursePending = Boolean(uni && courseId) && !course && coursesQ.isLoading

  const syncParams = (u: string | null, c: string | null) =>
    setParams(
      () => {
        const n = new URLSearchParams()
        if (u) n.set('university', u)
        if (c) n.set('course', c)
        return n
      },
      { replace: true },
    )

  const chooseUni = (u: UniPick | null, created = false) => {
    if (created && u) setCreatedUni(u)
    setUniId(u?.id ?? null)
    setCourseId(null)
    setOffering(null)
    syncParams(u?.id ?? null, null)
  }
  const chooseCourse = (c: CoursePick | null, created = false) => {
    if (created && c) setCreatedCourse(c)
    setCourseId(c?.id ?? null)
    setOffering(null)
    syncParams(uni?.id ?? null, c?.id ?? null)
  }

  const requireUser = (reason: string) => {
    if (user) return true
    openSignIn(reason)
    return false
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-xl font-semibold tracking-tight">Add a university, course, or semester</h1>
      <p className="mt-1 text-sm text-muted">
        Can’t find your class? Add it here, then upload an assignment so classmates can rate its problems. Check the existing lists first — duplicates split the
        ratings.
      </p>
      {!user ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-surface-2/50 px-3.5 py-2.5 text-sm">
          <span className="flex-1 text-muted">You can browse the lists below, but you’ll need to sign in to add anything.</span>
          <Button size="sm" variant="outline" onClick={() => openSignIn('Sign in to add courses and semesters.')}>
            Sign in
          </Button>
        </div>
      ) : null}

      <ol className="mt-6 space-y-3">
        <Step n={1} title="University" done={Boolean(uni)} summary={uni ? <UniSummary uni={uni} /> : null} onChange={() => chooseUni(null)} active>
          {uniPending ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <UniversityStep
              loading={unisQ.isLoading}
              error={unisQ.isError ? errorMessage(unisQ.error) : null}
              universities={unisQ.data ?? []}
              onChoose={(u) => chooseUni({ id: u.id, slug: u.slug, name: u.name, status: u.status })}
              onCreated={(u) => {
                qc.invalidateQueries({ queryKey: ['universities'] })
                chooseUni(u, true)
              }}
              requireUser={requireUser}
            />
          )}
        </Step>

        <Step
          n={2}
          title="Course"
          active={Boolean(uni)}
          done={Boolean(course)}
          summary={course ? <span><span className="font-medium">{course.code}</span> <span className="text-muted">{course.name}</span></span> : null}
          onChange={() => chooseCourse(null)}
        >
          {!uni ? null : coursePending ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <CourseStep
              key={uni.id}
              universityId={uni.id}
              loading={coursesQ.isLoading}
              error={coursesQ.isError ? errorMessage(coursesQ.error) : null}
              courses={coursesQ.data ?? []}
              onChoose={(c) => chooseCourse({ id: c.id, slug: c.slug, code: c.code, name: c.name })}
              onCreated={(c) => {
                qc.invalidateQueries({ queryKey: ['courses', uni.id] })
                chooseCourse(c, true)
              }}
              requireUser={requireUser}
            />
          )}
        </Step>

        <Step n={3} title="Semester" active={Boolean(course)} done={Boolean(offering)} summary={offering ? offering.label : null} onChange={() => setOffering(null)}>
          {uni && course ? (
            <SemesterStep
              key={course.id}
              courseId={course.id}
              offerings={courseFromList?.offerings ?? []}
              onChoose={setOffering}
              onCreated={(o) => {
                qc.invalidateQueries({ queryKey: ['courses', uni.id] })
                qc.invalidateQueries({ queryKey: ['path', uni.slug, course.slug] })
                setOffering(o)
              }}
              requireUser={requireUser}
            />
          ) : null}
        </Step>
      </ol>

      {uni && course && offering ? (
        <Success
          uni={uni}
          course={course}
          offering={offering}
          onAnother={() => {
            setOffering(null)
            chooseCourse(null)
          }}
        />
      ) : null}
    </div>
  )
}

// ─── layout ─────────────────────────────────────────────────────────────────

function Step({
  n,
  title,
  active,
  done,
  summary,
  onChange,
  children,
}: {
  n: number
  title: string
  active: boolean
  done: boolean
  summary: ReactNode
  onChange: () => void
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <li aria-labelledby={headingId} className={cn('rounded-xl border border-border bg-surface p-4 sm:p-5', !active && 'opacity-60')}>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular',
            done ? 'bg-accent text-accent-fg' : 'border border-border-strong text-muted',
          )}
          aria-hidden
        >
          {done ? <Check className="size-3.5" /> : n}
        </span>
        <h2 id={headingId} className="text-sm font-semibold tracking-tight">
          {title}
        </h2>
        {done ? (
          <>
            <div className="min-w-0 flex-1 truncate text-sm">{summary}</div>
            <Button size="xs" variant="ghost" onClick={onChange} aria-label={`Change ${title.toLowerCase()}`}>
              Change
            </Button>
          </>
        ) : null}
      </div>
      {active && !done ? <div className="mt-4">{children}</div> : null}
    </li>
  )
}

function UniSummary({ uni }: { uni: UniPick }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2">
      <span className="truncate">{uni.name}</span>
      {uni.status === 'pending' ? <Badge tone="warn">In review</Badge> : null}
    </span>
  )
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm text-danger" role="alert">
      {children}
    </p>
  )
}

// ─── step 1: university ─────────────────────────────────────────────────────

function UniversityStep({
  loading,
  error,
  universities,
  onChoose,
  onCreated,
  requireUser,
}: {
  loading: boolean
  error: string | null
  universities: Array<{ id: string; slug: string; name: string; short_name: string | null; status: string }>
  onChoose: (u: { id: string; slug: string; name: string; status: string }) => void
  onCreated: (u: UniPick) => void
  requireUser: (reason: string) => boolean
}) {
  const toast = useToast()
  const [mode, setMode] = useState<'choose' | 'create'>('choose')
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [shortName, setShortName] = useState('')
  const [domain, setDomain] = useState('')
  const [errors, setErrors] = useState<{ name?: string; domain?: string }>({})
  const [busy, setBusy] = useState(false)

  const sorted = useMemo(() => [...universities].sort((a, b) => a.name.localeCompare(b.name)), [universities])

  if (loading) return <Skeleton className="h-9 w-full" />
  if (error) return <ErrorText>{error}</ErrorText>

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    const n = name.trim()
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')
    if (n.length < 3) errs.name = 'Enter the university’s full name.'
    if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(d)) errs.domain = 'Enter a domain like harvard.edu.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    if (!requireUser('Sign in to add a university.')) return
    setBusy(true)
    try {
      const res = await getApi().createUniversity({ name: n, short_name: shortName.trim() || undefined, domain: d || undefined })
      if (res.existing) {
        toast({ tone: 'info', message: 'That university is already listed — selected it for you.' })
      } else if (res.status === 'pending') {
        toast({ tone: 'success', message: 'University submitted. It will appear publicly once a moderator approves it.' })
      } else {
        toast({ tone: 'success', message: 'University added.' })
      }
      const match = universities.find((u) => u.id === res.id)
      onCreated({ id: res.id, slug: res.slug, name: match?.name ?? n, status: res.status })
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  if (mode === 'choose') {
    return (
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault()
          const u = universities.find((x) => x.id === selected)
          if (u) onChoose(u)
        }}
      >
        <Field label="Choose a university" htmlFor="contrib-uni" className="min-w-0 flex-1">
          <Select
            id="contrib-uni"
            value={selected}
            onChange={(e) => {
              if (e.target.value === '__new') {
                setMode('create')
                return
              }
              setSelected(e.target.value)
              const u = universities.find((x) => x.id === e.target.value)
              if (u) onChoose(u)
            }}
          >
            <option value="" disabled>
              Select…
            </option>
            {sorted.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.short_name && u.short_name !== u.name ? ` (${u.short_name})` : ''}
              </option>
            ))}
            <option value="__new">Not listed — add a university…</option>
          </Select>
        </Field>
        <Button variant="ghost" onClick={() => setMode('create')}>
          <Plus /> Add new
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={create} className="space-y-3" noValidate>
      <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
        New universities are reviewed by a moderator before they appear publicly. You can add courses and assignments right away; they’ll become visible once the
        university is approved.
      </p>
      <Field label="Full name" htmlFor="uni-name" error={errors.name}>
        <Input
          id="uni-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          placeholder="e.g. Massachusetts Institute of Technology"
          aria-invalid={Boolean(errors.name)}
          autoFocus
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Short name (optional)" htmlFor="uni-short" hint="Used in the URL, e.g. “MIT”.">
          <Input id="uni-short" value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={40} placeholder="MIT" />
        </Field>
        <Field label="Email domain (optional)" htmlFor="uni-domain" error={errors.domain} hint="Helps us catch duplicates.">
          <Input
            id="uni-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            maxLength={100}
            placeholder="mit.edu"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(errors.domain)}
          />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setMode('choose')} disabled={busy}>
          Back to list
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Adding…' : 'Add university'}
        </Button>
      </div>
    </form>
  )
}

// ─── step 2: course ─────────────────────────────────────────────────────────

const SHOWN = 8

function CourseStep({
  universityId,
  loading,
  error,
  courses,
  onChoose,
  onCreated,
  requireUser,
}: {
  universityId: string
  loading: boolean
  error: string | null
  courses: CourseWithOfferings[]
  onChoose: (c: CourseWithOfferings) => void
  onCreated: (c: CoursePick) => void
  requireUser: (reason: string) => boolean
}) {
  const toast = useToast()
  const [filter, setFilter] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [creating, setCreating] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<{ code?: string; name?: string }>({})
  const [busy, setBusy] = useState(false)

  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const fc = normalizeCode(filter)
    const list = [...courses].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    if (!f) return list
    return list.filter((c) => (fc && normalizeCode(c.code).includes(fc)) || c.name.toLowerCase().includes(f) || (c.department ?? '').toLowerCase().includes(f))
  }, [courses, filter])

  const codeMatch = useMemo(() => {
    const n = normalizeCode(code)
    return n ? courses.find((c) => normalizeCode(c.code) === n) ?? null : null
  }, [courses, code])

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
  if (error) return <ErrorText>{error}</ErrorText>

  const startCreate = () => {
    setCreating(true)
    if (!code && filter.trim() && /\d/.test(filter)) setCode(filter.trim().toUpperCase())
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    const errs: typeof errors = {}
    if (!normalizeCode(code)) errs.code = 'Enter the course code, e.g. MATH 55A.'
    else if (code.trim().length > 30) errs.code = 'Course codes are at most 30 characters.'
    if (name.trim().length < 2) errs.name = 'Enter the course title.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    if (!requireUser('Sign in to add a course.')) return
    setBusy(true)
    try {
      const res = await getApi().createCourse({
        universityId,
        code: code.trim(),
        name: name.trim(),
        department: department.trim() || undefined,
        description: description.trim() || undefined,
      })
      const known = courses.find((c) => c.id === res.id)
      if (res.existing) toast({ tone: 'info', message: `${known?.code ?? 'That course'} already exists — selected it for you.` })
      else toast({ tone: 'success', message: 'Course added.' })
      onCreated({ id: res.id, slug: res.slug, code: known?.code ?? code.trim().replace(/\s+/g, ' ').toUpperCase(), name: known?.name ?? name.trim() })
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  if (creating) {
    return (
      <form onSubmit={create} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Course code" htmlFor="course-code" error={errors.code}>
            <Input
              id="course-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={30}
              placeholder="MATH 55A"
              autoCapitalize="characters"
              spellCheck={false}
              aria-invalid={Boolean(errors.code)}
              aria-describedby={codeMatch ? 'course-code-match' : undefined}
              autoFocus
            />
          </Field>
          <Field label="Course title" htmlFor="course-name" error={errors.name}>
            <Input
              id="course-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              placeholder="Honors Abstract Algebra"
              aria-invalid={Boolean(errors.name)}
            />
          </Field>
        </div>
        {codeMatch ? (
          <div id="course-code-match" role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-sm">
            <AlertTriangle className="size-4 shrink-0 text-warn" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{codeMatch.code}</span> <span className="text-muted">{codeMatch.name}</span> already exists.
            </span>
            <Button size="xs" variant="outline" onClick={() => onChoose(codeMatch)}>
              Use it
            </Button>
          </div>
        ) : null}
        <Field label="Department (optional)" htmlFor="course-dept">
          <Input id="course-dept" value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={100} placeholder="Mathematics" />
        </Field>
        <Field label="Description (optional)" htmlFor="course-desc">
          <Textarea id="course-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
            Back to list
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Adding…' : codeMatch ? 'Use existing course' : 'Add course'}
          </Button>
        </div>
      </form>
    )
  }

  const shown = showAll ? matches : matches.slice(0, SHOWN)
  return (
    <div className="space-y-3">
      <div className="relative">
        <label htmlFor="course-filter" className="sr-only">
          Filter courses
        </label>
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <Input
          id="course-filter"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value)
            setShowAll(false)
          }}
          placeholder={courses.length ? `Search ${courses.length} courses by code or title` : 'No courses yet'}
          className="pl-8"
          autoComplete="off"
          disabled={!courses.length}
        />
      </div>

      {courses.length ? (
        matches.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Matching courses">
            {shown.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onChoose(c)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    <span className="font-medium">{c.code}</span> <span className="text-muted">{c.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-faint tabular">
                    {c.offerings.length ? `${c.offerings.length} sem.` : ''}
                  </span>
                </button>
              </li>
            ))}
            {matches.length > SHOWN && !showAll ? (
              <li>
                <button type="button" onClick={() => setShowAll(true)} className="w-full px-3 py-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-text">
                  Show all {matches.length}
                </button>
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="text-sm text-muted">No course matches “{filter.trim()}”.</p>
        )
      ) : (
        <p className="text-sm text-muted">No courses have been added for this university yet.</p>
      )}

      <Button variant={courses.length && matches.length ? 'ghost' : 'outline'} size="sm" onClick={startCreate}>
        <Plus /> Add a new course
      </Button>
    </div>
  )
}

// ─── step 3: semester ───────────────────────────────────────────────────────

function SemesterStep({
  courseId,
  offerings,
  onChoose,
  onCreated,
  requireUser,
}: {
  courseId: string
  offerings: CourseWithOfferings['offerings']
  onChoose: (o: OfferingPick) => void
  onCreated: (o: OfferingPick) => void
  requireUser: (reason: string) => boolean
}) {
  const toast = useToast()
  const [term, setTerm] = useState<Term>(defaultTerm)
  const [year, setYear] = useState(String(THIS_YEAR))
  const [section, setSection] = useState('')
  const [instructor, setInstructor] = useState('')
  const [yearError, setYearError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sorted = sortOfferings(offerings)
  const y = Number(year)
  const dupe = offerings.find((o) => o.term === term && o.year === y && o.section === section.trim())

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{4}$/.test(year.trim()) || y < MIN_YEAR || y > MAX_YEAR) {
      setYearError(`Enter a year between ${MIN_YEAR} and ${MAX_YEAR}.`)
      return
    }
    setYearError(null)
    if (dupe) {
      onChoose({ id: dupe.id, slug: dupe.slug, label: offeringLabel(dupe), existing: true })
      return
    }
    if (!requireUser('Sign in to add a semester.')) return
    setBusy(true)
    try {
      const res = await getApi().createOffering({ courseId, year: y, term, section: section.trim() || undefined, instructor: instructor.trim() || undefined })
      onCreated({ id: res.id, slug: res.slug, label: offeringLabel({ term, year: y, section: section.trim() }), existing: res.existing })
      if (res.existing) toast({ tone: 'info', message: 'That semester was already listed — selected it for you.' })
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      {sorted.length ? (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Already listed</p>
          <ul className="flex flex-wrap gap-1.5" aria-label="Existing semesters">
            {sorted.map((o) => (
              <li key={o.id}>
                <Button size="xs" variant="outline" onClick={() => onChoose({ id: o.id, slug: o.slug, label: offeringLabel(o), existing: true })}>
                  {offeringLabel(o)}
                  {o.instructor ? <span className="font-normal text-faint">· {o.instructor}</span> : null}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form onSubmit={create} className="space-y-3" noValidate aria-label="Add a semester">
        {sorted.length ? <p className="text-xs font-medium text-muted">Or add a semester</p> : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_120px_1fr]">
          <Field label="Term" htmlFor="sem-term">
            <Select id="sem-term" value={term} onChange={(e) => setTerm(e.target.value as Term)}>
              {TERMS.map((t) => (
                <option key={t} value={t}>
                  {TERM_LABELS[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" htmlFor="sem-year" error={yearError ?? undefined}>
            <Input
              id="sem-year"
              type="number"
              inputMode="numeric"
              min={MIN_YEAR}
              max={MAX_YEAR}
              step={1}
              value={year}
              onChange={(e) => {
                setYear(e.target.value)
                setYearError(null)
              }}
              aria-invalid={Boolean(yearError)}
              className="tabular"
            />
          </Field>
          <Field label="Section (optional)" htmlFor="sem-section" className="col-span-2 sm:col-span-1" hint="Only if sections have different assignments.">
            <Input id="sem-section" value={section} onChange={(e) => setSection(e.target.value)} maxLength={40} placeholder="e.g. Lecture 2" />
          </Field>
        </div>
        <Field label="Instructor (optional)" htmlFor="sem-instructor">
          <Input id="sem-instructor" value={instructor} onChange={(e) => setInstructor(e.target.value)} maxLength={120} placeholder="e.g. Prof. Gross" />
        </Field>
        {dupe ? (
          <p className="text-xs text-muted" role="status">
            {offeringLabel(dupe)} is already listed — continuing will use it.
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Adding…' : dupe ? 'Use this semester' : 'Add semester'}
          </Button>
        </div>
      </form>
    </div>
  )
}

// ─── done ───────────────────────────────────────────────────────────────────

function Success({ uni, course, offering, onAnother }: { uni: UniPick; course: CoursePick; offering: OfferingPick; onAnother: () => void }) {
  const href = `/${uni.slug}/${course.slug}/${offering.slug}`
  return (
    <section aria-live="polite" className="mt-4 rounded-xl border border-border-strong bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold tracking-tight">
            {course.code} · {offering.label} {offering.existing ? 'is listed' : 'is ready'}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Next, upload an assignment (PDF, LaTeX, Word, or pasted text) so classmates can rate its problems.
            {uni.status === 'pending' ? ' It will be visible to others once the university is approved.' : ''}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild variant="primary" size="sm">
              <Link to={`/upload?offering=${encodeURIComponent(offering.id)}`}>
                <Upload /> Upload an assignment
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={href}>Open course page</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={onAnother}>
              Add another course
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
