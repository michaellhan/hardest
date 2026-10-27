/**
 * Problem-boundary detection for plain text, Markdown, docx text and PDF text.
 *
 * Candidate schemes ("Problem N", "Exercise N", numbered lists, Markdown headings, …) are
 * matched line by line, scored by count / sequential numbering / starting at 1, and the
 * best one wins. Subproblems are found inside each problem body afterwards.
 */
import { analyzeSequence, romanToInt } from './labels'

export interface Line {
  text: string
  /** 1-based page number for PDFs, null otherwise. */
  page: number | null
  /** Inside a code fence or display-math block: never a heading. */
  skip?: boolean
}

export type Strength = 'high' | 'medium' | 'low'

export interface Heading {
  line: number
  label: string
  title: string | null
  /** Statement text on the heading line after the heading itself. */
  rest: string
}

export interface Detection {
  scheme: string
  strength: Strength
  headings: Heading[]
}

// ---------------------------------------------------------------------------
// Keyword headings
// ---------------------------------------------------------------------------

/** Problem labels: 3, 3.2, 3a; or (after whitespace) IV (≥2 roman letters) / A (single capital). */
const NUM_LABEL_SRC = String.raw`\d{1,3}(?:\.\d{1,3})?(?:[a-z](?![A-Za-z]))?(?!\d)`
const ALPHA_LABEL_SRC = String.raw`[IVX]{2,6}(?![A-Za-z0-9])|[A-Z](?![A-Za-z0-9])`
const NO_SRC = String.raw`(?:No\.?[ \t]*|Number[ \t]+|#[ \t]*)?`
/** Digits may touch the keyword ("Q4", "Problem1"); letters need a space so "PROBLEMS" is not "PROBLEM S". */
const LABEL_AFTER_KW_SRC = `(?:[ \\t]*${NO_SRC}(${NUM_LABEL_SRC})|[ \\t]+${NO_SRC}(${ALPHA_LABEL_SRC}))`

const KW_SRC = [
  String.raw`Essay\s+Prompt`, String.raw`Essay\s+Question`, String.raw`Essay\s+Topic`, String.raw`ESSAY\s+PROMPT`,
  'Problem', 'PROBLEM', String.raw`Prob\.`, String.raw`PROB\.`, 'Exercise', 'EXERCISE', String.raw`Ex\.`, String.raw`EX\.`,
  'Question', 'QUESTION', String.raw`Ques\.`, 'Task', 'TASK', 'Milestone', 'MILESTONE', 'Essay', 'ESSAY',
  'Prompt', 'PROMPT', 'Option', 'OPTION', 'Topic', 'TOPIC', 'Part', 'PART',
].join('|')

const LEAD_SRC = String.raw`^([ \t]{0,3}(?:[-*+][ \t]+)?)(\*\*|__)?[ \t]*`
const KEYWORD_RE = new RegExp(`${LEAD_SRC}(${KW_SRC})${LABEL_AFTER_KW_SRC}`)
const Q_RE = new RegExp(`${LEAD_SRC}(Q)\\.?[ \\t]?(\\d{1,3}(?:\\.\\d{1,3})?(?:[a-z](?![A-Za-z]))?)(?!\\d)`)
const HASH_RE = new RegExp(`${LEAD_SRC}(#)(\\d{1,3})(?!\\d)`)
const MD_HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/

/** Keywords allowed to start a heading in the middle of a line (pdf.js often loses line breaks). */
const INLINE_KW_SRC = [
  'Problem', 'PROBLEM', 'Exercise', 'EXERCISE', 'Question', 'QUESTION', 'Task', 'Milestone',
  String.raw`Essay\s+Prompt`, 'Prompt', 'PROMPT', String.raw`Q(?=\d)`,
].join('|')

const INLINE_HEAD_RE = new RegExp(
  String.raw`([.?!])(["”’)\]]?)([ \t]+)(?=(?:\*\*|__)?(?:${INLINE_KW_SRC})(?:[ \t]*(?:No\.[ \t]*)?(?:${NUM_LABEL_SRC})|[ \t]+(?:${ALPHA_LABEL_SRC}))[ \t]*(?:\*\*|__)?[ \t]*[.:)(\[])`,
  'g',
)

const POINTS_RE =
  /^(?:\d+(?:\.\d+)?\s*(?:pts?\.?|points?|marks?|%)?(?:\s+(?:each|total|bonus))?|(?:pts?\.?|points?|marks?)\s*[:=]?\s*\d+(?:\.\d+)?|bonus|extra credit|optional)$/i
/** "Problem 2 (continued)" at the top of a page is a carry-over, not a new problem. */
const CONTINUED_RE = /^(?:cont(?:inued|'d|d|\.)?|continuation)$/i
const SUBPART_INNER_RE = /^(?:[a-z]|[ivx]{1,5}|[A-Z])'*$/

export interface KeywordMatch {
  scheme: string
  /** Grouping key: headings from the same family are scored together. */
  family: string
  tier: 1 | 3
  label: string
  title: string | null
  rest: string
  /** Offset in the input where `rest` starts. */
  restOffset: number
  valid: boolean
  delimited: boolean
}

function classifyKeyword(kw: string): { scheme: string; family: string; tier: 1 | 3 } {
  const k = kw.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '')
  if (k === 'problem' || k === 'prob') return { scheme: 'problem-n', family: 'problem', tier: 1 }
  if (k === 'exercise' || k === 'ex') return { scheme: 'exercise-n', family: 'exercise', tier: 1 }
  if (k === 'question' || k === 'ques' || k === 'q') return { scheme: 'question-n', family: 'question', tier: 1 }
  if (k === 'task') return { scheme: 'task-n', family: 'task', tier: 1 }
  if (k === 'milestone') return { scheme: 'milestone-n', family: 'milestone', tier: 1 }
  if (k === '#') return { scheme: 'hash-n', family: 'hash', tier: 1 }
  if (k === 'part') return { scheme: 'part-n', family: 'part', tier: 3 }
  return { scheme: 'essay-prompts', family: k, tier: 1 }
}

function findClosing(s: string, open: number): number {
  const openCh = s.charAt(open)
  const closeCh = openCh === '(' ? ')' : ']'
  let depth = 0
  for (let i = open; i < s.length; i++) {
    const c = s.charAt(i)
    if (c === openCh) depth++
    else if (c === closeCh && --depth === 0) return i
  }
  return -1
}

function cleanTitle(s: string): string | null {
  const t = s
    .replace(/^[\s.:\-–—]+/, '')
    .replace(/(\*\*|__)/g, '')
    .replace(/[\s.:]+$/, '')
    .trim()
  return t && t.length <= 120 ? t : null
}

export interface HeadingTail {
  titles: string[]
  /** Offset in the tail where the statement text begins. */
  consumed: number
  delimited: boolean
}

/**
 * Parses what follows a heading label: parenthesized titles / point values, a delimiter
 * ('.', ':', ')', dash), and the closing of a bold wrapper ("**Problem 1: Title.**").
 */
export function parseHeadingTail(tail: string, boldOpen: boolean): HeadingTail {
  let i = 0
  let boldClosed = !boldOpen
  let delimited = false
  const titles: string[] = []
  const skipWs = () => {
    while (tail.charAt(i) === ' ' || tail.charAt(i) === '\t') i++
  }
  const closeBold = () => {
    if (boldClosed) return
    const save = i
    skipWs()
    if (tail.startsWith('**', i) || tail.startsWith('__', i)) {
      i += 2
      boldClosed = true
    } else i = save
  }
  closeBold()
  for (;;) {
    const save = i
    skipWs()
    const ch = tail.charAt(i)
    if (ch !== '(' && ch !== '[') {
      i = save
      break
    }
    const close = findClosing(tail, i)
    const inner = close > 0 ? tail.slice(i + 1, close).trim() : ''
    if (close < 0 || !inner || inner.length > 100 || SUBPART_INNER_RE.test(inner)) {
      i = save
      break
    }
    if (!POINTS_RE.test(inner)) {
      // "(10 points; Sylow theorems)" → keep the non-points part.
      const parts = inner.split(/\s*[;,]\s*/).filter((p) => !POINTS_RE.test(p))
      if (parts.length) titles.push(parts.join(', '))
    }
    i = close + 1
    closeBold()
  }
  {
    const save = i
    skipWs()
    const ch = tail.charAt(i)
    if (ch === '.' || ch === ':' || ch === ')') {
      i++
      delimited = true
      closeBold()
    } else if ((ch === '-' || ch === '–' || ch === '—') && /\s/.test(tail.charAt(i + 1))) {
      i++
      delimited = true
      closeBold()
    } else i = save
  }
  if (!boldClosed) {
    // Bold continues past the label: the bold text is a title ("**Problem 1: Sylow.** …").
    const rel = tail.slice(i).search(/\*\*|__/)
    if (rel >= 0 && rel <= 120) {
      const inner = cleanTitle(tail.slice(i, i + rel))
      if (inner) titles.push(inner)
      i += rel + 2
      delimited = true
      const save = i
      skipWs()
      if (tail.charAt(i) === '.' || tail.charAt(i) === ':') i++
      else i = save
    }
  }
  return { titles, consumed: i, delimited }
}

function matchMarkdownHeading(text: string, md: RegExpExecArray): KeywordMatch | null {
  const inner = md[2] ?? ''
  const kw = KEYWORD_RE.exec(inner) ?? Q_RE.exec(inner)
  let label: string
  let titleSource: string
  let tier: 1 | 3 = 1
  if (kw) {
    label = kw[4] ?? kw[5] ?? ''
    tier = classifyKeyword(kw[3] ?? '').tier
    const tail = inner.slice(kw[0].length)
    const parsed = parseHeadingTail(tail, !!kw[2])
    const rest = cleanTitle(tail.slice(parsed.consumed))
    titleSource = [...parsed.titles, ...(rest ? [rest] : [])].join(' — ')
  } else {
    const bare = /^(\*\*|__)?(\d{1,3}(?:\.\d{1,3})?)(?:\*\*|__)?(?:[.):]|(?=\s|$))(?:\*\*|__)?\s*(.*)$/.exec(inner)
    if (!bare) return null
    label = bare[2] ?? ''
    titleSource = bare[3] ?? ''
  }
  return {
    scheme: 'markdown-headings',
    family: tier === 1 ? 'markdown' : 'markdown-part',
    tier,
    label,
    title: cleanTitle(titleSource),
    rest: '',
    restOffset: text.length,
    valid: true,
    delimited: true,
  }
}

/** Matches a problem heading at the start of `text` (a single line). */
export function matchKeywordHeading(text: string): KeywordMatch | null {
  const md = MD_HEADING_RE.exec(text)
  if (md) return matchMarkdownHeading(text, md)
  const m = KEYWORD_RE.exec(text) ?? Q_RE.exec(text) ?? HASH_RE.exec(text)
  if (!m) return null
  const { scheme, family, tier } = classifyKeyword(m[3] ?? '')
  const label = m[4] ?? m[5] ?? ''
  const tail = text.slice(m[0].length)
  const parsed = parseHeadingTail(tail, !!m[2])
  const restRaw = tail.slice(parsed.consumed)
  const rest = restRaw.trim()
  const restOffset = m[0].length + parsed.consumed + (restRaw.length - restRaw.trimStart().length)
  // Without a delimiter or title, only accept when the statement visibly starts (capital, math, …);
  // this rejects wrapped prose such as "Problem 2 is similar to …".
  const valid =
    (parsed.delimited || parsed.titles.length > 0 || rest === '' || /^[A-Z0-9$\\([“"'*_]/.test(rest)) &&
    !parsed.titles.some((t) => CONTINUED_RE.test(t))
  return {
    scheme,
    family,
    tier,
    label,
    title: parsed.titles.length ? parsed.titles.join(' — ') : null,
    rest,
    restOffset,
    valid,
    delimited: parsed.delimited,
  }
}

/** True for lines that look like problem/subproblem headings (used to protect them from header stripping). */
export function isHeadingLike(text: string): boolean {
  const m = matchKeywordHeading(text)
  return (!!m && m.valid) || lineSubpart(text) !== null
}

/**
 * Splits lines where a strong keyword heading starts mid-line after a sentence end
 * ("… holds. Problem 2. Let …"), which happens when PDF extraction joins lines.
 */
export function splitInlineHeadings(lines: Line[]): Line[] {
  const out: Line[] = []
  for (const line of lines) {
    if (line.skip) {
      out.push(line)
      continue
    }
    let last = 0
    INLINE_HEAD_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = INLINE_HEAD_RE.exec(line.text))) {
      const cut = m.index + (m[1] ?? '').length + (m[2] ?? '').length + (m[3] ?? '').length
      out.push({ ...line, text: line.text.slice(last, m.index + (m[1] ?? '').length + (m[2] ?? '').length) })
      last = cut
    }
    out.push(last === 0 ? line : { ...line, text: line.text.slice(last) })
  }
  return out
}

/** Marks lines inside ``` / ~~~ fences and $$ display blocks so they are never treated as headings. */
export function markSkippedLines(lines: Line[]): Line[] {
  let fence: string | null = null
  let inMath = false
  return lines.map((line) => {
    const t = line.text.trim()
    if (fence) {
      if (t.startsWith(fence)) fence = null
      return { ...line, skip: true }
    }
    if (inMath) {
      if (t === '$$' || t.endsWith('$$')) inMath = false
      return { ...line, skip: true }
    }
    const f = /^(`{3,}|~{3,})/.exec(t)
    if (f) {
      fence = f[1] ?? '```'
      return { ...line, skip: true }
    }
    if (t === '$$') {
      inMath = true
      return { ...line, skip: true }
    }
    return line
  })
}

/** Scheme score: count weighted by sequential numbering, with a bonus for starting at 1. */
export function scoreLabels(labels: string[]): number {
  const seq = analyzeSequence(labels)
  return labels.length * (0.5 + 0.5 * seq.sequentialFraction) + (seq.startsAtOne ? 0.5 : 0)
}

// ---------------------------------------------------------------------------
// Numbered lists
// ---------------------------------------------------------------------------

interface NumberedCandidate {
  line: number
  n: number
  indent: number
  rest: string
}

const NUM_STYLES: ReadonlyArray<{ re: RegExp; strict: boolean }> = [
  { re: /^([ \t]*)(?:\*\*|__)?(\d{1,3})\.(?:\*\*|__)?(?=[ \t]|$)[ \t]*(.*)$/, strict: false },
  { re: /^([ \t]*)(?:\*\*|__)?(\d{1,3})\)(?:\*\*|__)?(?=[ \t]|$)[ \t]*(.*)$/, strict: false },
  { re: /^([ \t]*)(?:\*\*|__)?\((\d{1,3})\)(?:\*\*|__)?(?=[ \t]|$)[ \t]*(.*)$/, strict: false },
  // "1 Prove that …" — weakest form; requires an unbroken run of ≥3.
  { re: /^([ \t]*)(\d{1,3})[ \t]+([A-Z].*)$/, strict: true },
]

/**
 * Numbered-list problems must form a sequence starting at 1 (small gaps tolerated and
 * reported later); this rejects dates, equation numbers and nested lists.
 */
function detectNumberedList(lines: Line[]): { chain: NumberedCandidate[]; gapFree: boolean } | null {
  let best: NumberedCandidate[] = []
  for (const style of NUM_STYLES) {
    const cands: NumberedCandidate[] = []
    lines.forEach((line, idx) => {
      if (line.skip || MD_HEADING_RE.test(line.text)) return
      const m = style.re.exec(line.text)
      if (m) cands.push({ line: idx, n: Number(m[2]), indent: (m[1] ?? '').replace(/\t/g, '    ').length, rest: (m[3] ?? '').trim() })
    })
    const ones = cands.filter((c) => c.n === 1)
    if (!ones.length) continue
    const baseIndent = Math.min(...ones.map((c) => c.indent))
    const pool = cands.filter((c) => c.indent <= baseIndent + 1)
    const start = pool.findIndex((c) => c.n === 1)
    const chain: NumberedCandidate[] = []
    for (let k = start; k < pool.length; k++) {
      const c = pool[k]
      if (!c) continue
      const prev = chain[chain.length - 1]
      if (!prev) chain.push(c)
      else if (style.strict ? c.n === prev.n + 1 : c.n > prev.n && c.n <= prev.n + 3) chain.push(c)
    }
    if (chain.length < (style.strict ? 3 : 2)) continue
    if (chain.length > best.length) best = chain
  }
  if (best.length < 2) return null
  const gapFree = best.every((c, k) => k === 0 || c.n === (best[k - 1]?.n ?? 0) + 1)
  return { chain: best, gapFree }
}

// ---------------------------------------------------------------------------
// Scheme selection
// ---------------------------------------------------------------------------

interface Group {
  scheme: string
  tier: 1 | 3
  order: number
  headings: Heading[]
}

const SCHEME_ORDER = [
  'markdown-headings', 'problem-n', 'exercise-n', 'question-n', 'task-n', 'hash-n', 'milestone-n', 'essay-prompts', 'part-n',
]

/** Chooses the best heading scheme for a document, or null when there is no detectable structure. */
export function detectHeadings(lines: Line[]): Detection | null {
  const groups = new Map<string, Group>()
  lines.forEach((line, idx) => {
    if (line.skip) return
    const m = matchKeywordHeading(line.text)
    if (!m || !m.valid) return
    const key = `${m.scheme}:${m.family}`
    let g = groups.get(key)
    if (!g) {
      g = { scheme: m.scheme, tier: m.tier, order: SCHEME_ORDER.indexOf(m.scheme), headings: [] }
      groups.set(key, g)
    }
    g.headings.push({ line: idx, label: m.label, title: m.title, rest: m.rest })
  })

  const pick = (tier: 1 | 3): Group | null => {
    let best: Group | null = null
    let bestScore = -1
    for (const g of groups.values()) {
      if (g.tier !== tier) continue
      const score = scoreLabels(g.headings.map((h) => h.label))
      if (score > bestScore || (score === bestScore && best && g.order < best.order)) {
        best = g
        bestScore = score
      }
    }
    return best
  }

  const tier1 = pick(1)
  const numbered = detectNumberedList(lines)
  const numberedDetection = (): Detection | null =>
    numbered
      ? {
          scheme: 'numbered-list',
          strength: numbered.gapFree && numbered.chain.length >= 3 ? 'high' : 'medium',
          headings: numbered.chain.map((c) => ({ line: c.line, label: String(c.n), title: null, rest: c.rest })),
        }
      : null

  if (tier1) {
    // Keyword headings that start inside a longer numbered list (e.g. "Option 1:" lines within
    // problem 3 of a 1..8 list) are more likely sub-structure than the problem headings.
    const first = tier1.headings[0]
    const chain = numbered?.chain
    if (
      chain &&
      first &&
      chain.length > tier1.headings.length &&
      first.line > (chain[0]?.line ?? 0) &&
      first.line < (chain[chain.length - 1]?.line ?? 0)
    ) {
      return numberedDetection()
    }
    return { scheme: tier1.scheme, strength: 'high', headings: tier1.headings }
  }
  if (numbered) return numberedDetection()
  const tier3 = pick(3)
  if (tier3) return { scheme: tier3.scheme, strength: 'medium', headings: tier3.headings }
  return null
}

// ---------------------------------------------------------------------------
// Subproblems
// ---------------------------------------------------------------------------

interface SubpartCandidate {
  start: number
  end: number
  raw: string
  paren: boolean
}

const LINE_LEAD_RE = /^[ \t]*(?:#{1,6}[ \t]+)?(?:[-*+][ \t]+)?/
const SUB_FORMS: ReadonlyArray<{ re: RegExp; paren: boolean }> = [
  { re: /^\(([A-Za-z]{1,5}'*)\)/, paren: true },
  { re: /^([A-Za-z]{1,5}'*)\)/, paren: true },
  { re: /^([a-z]|[ivx]{2,5})\.(?=\s|$)/, paren: false },
  { re: /^(?:Part|PART)[ \t]+\(?([A-Za-z]|[ivx]{2,5})\)?(?=[ \t]*[.:)]|[ \t]*$)/, paren: true },
]

/** Recognizes a subpart marker at the start of a line: "(a)", "a)", "ii.", "**(b)**", "Part (c):", "- (a)". */
function lineSubpart(line: string): { raw: string; markerEnd: number; paren: boolean } | null {
  let i = (LINE_LEAD_RE.exec(line)?.[0] ?? '').length
  const bold = line.startsWith('**', i) || line.startsWith('__', i)
  if (bold) i += 2
  for (const form of SUB_FORMS) {
    const m = form.re.exec(line.slice(i))
    if (!m) continue
    let end = i + m[0].length
    if (bold && (line.startsWith('**', end) || line.startsWith('__', end))) end += 2
    const delim = /^[ \t]*[.:]/.exec(line.slice(end))
    if (delim) end += delim[0].length
    if (end < line.length && !/\s/.test(line.charAt(end))) continue
    return { raw: m[1] ?? '', markerEnd: end, paren: form.paren }
  }
  return null
}

const INLINE_SUB_RE = /(?<=[.?!:;]["”’)]?[ \t]+)(\*\*|__)?\(([A-Za-z]{1,5}'*)\)(\*\*|__)?(?=[ \t])/g

function subpartCandidates(body: string): SubpartCandidate[] {
  const out = new Map<number, SubpartCandidate>()
  let offset = 0
  for (const line of body.split('\n')) {
    const m = lineSubpart(line)
    if (m) out.set(offset, { start: offset, end: offset + m.markerEnd, raw: m.raw, paren: m.paren })
    offset += line.length + 1
  }
  INLINE_SUB_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = INLINE_SUB_RE.exec(body))) {
    if (!out.has(m.index)) out.set(m.index, { start: m.index, end: m.index + m[0].length, raw: m[2] ?? '', paren: true })
  }
  return [...out.values()].sort((a, b) => a.start - b.start)
}

type SubStyle = 'alpha' | 'roman' | 'Alpha'

function subValue(base: string, style: SubStyle, paren: boolean): number | null {
  if (style === 'alpha') return /^[a-z]$/.test(base) ? base.charCodeAt(0) - 96 : null
  if (style === 'Alpha') return paren && /^[A-Z]$/.test(base) ? base.charCodeAt(0) - 64 : null
  return /^[ivx]+$/.test(base) ? romanToInt(base) : null
}

/** Greedy chain a, b, c… (or i, ii, iii…), allowing primed variants like (b') after (b). */
function buildChain(cands: SubpartCandidate[], style: SubStyle): SubpartCandidate[] {
  const chain: SubpartCandidate[] = []
  let expected = 1
  let lastValue = 0
  for (const c of cands) {
    const base = c.raw.replace(/'+$/, '')
    const primed = base !== c.raw
    const v = subValue(base, style, c.paren)
    if (v === null) continue
    if (!primed && v === expected) {
      chain.push(c)
      lastValue = v
      expected = v + 1
    } else if (primed && chain.length > 0 && v === lastValue) {
      chain.push(c)
    }
  }
  return chain
}

export interface SubpartSplit {
  intro: string
  parts: Array<{ label: string; start: number; end: number; text: string }>
}

/**
 * Finds ≥2 sequential subparts in a problem body. Letters vs roman numerals are decided by
 * which sequence starts first (the outer level), so "(a) … (i) (ii) … (b)" yields a, b.
 */
export function findSubparts(body: string): SubpartSplit | null {
  const cands = subpartCandidates(body)
  if (cands.length < 2) return null
  let best: SubpartCandidate[] | null = null
  for (const style of ['alpha', 'roman', 'Alpha'] as const) {
    const chain = buildChain(cands, style)
    if (chain.length < 2) continue
    const first = chain[0]
    const bestFirst = best?.[0]
    if (!best || !bestFirst || !first) best = chain
    else if (first.start < bestFirst.start || (first.start === bestFirst.start && chain.length > best.length)) best = chain
  }
  if (!best || !best[0]) return null
  const chain = best
  return {
    intro: body.slice(0, chain[0]?.start ?? 0),
    parts: chain.map((c, k) => {
      const end = chain[k + 1]?.start ?? body.length
      return { label: c.raw, start: c.start, end, text: body.slice(c.end, end) }
    }),
  }
}
