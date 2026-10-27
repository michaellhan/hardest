import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export const Dialog = D.Root
export const DialogTrigger = D.Trigger
export const DialogClose = D.Close

export function DialogContent({
  title,
  description,
  children,
  className,
  hideTitle,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  className?: string
  hideTitle?: boolean
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] animate-fade-in dark:bg-black/55" />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-surface p-5 shadow-xl shadow-black/5 animate-fade-in focus:outline-none',
          className,
        )}
      >
        <div className={cn('mb-4 pr-6', hideTitle && 'sr-only')}>
          <D.Title className="text-[15px] font-semibold tracking-tight">{title}</D.Title>
          {description ? <D.Description className="mt-1 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
        </div>
        {children}
        <D.Close className="absolute top-4 right-4 rounded-md p-1 text-faint hover:bg-surface-2 hover:text-text" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </D.Portal>
  )
}

/** Full-height panel; used for problem details on small screens. */
export function SheetContent({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in dark:bg-black/55" />
      <D.Content className={cn('fixed inset-0 z-50 flex flex-col bg-surface animate-fade-in focus:outline-none sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[480px] sm:border-l sm:border-border', className)}>
        <D.Title className="sr-only">{title}</D.Title>
        <D.Description className="sr-only">{title}</D.Description>
        {children}
      </D.Content>
    </D.Portal>
  )
}
