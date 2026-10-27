import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useTitle } from '@/hooks/useMisc'

export default function NotFoundPage({ what = 'page', hint, addHref, children }: { what?: string; hint?: string; addHref?: string; children?: ReactNode }) {
  useTitle('Not found')
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center sm:px-6">
      <p className="font-mono text-xs text-faint">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We couldn’t find that {what}</h1>
      <p className="mt-2 text-sm text-muted">{hint ?? 'The link may be mistyped, or the content may have been moved or merged.'}</p>
      {children}
      <div className="mt-6 flex justify-center gap-2">
        <Button asChild variant="outline">
          <Link to="/">Go home</Link>
        </Button>
        {addHref ? (
          <Button asChild variant="primary">
            <Link to={addHref}>Add it</Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}
