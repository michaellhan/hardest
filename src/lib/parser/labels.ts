/** Label arithmetic: roman numerals, letter counters, "next label", and sequence checks. */

const ROMAN_TABLE: ReadonlyArray<readonly [number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
  [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]

const ROMAN_DIGITS: Readonly<Record<string, number>> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }

/** Lowercase roman numeral for 1..3999, '' otherwise. */
export function intToRoman(n: number): string {
  if (!Number.isInteger(n) || n <= 0 || n >= 4000) return ''
  let out = ''
  let rest = n
  for (const [value, glyph] of ROMAN_TABLE) {
    while (rest >= value) {
      out += glyph
      rest -= value
    }
  }
  return out
}

/** Value of a canonical roman numeral (either case, not mixed), or null. */
export function romanToInt(s: string): number | null {
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) return null
  const t = s.toLowerCase()
  if (!/^[mdclxvi]+$/.test(t)) return null
  let total = 0
  for (let k = 0; k < t.length; k++) {
    const v = ROMAN_DIGITS[t.charAt(k)] ?? 0
    const next = ROMAN_DIGITS[t.charAt(k + 1)] ?? 0
    total += v < next ? -v : v
  }
  return intToRoman(total) === t ? total : null
}

/** 1 → 'a', 26 → 'z', 27 → 'aa'. */
export function alphaLabel(k: number, upper = false): string {
  let n = Math.max(1, Math.floor(k))
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(97 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return upper ? out.toUpperCase() : out
}

function nextLetter(ch: string): string {
  return String.fromCharCode(ch.charCodeAt(0) + 1)
}

/**
 * Successor of a label: '3'→'4', 'a'→'b', 'iv'→'v', 'A'→'B', 'Q3'→'Q4', '1.2'→'1.3'.
 * Single 'i', 'v', 'x' are read as roman numerals (subpart lists reach them far more often as numerals).
 * Anything else gets a prime appended.
 */
export function nextLabel(label: string): string {
  const t = label.trim()
  if (t === '') return '1'
  if (/^\d+$/.test(t)) return String(Number(t) + 1)
  if (/^[ivx]+$/.test(t) || /^[IVX]+$/.test(t)) {
    const r = romanToInt(t)
    if (r !== null) {
      const next = intToRoman(r + 1)
      return t === t.toUpperCase() ? next.toUpperCase() : next
    }
  }
  if (/^[a-yA-Y]$/.test(t)) return nextLetter(t)
  const numeric = /^(.*?)(\d+)$/.exec(t)
  if (numeric) return `${numeric[1] ?? ''}${Number(numeric[2]) + 1}`
  const lettered = /^(.*\d)([a-yA-Y])$/.exec(t)
  if (lettered) return `${lettered[1] ?? ''}${nextLetter(lettered[2] ?? 'a')}`
  return `${t}'`
}

interface LabelKey {
  group: string
  n: number
}

function labelKey(label: string, preferRoman: boolean): LabelKey | null {
  const t = label.trim()
  let m: RegExpExecArray | null
  if ((m = /^(\d+)$/.exec(t))) return { group: '#', n: Number(m[1]) }
  if ((m = /^(\d+(?:\.\d+)*)\.(\d+)$/.exec(t))) return { group: `${m[1]}.`, n: Number(m[2]) }
  if ((m = /^(\d+)([a-z])$/.exec(t))) return { group: `${m[1]}#`, n: (m[2] ?? 'a').charCodeAt(0) - 96 }
  if (preferRoman && /^[ivx]+$/i.test(t)) {
    const r = romanToInt(t)
    if (r !== null) return { group: t === t.toLowerCase() ? 'i' : 'I', n: r }
  }
  if (/^[a-z]$/.test(t)) return { group: 'a', n: t.charCodeAt(0) - 96 }
  if (/^[A-Z]$/.test(t)) return { group: 'A', n: t.charCodeAt(0) - 64 }
  return null
}

export interface SequenceAnalysis {
  /** Fraction of adjacent pairs that increase by exactly one (1 when there are fewer than two labels). */
  sequentialFraction: number
  startsAtOne: boolean
  /** Per-label issue message, or null. */
  issues: Array<string | null>
}

/**
 * Checks a label sequence for gaps, duplicates and reorderings. Labels are interpreted
 * either plainly (numbers/letters) or as roman numerals, whichever reads more sequentially.
 */
export function analyzeSequence(labels: string[]): SequenceAnalysis {
  const interpret = (roman: boolean) => labels.map((l) => labelKey(l, roman))
  const countIncrements = (keys: Array<LabelKey | null>) => {
    let inc = 0
    for (let k = 1; k < keys.length; k++) {
      const a = keys[k - 1]
      const b = keys[k]
      if (a && b && a.group === b.group && b.n === a.n + 1) inc++
    }
    return inc
  }
  const plain = interpret(false)
  const roman = interpret(true)
  const keys = countIncrements(roman) > countIncrements(plain) ? roman : plain
  const increments = countIncrements(keys)

  const issues: Array<string | null> = labels.map(() => null)
  const seen = new Set<string>()
  for (let k = 0; k < labels.length; k++) {
    const label = (labels[k] ?? '').trim()
    if (seen.has(label)) {
      issues[k] = `Duplicate label ${label}`
      continue
    }
    seen.add(label)
    if (k === 0) continue
    const prev = keys[k - 1]
    const cur = keys[k]
    const prevLabel = (labels[k - 1] ?? '').trim()
    if (!prev || !cur || prev.group !== cur.group) continue
    if (cur.n > prev.n + 1) issues[k] = `Label sequence jumps from ${prevLabel} to ${label}`
    else if (cur.n <= prev.n) issues[k] = `Label ${label} is out of order (follows ${prevLabel})`
  }
  const first = keys[0]
  return {
    sequentialFraction: labels.length < 2 ? 1 : increments / (labels.length - 1),
    startsAtOne: !!first && first.n === 1,
    issues,
  }
}
