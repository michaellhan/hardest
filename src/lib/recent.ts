/** Recently viewed course offerings, kept in localStorage purely as a convenience. */
export interface RecentEntry {
  path: string
  code: string
  name: string
  term: string
  university: string
  at: number
}

const KEY = 'hardest:recent'

export function getRecent(): RecentEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as RecentEntry[]
  } catch {
    return []
  }
}

export function pushRecent(entry: Omit<RecentEntry, 'at'>) {
  try {
    const list = getRecent().filter((e) => e.path !== entry.path)
    list.unshift({ ...entry, at: Date.now() })
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 8)))
  } catch {
    /* storage unavailable */
  }
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
