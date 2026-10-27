/** Low-level text helpers shared by the parser modules. */

const LIGATURES: Readonly<Record<string, string>> = {
  '\uFB00': 'ff',
  '\uFB01': 'fi',
  '\uFB02': 'fl',
  '\uFB03': 'ffi',
  '\uFB04': 'ffl',
}

/** Newline/space/ligature cleanup applied to extracted text before any detection. */
export function normalizeExtractedText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\f/g, '\n')
    .split('\u0000').join('')
    .replace(/[\u00A0\u2007\u202F]/g, ' ')
    .replace(/\u00AD/g, '')
    .replace(/[\uFB00-\uFB04]/g, (ch) => LIGATURES[ch] ?? ch)
}

/**
 * Characters typical of broken PDF font decoding: the replacement character, private-use
 * code points (symbol fonts without a ToUnicode map), and stray control characters.
 */
export function isSuspiciousCodePoint(cp: number): boolean {
  if (cp === 0xfffd) return true
  if (cp >= 0xe000 && cp <= 0xf8ff) return true
  if (cp >= 0xf0000) return true
  if (cp < 0x20) return cp !== 0x09 && cp !== 0x0a && cp !== 0x0d && cp !== 0x0c
  return cp >= 0x7f && cp < 0xa0
}

export function countSuspicious(s: string): number {
  let n = 0
  for (const ch of s) {
    if (isSuspiciousCodePoint(ch.codePointAt(0) ?? 0)) n++
  }
  return n
}

export function countNonWhitespace(s: string): number {
  let n = 0
  for (const ch of s) {
    if (!/\s/u.test(ch)) n++
  }
  return n
}

export function hasSuspiciousChars(s: string): boolean {
  return countSuspicious(s) > 0
}

/**
 * Whitespace normalization for statements: trailing spaces removed, runs of blank lines
 * collapsed, optional removal of leading indentation (which Markdown would treat as code).
 */
export function tidyWhitespace(s: string, stripIndent: boolean): string {
  return s
    .split('\n')
    .map((line) => (stripIndent ? line.trim() : line.replace(/[ \t]+$/, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
    .trim()
}

/** Escapes unescaped dollar signs so remark-math does not treat currency as math. */
export function escapeDollars(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    if (ch === '\\') {
      out += ch + s.charAt(i + 1)
      i++
    } else if (ch === '$') {
      out += '\\$'
    } else {
      out += ch
    }
  }
  return out
}

/** True when the text appears to use TeX-style $…$ math (a delimited span containing \cmd, ^ or _). */
export function looksLikeTexMath(s: string): boolean {
  return /\$\$[\s\S]+?\$\$/.test(s) || /\$[^$\n]*[\\^_][^$\n]*\$/.test(s) || /\\\(|\\\[/.test(s)
}

/** Converts \( … \) and \[ … \] delimiters to $ … $ and $$ … $$ (Markdown/text sources). */
export function convertMathDelimiters(s: string): string {
  return s
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body}$`)
}

/** Joins lines and records the start offset of each line in the joined string. */
export function joinWithOffsets(lines: string[]): { text: string; offsets: number[] } {
  const offsets: number[] = []
  let pos = 0
  for (const line of lines) {
    offsets.push(pos)
    pos += line.length + 1
  }
  return { text: lines.join('\n'), offsets }
}

/** Index of the line containing character offset `pos` (offsets must be ascending). */
export function lineIndexAt(offsets: number[], pos: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((offsets[mid] ?? 0) <= pos) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat
}
