/** Approximation of Postgres pg_trgm similarity(), used in demo mode and for client-side hints. */
function trigrams(s: string) {
  const out = new Set<string>()
  for (const word of s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const w = `  ${word} `
    for (let i = 0; i < w.length - 2; i++) out.add(w.slice(i, i + 3))
  }
  return out
}

export function trigramSimilarity(a: string, b: string) {
  const A = trigrams(a)
  const B = trigrams(b)
  if (!A.size || !B.size) return 0
  let common = 0
  for (const t of A) if (B.has(t)) common++
  return common / (A.size + B.size - common)
}

/** pg_trgm word_similarity(a, b): best match of a's trigrams against any contiguous extent of b (approximated per word window). */
export function wordSimilarity(needle: string, hay: string) {
  const words = hay.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const n = Math.max(1, needle.trim().split(/\s+/).length)
  let best = 0
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= Math.min(n + 1, words.length - i); len++) {
      best = Math.max(best, trigramSimilarity(needle, words.slice(i, i + len).join(' ')))
    }
  }
  return best
}
