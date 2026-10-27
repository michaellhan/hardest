import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CornerDownLeft, FileText, Plus, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { getApi } from '@/lib/api'
import { parseCourseQuery } from '@/lib/normalize'
import { offeringLabel, sortOfferings } from '@/lib/format'
import { displayLabel } from '@/lib/stats'
import type { CourseSearchResult } from '@/lib/types'

interface Item {
  key: string
  kind: 'course' | 'problem' | 'add'
  href: string
  primary: string
  secondary: string
  meta?: string
}

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Picks the offering a query refers to ("math 55a f25"), else the most recent one. */
function pickOffering(r: CourseSearchResult, term: string | null, year: number | null) {
  const sorted = sortOfferings(r.offerings)
  return sorted.find((o) => (!term || o.term === term) && (!year || o.year === year)) ?? sorted[0] ?? null
}

/**
 * Course finder with typo tolerance (trigram matching server-side) and semester parsing. Also searches
 * problem statements once the query looks like prose.
 */
export function CourseSearch({ autoFocus, onDone, size = 'md', floating, className }: { autoFocus?: boolean; onDone?: () => void; size?: 'md' | 'lg'; floating?: boolean; className?: string }) {
  const navigate = useNavigate()
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const debounced = useDebounced(q.trim(), 140)
  const parsed = useMemo(() => parseCourseQuery(debounced), [debounced])

  const courses = useQuery({
    queryKey: ['search', 'courses', parsed.text || debounced],
    queryFn: () => getApi().searchCourses(parsed.text || debounced),
    enabled: debounced.length > 0,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  })
  const wantsProblems = debounced.split(/\s+/).filter((w) => w.length > 2).length >= 2
  const problems = useQuery({
    queryKey: ['search', 'problems', debounced],
    queryFn: () => getApi().searchProblems(debounced),
    enabled: wantsProblems,
    staleTime: 60_000,
  })

  const items: Item[] = useMemo(() => {
    if (!debounced) return []
    const out: Item[] = []
    for (const r of courses.data ?? []) {
      const o = pickOffering(r, parsed.term, parsed.year)
      out.push({
        key: `c:${r.course_id}`,
        kind: 'course',
        href: o ? `/${r.university_slug}/${r.slug}/${o.slug}` : `/${r.university_slug}/${r.slug}`,
        primary: r.code,
        secondary: r.name,
        meta: o ? `${offeringLabel(o)}${r.offerings.length > 1 ? ` · ${r.offerings.length} semesters` : ''}` : 'No semesters yet',
      })
    }
    for (const p of (wantsProblems ? problems.data : null) ?? []) {
      out.push({
        key: `p:${p.problem_id}`,
        kind: 'problem',
        href: `/${p.university_slug}/${p.course_slug}/${p.offering_slug}/${p.assignment_slug}/${p.problem_slug}`,
        primary: `${p.course_code} · ${p.assignment_title} · ${displayLabel({ label: p.label }, p.parent_label)}`,
        secondary: p.snippet.replace(/[«»]/g, ''),
      })
    }
    out.push({ key: 'add', kind: 'add', href: '/contribute', primary: 'Can’t find your course?', secondary: 'Add a course or semester' })
    return out
  }, [debounced, courses.data, problems.data, parsed.term, parsed.year, wantsProblems])

  useEffect(() => setActive(0), [debounced])

  const go = (item: Item | undefined) => {
    if (!item) return
    navigate(item.href)
    setQ('')
    onDone?.()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(items.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(items[active])
    } else if (e.key === 'Escape' && q) {
      e.stopPropagation()
      setQ('')
    }
  }

  const open = items.length > 0
  const loading = courses.isFetching && !courses.data

  return (
    <div className={cn('relative', className)}>
      <div className={cn('flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-focus/25', size === 'lg' ? 'h-12' : 'h-10')}>
        <Search className="size-4 shrink-0 text-faint" aria-hidden />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          aria-autocomplete="list"
          aria-label="Search courses and problems"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search a course — e.g. Math 55a, Stat 110, CS 1210 F26"
          className={cn('h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint', size === 'lg' ? 'text-[15px]' : 'text-sm')}
          spellCheck={false}
          autoComplete="off"
        />
        {loading ? <span className="size-3 animate-spin rounded-full border-2 border-faint border-r-transparent" aria-hidden /> : null}
      </div>
      {open ? (
        <ul id={listId} role="listbox" className={cn('mt-1.5 max-h-[min(60vh,420px)] overflow-y-auto rounded-lg border border-border bg-surface p-1 shadow-lg shadow-black/5', floating && 'absolute inset-x-0 top-full z-30')}>
          {debounced && courses.data && courses.data.length === 0 && !courses.isFetching ? <li className="px-2.5 py-2 text-xs text-faint">No courses match “{debounced}”.</li> : null}
                    {items.map((item, i) => (
            <li
              key={item.key}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault()
                go(item)
              }}
              className={cn('flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2', i === active && 'bg-surface-2')}
            >
              {item.kind === 'problem' ? <FileText className="size-4 shrink-0 text-faint" /> : item.kind === 'add' ? <Plus className="size-4 shrink-0 text-faint" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={cn('truncate text-sm', item.kind === 'course' ? 'font-semibold' : 'font-medium', item.kind === 'add' && 'text-muted')}>{item.primary}</span>
                  {item.kind === 'course' ? <span className="truncate text-sm text-muted">{item.secondary}</span> : null}
                </div>
                {item.kind !== 'course' ? <p className="truncate text-xs text-muted">{item.secondary}</p> : null}
              </div>
              {item.meta ? <span className="hidden shrink-0 text-xs text-faint sm:inline">{item.meta}</span> : null}
              {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
