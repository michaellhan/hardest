/**
 * Low-level LaTeX source scanning shared by the converter and the structure detector:
 * balanced arguments, environment ends, list items, enumerate label styles, comments.
 * Everything here is tolerant of malformed input (unbalanced delimiters return -1 / null).
 */
import { alphaLabel, intToRoman } from './labels'

// ---------------------------------------------------------------------------
// Argument / environment scanning
// ---------------------------------------------------------------------------

export interface Span {
  content: string
  /** Index just past the closing delimiter. */
  end: number
  unbalanced?: boolean
}

/** Index of the delimiter closing the one at `open` (backslash escapes honored), or -1. */
export function matchBrace(s: string, open: number, openCh = '{', closeCh = '}'): number {
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === '\\') {
      i++
      continue
    }
    if (c === openCh) depth++
    else if (c === closeCh) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Like matchBrace for `[ … ]`, ignoring brackets nested inside braces. */
export function matchBracket(s: string, open: number): number {
  let brace = 0
  let bracket = 0
  for (let i = open; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === '\\') {
      i++
      continue
    }
    if (c === '{') brace++
    else if (c === '}') brace--
    else if (brace <= 0 && c === '[') bracket++
    else if (brace <= 0 && c === ']') {
      bracket--
      if (bracket === 0) return i
    }
  }
  return -1
}

/** Skips spaces/tabs and at most one newline (LaTeX argument whitespace rules, approximately). */
function skipArgSpace(s: string, i: number): number {
  let j = i
  let newlines = 0
  while (j < s.length) {
    const c = s.charAt(j)
    if (c === ' ' || c === '\t') j++
    else if (c === '\n' && newlines === 0) {
      newlines++
      j++
    } else break
  }
  return j
}

/** Reads a `{…}` argument starting at (or after whitespace from) `i`. */
export function readArg(s: string, i: number): Span | null {
  const j = skipArgSpace(s, i)
  if (s.charAt(j) !== '{') return null
  const close = matchBrace(s, j)
  if (close < 0) return { content: s.slice(j + 1), end: s.length, unbalanced: true }
  return { content: s.slice(j + 1, close), end: close + 1 }
}

/** Reads a `{…}` argument, or a single token (`\cmd` or one character) as TeX would. */
export function readArgOrToken(s: string, i: number): Span | null {
  const group = readArg(s, i)
  if (group) return group
  const j = skipArgSpace(s, i)
  if (j >= s.length) return null
  if (s.charAt(j) === '\\') {
    const m = /^\\(?:[a-zA-Z@]+|.)/.exec(s.slice(j, j + 40))
    const tok = m ? m[0] : '\\'
    return { content: tok, end: j + tok.length }
  }
  if (s.charAt(j) === '}' || s.charAt(j) === '\n') return null
  return { content: s.charAt(j), end: j + 1 }
}

/** Reads an optional `[…]` argument. */
export function readOptional(s: string, i: number): Span | null {
  const j = skipArgSpace(s, i)
  if (s.charAt(j) !== '[') return null
  const close = matchBracket(s, j)
  if (close < 0) return null
  return { content: s.slice(j + 1, close), end: close + 1 }
}

/** Reads a control sequence name (`\foo`) or a group, as used by \newcommand / \setlength. */
export function readCsOrArg(s: string, i: number): Span | null {
  const j = skipArgSpace(s, i)
  if (s.charAt(j) === '\\') {
    const m = /^\\(?:[a-zA-Z@]+|.)/.exec(s.slice(j, j + 60))
    if (m) return { content: m[0], end: j + m[0].length }
  }
  return readArg(s, j)
}

/**
 * Skips arguments according to a spec string: 'o' optional, 'm' mandatory (group or token),
 * 'c' control-sequence-or-group. Returns the index after the last argument consumed.
 */
export function skipArgs(s: string, i: number, spec: string): number {
  let j = i
  for (const kind of spec) {
    const span = kind === 'o' ? readOptional(s, j) : kind === 'c' ? readCsOrArg(s, j) : readArgOrToken(s, j)
    if (span) j = span.end
    else if (kind !== 'o') break
  }
  return j
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Finds the `\end{name}` matching an environment whose body starts at `from`. */
export function findEnvEnd(s: string, name: string, from: number): { start: number; end: number } | null {
  const re = new RegExp(String.raw`\\(begin|end)\s*\{` + escapeRegExp(name) + String.raw`\}`, 'g')
  re.lastIndex = from
  let depth = 1
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m[1] === 'begin') depth++
    else if (--depth === 0) return { start: m.index, end: m.index + m[0].length }
  }
  return null
}

export interface ItemSplit {
  before: string
  items: Array<{ label: string | null; body: string }>
}

/** Splits list content at top-level item commands (`\item`, `\part`, …), honoring nested envs and braces. */
export function splitItems(content: string, commands: string[]): ItemSplit {
  const cmdRe = new RegExp(String.raw`^\\(?:` + commands.map(escapeRegExp).join('|') + String.raw`)(?![a-zA-Z@])`)
  const starts: Array<{ at: number; bodyStart: number; label: string | null }> = []
  let envDepth = 0
  let brace = 0
  for (let i = 0; i < content.length; i++) {
    const c = content.charAt(i)
    if (c === '\\') {
      const ahead = content.slice(i, i + 40)
      if (/^\\begin(?![a-zA-Z])/.test(ahead)) {
        envDepth++
        i += 5
        continue
      }
      if (/^\\end(?![a-zA-Z])/.test(ahead)) {
        envDepth--
        i += 3
        continue
      }
      if (envDepth <= 0 && brace <= 0) {
        const m = cmdRe.exec(ahead)
        if (m) {
          let j = i + m[0].length
          let label: string | null = null
          if (content.charAt(j) === '*') j++
          const opt = readOptional(content, j)
          if (opt) {
            label = opt.content
            j = opt.end
          }
          starts.push({ at: i, bodyStart: j, label })
          i = j - 1
          continue
        }
      }
      i++
      continue
    }
    if (c === '{') brace++
    else if (c === '}') brace--
  }
  const first = starts[0]
  return {
    before: first ? content.slice(0, first.at) : content,
    items: starts.map((st, k) => ({
      label: st.label,
      body: content.slice(st.bodyStart, starts[k + 1]?.at ?? content.length),
    })),
  }
}

// ---------------------------------------------------------------------------
// Enumerate label styles
// ---------------------------------------------------------------------------

export type CounterKind = 'arabic' | 'alph' | 'Alph' | 'roman' | 'Roman'

export interface EnumStyle {
  counter: CounterKind
  prefix: string
  suffix: string
}

/** LaTeX defaults for enumerate depths 1–4: 1.  (a)  i.  A. */
const DEFAULT_ENUM: readonly EnumStyle[] = [
  { counter: 'arabic', prefix: '', suffix: '.' },
  { counter: 'alph', prefix: '(', suffix: ')' },
  { counter: 'roman', prefix: '', suffix: '.' },
  { counter: 'Alph', prefix: '', suffix: '.' },
]

export function counterLabel(counter: CounterKind, k: number): string {
  switch (counter) {
    case 'arabic':
      return String(k)
    case 'alph':
      return alphaLabel(k)
    case 'Alph':
      return alphaLabel(k, true)
    case 'roman':
      return intToRoman(k)
    case 'Roman':
      return intToRoman(k).toUpperCase()
  }
}

function cleanAffix(s: string): string {
  return s.replace(/\\[a-zA-Z@]+\*?/g, '').replace(/[{}\s]/g, '')
}

/** Parses an enumerate option (`[(a)]`, `[label=(\roman*)]`, …) into a label style. */
function parseEnumOption(opt: string): EnumStyle | null {
  let tpl = opt
  const lm = /label\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|[^,]+)/.exec(opt)
  if (lm) {
    tpl = (lm[1] ?? '').trim()
    if (tpl.startsWith('{') && tpl.endsWith('}')) tpl = tpl.slice(1, -1)
  } else if (opt.includes('=')) {
    return null
  }
  const cm = /\\(alph|Alph|roman|Roman|arabic)\*?/.exec(tpl)
  if (cm) {
    return {
      counter: cm[1] as CounterKind,
      prefix: cleanAffix(tpl.slice(0, cm.index)),
      suffix: cleanAffix(tpl.slice(cm.index + cm[0].length)),
    }
  }
  // enumerate-package short form: the first of a A i I 1 is the counter, the rest is literal.
  const plain = tpl.replace(/\\[a-zA-Z@]+\*?/g, '').replace(/[{}]/g, '')
  const sm = /[aAiI1]/.exec(plain)
  if (!sm) return null
  const map: Record<string, CounterKind> = { a: 'alph', A: 'Alph', i: 'roman', I: 'Roman', '1': 'arabic' }
  return {
    counter: map[sm[0]] ?? 'arabic',
    prefix: plain.slice(0, sm.index).trim(),
    suffix: plain.slice(sm.index + 1).trim(),
  }
}

export function enumStyle(opt: string | null, depth: number): EnumStyle {
  const parsed = opt ? parseEnumOption(opt) : null
  return parsed ?? DEFAULT_ENUM[Math.min(Math.max(depth, 0), 3)] ?? DEFAULT_ENUM[0]!
}

// ---------------------------------------------------------------------------
// Comment stripping
// ---------------------------------------------------------------------------

export const VERBATIM_ENVS = new Set(['verbatim', 'verbatim*', 'Verbatim', 'BVerbatim', 'lstlisting', 'minted'])

/** Index of the first unescaped `%` in a line, or -1. */
function commentIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i)
    if (c === '\\') i++
    else if (c === '%') return i
  }
  return -1
}

/**
 * Removes `%` comments (not `\%`) and `comment` environments, leaving verbatim-like
 * environments untouched. Like TeX, a trailing comment also swallows the line break.
 */
export function stripLatexComments(src: string): string {
  const lines = src.split('\n')
  const out: string[] = []
  let verbatimEnd: string | null = null
  let inCommentEnv = false
  let joinNext = false
  const push = (text: string) => {
    if (joinNext && out.length > 0) out[out.length - 1] += text.replace(/^[ \t]+/, '')
    else out.push(text)
  }
  for (const line of lines) {
    if (verbatimEnd) {
      out.push(line)
      if (line.includes(verbatimEnd)) verbatimEnd = null
      continue
    }
    if (inCommentEnv) {
      if (/\\end\s*\{comment\}/.test(line)) inCommentEnv = false
      continue
    }
    if (/^\s*\\begin\s*\{comment\}/.test(line)) {
      inCommentEnv = !/\\end\s*\{comment\}/.test(line)
      continue
    }
    const vm = /\\begin\s*\{(verbatim\*?|Verbatim|BVerbatim|lstlisting|minted)\}/.exec(line)
    const idx = commentIndex(line)
    if (vm && (idx < 0 || vm.index < idx)) {
      push(line)
      joinNext = false
      const endTag = `\\end{${vm[1] ?? ''}}`
      if (!line.slice(vm.index).includes(endTag)) verbatimEnd = endTag
      continue
    }
    if (idx < 0) {
      push(line)
      joinNext = false
      continue
    }
    const kept = line.slice(0, idx)
    if (kept.trim() === '') {
      // Whole-line comment: drop the line entirely (TeX sees nothing here).
      continue
    }
    push(kept)
    joinNext = true
  }
  return out.join('\n')
}
