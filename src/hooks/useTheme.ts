import { useCallback, useSyncExternalStore } from 'react'
import type { Theme } from '@/lib/scale'

type Pref = 'light' | 'dark' | 'system'
const KEY = 'hardest:theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readPref(): Pref {
  try {
    return (localStorage.getItem(KEY) as Pref) || 'system'
  } catch {
    return 'system'
  }
}

export function resolvedTheme(): Theme {
  const p = readPref()
  return p === 'system' ? (media().matches ? 'dark' : 'light') : p
}

export function applyTheme() {
  document.documentElement.classList.toggle('dark', resolvedTheme() === 'dark')
}

const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  const m = media()
  const onChange = () => {
    applyTheme()
    cb()
  }
  m.addEventListener('change', onChange)
  return () => {
    listeners.delete(cb)
    m.removeEventListener('change', onChange)
  }
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, resolvedTheme, () => 'light' as Theme)
  const pref = useSyncExternalStore(subscribe, readPref, () => 'system' as Pref)
  const setPref = useCallback((p: Pref) => {
    try {
      if (p === 'system') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, p)
    } catch {
      /* ignore */
    }
    applyTheme()
    listeners.forEach((l) => l())
  }, [])
  return { theme, pref, setPref }
}
