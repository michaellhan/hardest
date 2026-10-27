import { memo, useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { difficultyColor, type Theme } from '@/lib/scale'
import { formatCount, formatMinutes, formatScore } from '@/lib/format'
import { LOW_SAMPLE } from '@/lib/stats'
import type { MyRating, OfferingOverview, OverviewAssignment, OverviewProblem } from '@/lib/types'
import { buildHeatmap, cellAppearance, type CellModel, type HeatmapOptions, type RowModel } from './model'

interface Props {
  overview: OfferingOverview
  myRatings?: Record<string, MyRating>
  options: HeatmapOptions
  theme: Theme
  selectedProblemId?: string | null
  selectedAssignmentId?: string | null
  onSelectProblem: (problem: OverviewProblem, assignment: OverviewAssignment) => void
  onSelectAssignment: (assignment: OverviewAssignment) => void
  showAverage?: boolean
}

interface TipState {
  cell: CellModel
  x: number
  y: number
  below: boolean
}

export function Heatmap({ overview, myRatings, options, theme, selectedProblemId, selectedAssignmentId, onSelectProblem, onSelectAssignment, showAverage = true }: Props) {
  const model = useMemo(() => buildHeatmap(overview, myRatings, options), [overview, myRatings, options])
  const wrapRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TipState | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const activeKey = focusKey ?? (model.rows.flatMap((r) => r.cells).find((c) => c.problem.id === selectedProblemId)?.key ?? model.rows[0]?.cells[0]?.key ?? null)

  const showTip = useCallback((cell: CellModel, el: HTMLElement) => {
    const wrap = wrapRef.current
    if (!wrap) return
    const a = el.getBoundingClientRect()
    const b = wrap.getBoundingClientRect()
    const below = a.top - b.top < 120
    setTip({ cell, x: Math.min(Math.max(a.left - b.left + a.width / 2, 120), b.width - 120), y: below ? a.bottom - b.top + 8 : a.top - b.top - 8, below })
  }, [])
  const hideTip = useCallback(() => setTip(null), [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    const r = Number(t.dataset.r)
    const c = Number(t.dataset.c)
    if (Number.isNaN(r) || Number.isNaN(c)) return
    let nr = r
    let nc = c
    if (e.key === 'ArrowRight') nc++
    else if (e.key === 'ArrowLeft') nc--
    else if (e.key === 'ArrowDown') nr++
    else if (e.key === 'ArrowUp') nr--
    else if (e.key === 'Home') nc = 0
    else if (e.key === 'End') nc = model.rows[r].cells.length - 1
    else if (e.key === 'Escape') return hideTip()
    else return
    e.preventDefault()
    nr = Math.min(Math.max(nr, 0), model.rows.length - 1)
    nc = Math.min(Math.max(nc, 0), model.rows[nr].cells.length - 1)
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)
    if (el) {
      setFocusKey(model.rows[nr].cells[nc].key)
      el.focus()
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  const cellW = model.wide ? 'w-[92px]' : 'w-10 sm:w-11'

  return (
    <div ref={wrapRef} className="relative" onMouseLeave={hideTip}>
      <div className="scrollbar-thin overflow-x-auto pb-2" onScroll={hideTip}>
        <div role="grid" aria-label="Problem difficulty heatmap" aria-rowcount={model.rows.length} className="inline-flex min-w-full flex-col gap-[3px]" onKeyDown={onKeyDown}>
          {!options.expand && !model.wide && model.columns > 0 ? (
            <div role="row" className="flex items-end gap-[3px] text-[10px] font-medium text-faint tabular" aria-hidden>
              <div className="sticky left-0 z-10 w-[88px] shrink-0 bg-bg sm:w-[168px]" />
              {showAverage ? <div className="mr-2 w-12 shrink-0 pb-0.5 text-center">avg</div> : null}
              {Array.from({ length: model.columns }, (_, i) => (
                <div key={i} className={cn(cellW, 'shrink-0 pb-0.5 text-center')}>
                  {i + 1}
                </div>
              ))}
            </div>
          ) : null}
          {model.rows.map((row, r) => (
            <Row
              key={row.assignment.id}
              row={row}
              r={r}
              theme={theme}
              options={options}
              maxCount={model.maxCount}
              cellW={cellW}
              wide={model.wide}
              activeKey={activeKey}
              selectedProblemId={selectedProblemId ?? null}
              selected={row.assignment.id === selectedAssignmentId}
              showAverage={showAverage}
              onFocusCell={setFocusKey}
              onSelectProblem={onSelectProblem}
              onSelectAssignment={onSelectAssignment}
              showTip={showTip}
              hideTip={hideTip}
            />
          ))}
        </div>
      </div>
      {model.hiddenRows > 0 ? <p className="mt-1 text-xs text-faint">{formatCount(model.hiddenRows, 'assignment')} with no ratings hidden.</p> : null}
      {tip ? <CellTooltip tip={tip} metric={options.metric} /> : null}
    </div>
  )
}

const Row = memo(function Row({
  row,
  r,
  theme,
  options,
  maxCount,
  cellW,
  wide,
  activeKey,
  selectedProblemId,
  selected,
  showAverage,
  onFocusCell,
  onSelectProblem,
  onSelectAssignment,
  showTip,
  hideTip,
}: {
  row: RowModel
  r: number
  theme: Theme
  options: HeatmapOptions
  maxCount: number
  cellW: string
  wide: boolean
  activeKey: string | null
  selectedProblemId: string | null
  selected: boolean
  showAverage: boolean
  onFocusCell: (k: string) => void
  onSelectProblem: Props['onSelectProblem']
  onSelectAssignment: Props['onSelectAssignment']
  showTip: (c: CellModel, el: HTMLElement) => void
  hideTip: () => void
}) {
  const s = row.summary
  const avg = s.mean != null ? difficultyColor(s.mean, theme) : null
  return (
    <div role="row" className="group/row flex items-center gap-[3px]">
      <div role="rowheader" className="sticky left-0 z-10 w-[88px] shrink-0 bg-bg pr-2 sm:w-[168px]">
        <button
          onClick={() => onSelectAssignment(row.assignment)}
          className={cn(
            'flex w-full min-w-0 items-baseline gap-2 rounded px-1 py-1 text-left text-[13px] hover:bg-surface-2',
            selected ? 'font-semibold text-text' : 'text-text/90',
          )}
          title={`${row.assignment.title} — open assignment and quick-rate`}
        >
          <span className="truncate sm:hidden">{row.shortTitle}</span>
          <span className="hidden truncate sm:inline">{row.assignment.title}</span>
          <span className="ml-auto hidden shrink-0 text-[11px] text-faint tabular sm:inline">
            {s.ratedUnits}/{s.totalUnits}
          </span>
        </button>
      </div>
      {showAverage ? (
        <div
          className={cn('mr-2 flex h-9 w-12 shrink-0 items-center justify-center rounded-[5px] text-[12px] font-semibold tabular sm:h-[38px]', !avg && 'border border-dashed border-border text-faint')}
          style={avg ? { backgroundColor: avg.bg, color: avg.fg } : undefined}
          title={s.mean != null ? `Assignment average ${s.mean.toFixed(2)} — mean of ${s.ratedUnits} rated problem${s.ratedUnits === 1 ? '' : 's'} (of ${s.totalUnits}); unrated problems excluded` : 'No ratings yet'}
          aria-label={s.mean != null ? `${row.assignment.title} average difficulty ${s.mean.toFixed(1)}` : `${row.assignment.title} has no ratings yet`}
        >
          {s.mean != null ? s.mean.toFixed(1) : '—'}
        </div>
      ) : null}
      {row.cells.length === 0 ? <span className="px-1 text-xs text-faint">No problems listed yet</span> : null}
      {row.cells.map((cell, c) => {
        const look = cellAppearance(cell, options.metric, theme, maxCount)
        const isSel = cell.problem.id === selectedProblemId
        const aria = describeCell(cell, row.assignment.title)
        return (
          <button
            key={cell.key}
            role="gridcell"
            data-r={r}
            data-c={c}
            tabIndex={cell.key === activeKey ? 0 : -1}
            aria-label={aria}
            aria-selected={isSel}
            onClick={() => onSelectProblem(cell.problem, row.assignment)}
            onFocus={(e) => {
              onFocusCell(cell.key)
              showTip(cell, e.currentTarget)
            }}
            onBlur={hideTip}
            onMouseEnter={(e) => showTip(cell, e.currentTarget)}
            style={look.swatch ? { backgroundColor: look.swatch.bg, color: look.swatch.fg } : undefined}
            className={cn(
              cellW,
              'relative flex h-9 shrink-0 flex-col items-center justify-center rounded-[5px] text-[12px] font-medium tabular transition-[transform,box-shadow] duration-100 hover:z-[1] hover:scale-[1.06] focus-visible:z-[2] focus-visible:outline-offset-1 sm:h-[38px]',
              options.expand && cell.groupStart && c > 0 && 'ml-1.5',
              look.state === 'unrated' && 'border border-dashed border-border-strong text-faint',
              look.state === 'no-data' && 'border border-border bg-surface-2 text-faint',
              isSel && 'ring-2 ring-text ring-offset-1 ring-offset-bg',
            )}
          >
            {look.lowSample ? <span className="hatch pointer-events-none absolute inset-0 rounded-[5px]" aria-hidden /> : null}
            {wide ? <span className="relative max-w-full truncate px-1 text-[10px] leading-3 opacity-75">{cell.label}</span> : null}
            <span className={cn('relative leading-4', !options.showNumbers && look.state === 'value' && 'sr-only')}>
              {/* Unrated cells show their label (never a color or a number) so gaps are easy to spot. */}
              {look.state === 'unrated' && !wide ? <span className="text-[10px]">{cell.label.length <= 4 ? cell.label : '—'}</span> : look.text}
            </span>
            {options.showCounts && cell.count > 0 && options.metric !== 'count' ? (
              <span className="absolute right-[3px] bottom-[1px] text-[8.5px] leading-none opacity-70">{cell.count}</span>
            ) : null}
            {cell.mine ? (
              <span
                aria-hidden
                className={cn(
                  'absolute top-[3px] right-[3px] size-[5px] rounded-full',
                  cell.mine === 'rated' && 'bg-current opacity-80',
                  cell.mine === 'partial' && 'border border-current opacity-80',
                  cell.mine === 'stale' && 'bg-warn',
                )}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
})

function describeCell(cell: CellModel, assignmentTitle: string) {
  const name = `${assignmentTitle}, problem ${cell.fullLabel}${cell.title ? ` (${cell.title})` : ''}`
  if (cell.count === 0) return `${name}: not rated yet. Press Enter to open.`
  const parts = [
    `average ${formatScore(cell.mean)}`,
    cell.median != null ? `median ${formatScore(cell.median)}` : null,
    formatCount(cell.count, 'rating'),
    cell.timeMinutes != null ? `median time ${formatMinutes(cell.timeMinutes)}` : null,
    cell.count < LOW_SAMPLE ? 'low sample' : null,
    cell.myRating != null ? `your rating ${cell.myRating}` : cell.mine === 'partial' ? 'you rated some parts' : cell.mine === 'stale' ? 'your rating is from an earlier version' : null,
  ].filter(Boolean)
  return `${name}: ${parts.join(', ')}.`
}

function CellTooltip({ tip, metric }: { tip: TipState; metric: string }) {
  const c = tip.cell
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 w-60 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs shadow-xl shadow-black/[0.07] animate-fade-in"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-semibold">
          {c.assignment.title} · {/^\d/.test(c.fullLabel) ? 'Problem ' : ''}
          {c.fullLabel}
        </span>
      </div>
      {c.title ? <div className="mt-0.5 truncate text-muted">{c.title.replace(/\$/g, '')}</div> : null}
      {c.count === 0 ? (
        <div className="mt-1.5 text-muted">Not rated yet — click to be the first.</div>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 tabular">
          <dt className="text-muted">Average</dt>
          <dd className={cn('text-right font-medium', metric === 'mean' && 'text-text')}>{formatScore(c.mean)} / 10</dd>
          <dt className="text-muted">Median</dt>
          <dd className="text-right">{formatScore(c.median)}</dd>
          <dt className="text-muted">Ratings</dt>
          <dd className="text-right">{c.count.toLocaleString()}</dd>
          <dt className="text-muted">Median time</dt>
          <dd className="text-right">{c.timeMinutes != null ? `${formatMinutes(c.timeMinutes)}` : <span className="text-faint">no data</span>}</dd>
        </dl>
      )}
      {c.derived ? <div className="mt-1.5 text-faint">Combined from {c.ratedParts} of {c.parts} parts (mean of part averages).</div> : null}
      {c.count > 0 && c.count < LOW_SAMPLE ? <div className="mt-1.5 text-warn">Low sample — treat with caution.</div> : null}
      {c.myRating != null ? <div className="mt-1.5 text-muted">Your rating: <span className="font-medium text-text">{c.myRating}</span></div> : null}
      {c.mine === 'partial' ? <div className="mt-1.5 text-muted">You’ve rated some parts.</div> : null}
      {c.mine === 'stale' ? <div className="mt-1.5 text-warn">The problem changed since you rated it.</div> : null}
    </div>
  )
}
