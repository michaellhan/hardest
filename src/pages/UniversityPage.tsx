import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { getApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge, Skeleton } from '@/components/ui/misc'
import { useTitle } from '@/hooks/useMisc'
import { normalizeCode } from '@/lib/normalize'
import { offeringLabel, sortOfferings } from '@/lib/format'
import NotFoundPage from './NotFoundPage'

export default function UniversityPage() {
  const { uni = '' } = useParams()
  const unis = useQuery({ queryKey: ['universities'], queryFn: () => getApi().listUniversities(), staleTime: 5 * 60_000 })
  const university = unis.data?.find((u) => u.slug === uni.toLowerCase())
  const courses = useQuery({
    queryKey: ['courses', university?.id],
    queryFn: () => getApi().listCourses(university!.id),
    enabled: Boolean(university),
    staleTime: 60_000,
  })
  const [filter, setFilter] = useState('')
  useTitle(university?.name)

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const fc = normalizeCode(filter)
    const list = (courses.data ?? []).filter((c) => !f || normalizeCode(c.code).includes(fc) || c.name.toLowerCase().includes(f))
    const by = new Map<string, typeof list>()
    for (const c of list) {
      const dept = c.department || c.code.split(/\s+/)[0]
      by.set(dept, [...(by.get(dept) ?? []), c])
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [courses.data, filter])

  if (unis.isLoading) return <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6"><Skeleton className="h-8 w-64" /><Skeleton className="mt-6 h-64" /></div>
  if (!university) return <NotFoundPage what="university" addHref="/contribute" />

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{university.name}</h1>
          <p className="mt-1 text-sm text-muted">{courses.data ? `${courses.data.length} courses` : ' '}</p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to={`/contribute?university=${university.id}`}>
            <Plus /> Add a course
          </Link>
        </Button>
      </div>
      <div className="mt-5 flex h-9 max-w-sm items-center gap-2 rounded-md border border-border bg-surface px-2.5 focus-within:border-border-strong">
        <Search className="size-4 text-faint" aria-hidden />
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter courses" aria-label="Filter courses" className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
      </div>
      {courses.isLoading ? (
        <Skeleton className="mt-6 h-64" />
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map(([dept, list]) => (
            <section key={dept}>
              <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">{dept}</h2>
              <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
                {list.map((c) => {
                  const latest = sortOfferings(c.offerings)[0]
                  return (
                    <li key={c.id}>
                      <Link to={`/${university.slug}/${c.slug}${latest ? `/${latest.slug}` : ''}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-3 hover:bg-surface-2/60">
                        <span className="font-semibold">{c.code}</span>
                        <span className="text-sm text-muted">{c.name}</span>
                        {c.is_demo ? <Badge tone="demo">demo</Badge> : null}
                        <span className="ml-auto text-xs text-faint">{latest ? `${offeringLabel(latest)}${c.offerings.length > 1 ? ` +${c.offerings.length - 1}` : ''}` : 'no semesters yet'}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
          {groups.length === 0 ? <p className="text-sm text-muted">No courses match. <Link className="underline" to={`/contribute?university=${university.id}`}>Add it</Link>.</p> : null}
        </div>
      )}
    </div>
  )
}
