/** Text normalization, similarity and hashing for client-side duplicate detection. */

/** Lowercases and strips LaTeX commands, math delimiters, punctuation and whitespace runs. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\\(?:begin|end)\s*\{[^}]*\}/g, ' ')
    .replace(/\\[a-z@]+\*?/g, ' ')
    .replace(/\\./g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function words(text: string): string[] {
  const norm = normalizeForCompare(text)
  return norm ? norm.split(' ') : []
}

function shingles(ws: string[], k: number): Set<string> {
  const out = new Set<string>()
  for (let i = 0; i + k <= ws.length; i++) out.add(ws.slice(i, i + k).join(' '))
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Below this many words, 3-shingles are too sparse to be meaningful; compare word sets instead. */
const SHINGLE_MIN_WORDS = 6

/** Similarity in [0, 1]: Jaccard over word 3-shingles, falling back to word sets for short texts. */
export function textSimilarity(a: string, b: string): number {
  const wa = words(a)
  const wb = words(b)
  if (wa.length === 0 && wb.length === 0) return 1
  if (wa.length === 0 || wb.length === 0) return 0
  if (wa.join(' ') === wb.join(' ')) return 1
  if (Math.min(wa.length, wb.length) < SHINGLE_MIN_WORDS) return jaccard(new Set(wa), new Set(wb))
  return jaccard(shingles(wa, 3), shingles(wb, 3))
}

/** Hex SHA-256 of a string (UTF-8) or binary buffer, via Web Crypto. */
export async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
