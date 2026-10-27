import { Tooltip as T } from 'radix-ui'
import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Badge({ className, tone = 'neutral', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: 'neutral' | 'demo' | 'ok' | 'warn' | 'danger' | 'outline' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-[5px] px-1.5 py-px text-[11px] font-medium leading-4 whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'outline' && 'border border-border text-muted',
        tone === 'demo' && 'bg-demo-bg text-demo',
        tone === 'ok' && 'bg-ok/10 text-ok',
        tone === 'warn' && 'bg-warn/10 text-warn',
        tone === 'danger' && 'bg-danger/10 text-danger',
        className,
      )}
      {...props}
    />
  )
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-surface-2', className)} aria-hidden {...props} />
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn('rounded border border-border bg-surface-2 px-1 font-mono text-[10px] text-muted', className)}>{children}</kbd>
}

export const TooltipProvider = T.Provider

export function Tip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className="z-[60] max-w-xs rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs leading-relaxed text-text shadow-lg shadow-black/5 animate-fade-in">
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  )
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T
  onChange: (v: T) => void
  options: Array<{ value: T; label: ReactNode; title?: string }>
  label: string
  className?: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex max-w-full overflow-x-auto rounded-md border border-border bg-surface-2 p-0.5 [scrollbar-width:none]', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
            e.preventDefault()
            const i = options.findIndex((x) => x.value === value)
            const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length]
            onChange(next.value)
            ;(e.currentTarget.parentElement?.children[options.indexOf(next)] as HTMLElement | undefined)?.focus()
          }}
          tabIndex={value === o.value ? 0 : -1}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'bg-surface text-text shadow-sm shadow-black/5 ring-1 ring-border' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; className?: string }) {
  return (
    <label className={cn('inline-flex cursor-pointer items-center gap-2 text-xs text-muted select-none hover:text-text', className)}>
      <span className="relative inline-flex">
        <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-4 w-7 rounded-full bg-surface-3 transition-colors peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus" />
        <span className="absolute top-0.5 left-0.5 size-3 rounded-full bg-surface shadow-sm transition-transform peer-checked:translate-x-3" />
      </span>
      {label}
    </label>
  )
}

export function EmptyState({ icon, title, children, action, className }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center rounded-xl border border-dashed border-border-strong px-6 py-12 text-center', className)}>
      {icon ? <div className="mb-3 text-faint [&_svg]:size-6">{icon}</div> : null}
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {children ? <div className="mt-1.5 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-hidden />
}
