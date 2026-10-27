import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Segmented, Toggle } from '@/components/ui/misc'
import { DEFAULT_OPTIONS, METRIC_LABELS, type HeatmapOptions, type Metric, type SortMode } from '@/components/heatmap/model'
import { searchOffering } from '@/lib/normalize'
import { displayLabel } from '@/lib/stats'
import { formatScore } from '@/lib/format'
import type { OverviewAssignment, OverviewProblem } from '@/lib/types'

const METRICS: Metric[] = ['mean', 'median', 'time', 'count']
const SORTS: SortMode[] = ['chronological', 'hardest', 'most_rated']

/** Heatmap options live in the URL so every view is shareable. Defaults are omitted to keep links short. */
export function useHeatmapOptions() {
  const [params, setParams] = useSearchParams()
  const options = useMemo<HeatmapOptions>(() => {
    const m = params.get('metric') as Metric | null
    const s = params.get('sort') as SortMode | null
    return {
      metric: m && METRICS.includes(m) ? m : DEFAULT_OPTIONS.metric,
      sort: s && SORTS.includes(s) ? s : DEFAULT_OPTIONS.sort,
      showNumbers: params.get('numbers') !== '0',
      showCounts: params.get('counts') === '1',
      onlyRated: params.get('rated') === '1',
      expand: params.get('parts') === '1',
    }
  }, [params])

  const setOptions = useCallback(
    (patch: Partial<HeatmapOptions>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          const o = { ...options, ...patch }
          const set = (k: string, v: string | null) => (v == null ? next.delete(k) : next.set(k, v))
          set('metric', o.metric === DEFAULT_OPTIONS.metric ? null : o.metric)
          set('sort', o.sort === DEFAULT_OPTIONS.sort ? null : o.sort)
          set('numbers', o.showNumbers ? null : '0')
          set('counts', o.showCounts ? '1' : null)
          set('rated', o.onlyRated ? '1' : null)
          set('parts', o.expand ? '1' : null)
          return next
        },
        { replace: true },
      )
    },
    [options, setParams],
  )
  return { options, setOptions }
}

export function HeatmapControls({ options, setOptions, hasParts }: { options: HeatmapOptions; setOptions: (p: Partial<HeatmapOptions>) => void; hasParts: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <Segmented
        label="Metric"
        value={options.metric}
        onChange={(metric) => setOptions({ metric })}
        options={METRICS.map((m) => ({ value: m, label: METRIC_LABELS[m] }))}
      />
      <Segmented
        label="Sort assignments"
        value={options.sort}
        onChange={(sort) => setOptions({ sort })}
        options={[
          { value: 'chronological', label: 'In order' },
          { value: 'hardest', label: 'Hardest' },
          { value: 'most_rated', label: 'Most rated' },
        ]}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toggle checked={options.showNumbers} onChange={(showNumbers) => setOptions({ showNumbers })} label="Numbers" />
        <Toggle checked={options.showCounts} onChange={(showCounts) => setOptions({ showCounts })} label="Counts" />
        <Toggle checked={options.onlyRated} onChange={(onlyRated) => setOptions({ onlyRated })} label="Only rated" />
        {hasParts ? <Toggle checked={options.expand} onChange={(expand) => setOptions({ expand })} label="Show parts" /> : null}
      </div>
    </div>
  )
}

/** "pset 4 problem 2", "4.2", "3b": jumps to a problem within this semester. */
export function InCourseSearch({ assignments, onPick, className }: { assignments: OverviewAssignment[]; onPick: (p: OverviewProblem, a: OverviewAssignment) => void; className?: string }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hits = useMemo(() => (q.trim() ? searchOffering(assignments, q, 8) : []), [assignments, q])
  const pick = (i: number) => {
    const h = hits[i]
    if (!h) return
    onPick(h.problem, h.assignment)
    setQ('')
    inputRef.current?.blur()
  }
  return (
    <div className={cn('relative', className)}>
      <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 focus-within:border-border-strong">
        <Search className="size-3.5 text-faint" aria-hidden />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((i) => Math.min(hits.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              pick(active)
            } else if (e.key === 'Escape') {
              setQ('')
            }
          }}
          placeholder="Find a problem — “pset 4 problem 2”"
          aria-label="Find a problem in this semester"
          className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      {focused && q.trim() ? (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 rounded-lg border border-border bg-surface p-1 shadow-lg shadow-black/5" role="listbox">
          {hits.length === 0 ? <li className="px-2 py-1.5 text-xs text-faint">No matching problem.</li> : null}
          {hits.map((h, i) => (
            <li
              key={h.problem.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
              onMouseMove={() => setActive(i)}
              className={cn('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs', i === active && 'bg-surface-2')}
            >
              <span className="font-medium">{h.assignment.title}</span>
              <span className="text-muted">· {displayLabel(h.problem, h.parentLabel)}</span>
              {h.problem.title ? <span className="truncate text-faint">{h.problem.title}</span> : null}
              <span className="ml-auto text-faint tabular">{h.problem.stats ? formatScore(h.problem.stats.mean) : '—'}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
