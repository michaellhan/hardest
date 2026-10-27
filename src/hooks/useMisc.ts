import { useEffect, useSyncExternalStore } from 'react'

export function useTitle(title: string | null | undefined) {
  useEffect(() => {
    document.title = title ? `${title} · hardest` : 'hardest — how hard was that problem?'
  }, [title])
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** True when a modal (Radix dialog) is open, so page-level shortcuts should stand down. */
export function modalOpen() {
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'))
}

export function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)))
}
