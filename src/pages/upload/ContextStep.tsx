import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'
import { getApi } from '@/lib/api'
import type { CourseWithOfferings } from '@/lib/api'
import { Input, Label, Select } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/misc'
import { normalizeCode } from '@/lib/normalize'
import { offeringLabel, sortOfferings } from '@/lib/format'
import type { University } from '@/lib/types'

export interface OfferingContext {
  offeringId: string
  offeringSlug: string
  offeringLabel: string
  courseId: string
  courseCode: string
  courseSlug: string
  universityId: string
  universitySlug: string
}

/** University → course → semester picker. Preselects from an offering id when one is given. */
export function ContextPicker({ initialOfferingId, value, onChange }: { initialOfferingId: string | null; value: OfferingContext | null; onChange: (c: OfferingContext | null) => void }) {
  const unis = useQuery({ queryKey: ['universities'], queryFn: () => getApi().listUniversities(), staleTime: 5 * 60_000 })
  const courseQs = useQueries({
    queries: (unis.data ?? []).map((u) => ({ queryKey: ['courses', u.id], queryFn: () => getApi().listCourses(u.id), staleTime: 60_000 })),
  })
  const [uniId, setUniId] = useState<string | null>(value?.universityId ?? null)
  const [courseId, setCourseId] = useState<string | null>(value?.courseId ?? null)
  const [filter, setFilter] = useState('')

  const coursesByUni = useMemo(() => {
    const m = new Map<string, CourseWithOfferings[]>()
    unis.data?.forEach((u, i) => m.set(u.id, courseQs[i]?.data ?? []))
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unis.data, ...courseQs.map((q) => q.data)])

  const build = (u: University, c: CourseWithOfferings, offeringId: string): OfferingContext | null => {
    const o = c.offerings.find((x) => x.id === offeringId)
    if (!o) return null
    return { offeringId: o.id, offeringSlug: o.slug, offeringLabel: offeringLabel(o), courseId: c.id, courseCode: c.code, courseSlug: c.slug, universityId: u.id, universitySlug: u.slug }
  }

  // Preselect from ?offering=
  useEffect(() => {
    if (value || !initialOfferingId || !unis.data) return
    for (const u of unis.data) {
      const c = coursesByUni.get(u.id)?.find((x) => x.offerings.some((o) => o.id === initialOfferingId))
      if (c) {
        setUniId(u.id)
        setCourseId(c.id)
        onChange(build(u, c, initialOfferingId))
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOfferingId, unis.data, coursesByUni])

  useEffect(() => {
    if (!uniId && unis.data?.length === 1) setUniId(unis.data[0].id)
  }, [uniId, unis.data])

  const uni = unis.data?.find((u) => u.id === uniId) ?? null
  const courses = useMemo(() => (uni ? coursesByUni.get(uni.id) ?? [] : []), [uni, coursesByUni])
  const course = courses.find((c) => c.id === courseId) ?? null
  const matches = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const fc = normalizeCode(filter)
    return courses.filter((c) => !f || normalizeCode(c.code).includes(fc) || c.name.toLowerCase().includes(f)).slice(0, 8)
  }, [courses, filter])

  if (unis.isLoading) return <Skeleton className="h-40" />

  return (
    <div className="space-y-4">
      {(unis.data?.length ?? 0) > 1 ? (
        <div>
          <Label htmlFor="ctx-uni">University</Label>
          <Select
            id="ctx-uni"
            value={uniId ?? ''}
            onChange={(e) => {
              setUniId(e.target.value || null)
              setCourseId(null)
              onChange(null)
            }}
          >
            <option value="">Choose…</option>
            {unis.data!.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {uni ? (
        <div>
          <Label htmlFor="ctx-course">Course</Label>
          {course ? (
            <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2/60 px-3 py-2 text-sm">
              <Check className="size-4 text-ok" />
              <span className="font-semibold">{course.code}</span>
              <span className="truncate text-muted">{course.name}</span>
              <button
                className="ml-auto text-xs text-muted underline-offset-2 hover:text-text hover:underline"
                onClick={() => {
                  setCourseId(null)
                  onChange(null)
                }}
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <Input id="ctx-course" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${uni.short_name ?? uni.name} courses — e.g. Math 55a`} autoComplete="off" />
              <ul className="mt-1.5 divide-y divide-border rounded-md border border-border" role="listbox" aria-label="Courses">
                {matches.map((c) => (
                  <li key={c.id} role="option" aria-selected={false}>
                    <button
                      className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                      onClick={() => {
                        setCourseId(c.id)
                        const latest = sortOfferings(c.offerings)[0]
                        onChange(latest ? build(uni, c, latest.id) : null)
                      }}
                    >
                      <span className="font-semibold">{c.code}</span>
                      <span className="truncate text-muted">{c.name}</span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 ? <li className="px-3 py-2 text-xs text-faint">No match.</li> : null}
              </ul>
              <p className="mt-1.5 text-xs text-muted">
                Not listed?{' '}
                <Link to={`/contribute?university=${uni.id}`} className="underline underline-offset-2 hover:text-text">
                  Add the course
                </Link>
              </p>
            </>
          )}
        </div>
      ) : null}

      {course ? (
        <div>
          <Label>Semester</Label>
          {course.offerings.length ? (
            <div className="flex flex-wrap gap-1.5">
              {sortOfferings(course.offerings).map((o) => (
                <button
                  key={o.id}
                  aria-pressed={value?.offeringId === o.id}
                  onClick={() => onChange(build(uni!, course, o.id))}
                  className={cn(
                    'h-8 rounded-md border px-3 text-sm transition-colors',
                    value?.offeringId === o.id ? 'border-text bg-text text-bg' : 'border-border hover:border-border-strong',
                  )}
                >
                  {offeringLabel(o)}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">This course has no semesters yet.</p>
          )}
          <p className="mt-1.5 text-xs text-muted">
            Different semester?{' '}
            <Link to={`/contribute?university=${uni!.id}&course=${course.id}`} className="underline underline-offset-2 hover:text-text">
              Add a semester
            </Link>
          </p>
        </div>
      ) : null}
    </div>
  )
}
