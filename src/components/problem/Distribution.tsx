import { cn } from '@/lib/cn'
import { difficultyColor, type Theme } from '@/lib/scale'

/** 1–10 histogram. Bars are colored by the difficulty they represent; the user's own vote is outlined. */
export function Distribution({ histogram, theme, mine, height = 56, className }: { histogram: number[]; theme: Theme; mine?: number | null; height?: number; className?: string }) {
  const max = Math.max(1, ...histogram)
  const total = histogram.reduce((a, b) => a + b, 0)
  return (
    <figure className={className}>
      <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={`Rating distribution: ${histogram.map((c, i) => `${c} rated ${i + 1}`).join(', ')}`}>
        {histogram.map((c, i) => {
          const sw = difficultyColor(i + 1, theme)
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={`${i + 1}: ${c} rating${c === 1 ? '' : 's'}${total ? ` (${Math.round((c / total) * 100)}%)` : ''}`}>
              <div
                className={cn('rounded-t-[3px] transition-[height] duration-300', mine === i + 1 && 'ring-2 ring-text ring-offset-1 ring-offset-surface')}
                style={{ height: c ? `${Math.max(6, (c / max) * 100)}%` : 2, backgroundColor: c ? sw.bg : 'var(--border)' }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-[3px] text-center text-[10px] text-faint tabular" aria-hidden>
        {histogram.map((_, i) => (
          <span key={i} className="flex-1">
            {i + 1}
          </span>
        ))}
      </div>
    </figure>
  )
}
