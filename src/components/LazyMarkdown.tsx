import { lazy, Suspense } from 'react'
import { Skeleton } from './ui/misc'

const Markdown = lazy(() => import('./Markdown'))

/** KaTeX + the Markdown pipeline are ~300 KB, so they load only when a statement is shown. */
export function LazyMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <Suspense fallback={<div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>}>
      <Markdown className={className}>{children}</Markdown>
    </Suspense>
  )
}
