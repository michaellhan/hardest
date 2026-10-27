import { difficultyColor, timeColor, countColor, type Theme } from '@/lib/scale'
import { LOW_SAMPLE } from '@/lib/stats'
import type { Metric } from './model'

function gradient(stops: string[]) {
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

export function Legend({ metric, theme, maxCount }: { metric: Metric; theme: Theme; maxCount: number }) {
  let bar: string
  // Third element: hide the tick on narrow screens, where the bar is too short for it.
  let ticks: Array<[string, number, boolean?]>
  let caption: string
  if (metric === 'time') {
    const mins = [10, 20, 45, 90, 180, 480]
    bar = gradient(mins.map((m) => timeColor(m, theme).bg))
    ticks = [['10m', 0], ['45m', 0.4], ['3h', 0.77], ['8h+', 1]]
    caption = 'Median time spent'
  } else if (metric === 'count') {
    bar = gradient([0, 0.1, 0.3, 0.6, 1].map((t) => countColor(t * maxCount, maxCount, theme).bg))
    ticks = [['1', 0], [String(Math.round(maxCount / 4)), 0.5], [String(maxCount), 1]]
    caption = 'Number of ratings'
  } else {
    bar = gradient(Array.from({ length: 19 }, (_, i) => difficultyColor(1 + i * 0.5, theme).bg))
    ticks = [['1 trivial', 0], ['3', 2 / 9, true], ['5 moderate', 4 / 9], ['7', 6 / 9, true], ['10 extreme', 1]]
    caption = metric === 'mean' ? 'Average difficulty' : 'Median difficulty'
  }
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-muted" aria-label="Legend">
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline">{caption}</span>
        <div className="w-44 sm:w-56">
          <div className="h-2 rounded-full" style={{ background: bar }} />
          <div className="relative mt-1 h-3 tabular">
            {ticks.map(([t, p, wide], i) => (
              // End labels sit inside the bar's ends; the rest are centred on their position.
              <span
                key={t}
                className={`absolute whitespace-nowrap text-[10px] text-faint ${wide ? 'hidden sm:block' : ''}`}
                style={i === 0 ? { left: 0 } : i === ticks.length - 1 ? { right: 0 } : { left: `${p * 100}%`, transform: 'translateX(-50%)' }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block size-3.5 rounded-[3px] border border-dashed border-border-strong" /> Unrated
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="relative inline-block size-3.5 overflow-hidden rounded-[3px]" style={{ background: difficultyColor(6, theme).bg }}>
          <span className="hatch absolute inset-0" />
        </span>
        Fewer than {LOW_SAMPLE} ratings
      </span>
      {metric === 'time' ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3.5 rounded-[3px] border border-border bg-surface-2" /> Rated, no time data
        </span>
      ) : null}
      <span className="inline-flex items-center gap-1.5">
        <span className="relative inline-block size-3.5 rounded-[3px] bg-surface-3">
          <span className="absolute top-[2px] right-[2px] size-[4px] rounded-full bg-text/70" />
        </span>
        You rated
      </span>
    </div>
  )
}
