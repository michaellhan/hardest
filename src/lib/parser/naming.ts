/** Automatic short names for problems whose source gives no title, derived from the statement text. */
import type { DraftProblem } from './types'

const MAX_WORDS = 8
const MAX_CHARS = 70
/** Inline math longer than this is not worth keeping in a name. */
const MAX_MATH_CHARS = 40

const ACTION_VERBS = [
  'prove', 'show', 'compute', 'find', 'determine', 'evaluate', 'calculate', 'solve', 'derive', 'give', 'describe',
  'explain', 'classify', 'construct', 'verify', 'sketch', 'implement', 'write', 'design', 'estimate', 'simplify',
  'state', 'decide', 'disprove', 'deduce', 'conclude', 'characterize', 'identify', 'compare', 'analyze', 'graph',
  'plot', 'draw', 'list', 'express', 'factor', 'expand', 'differentiate', 'integrate', 'diagonalize', 'minimize',
  'maximize', 'approximate', 'argue', 'establish', 'check', 'demonstrate', 'justify',
]
const ACTION_RE = new RegExp(String.raw`^(?:${ACTION_VERBS.join('|')})\b`, 'i')
const SETUP_RE = /^(?:let|suppose|assume|consider|recall|given|throughout|in this (?:problem|exercise|question)|for this|here|define|we say|denote|note)\b/i
/** "Prove that X" → "X". */
const CLAIM_RE = /^(?:prove|show|verify|demonstrate|establish|argue|check|deduce|conclude|explain why|justify)\s+(?:rigorously\s+)?that\s+/i
const CUT_RE = /(?:,|;|:|\s(?:such that|where|whenever|so that|using|via|by using|given that|assuming|provided)\s)/i
/** "the Cauchy–Schwarz inequality", "Dijkstra's algorithm", "Bayes' rule". */
const NAMED_RESULT_RE =
  /((?:[A-Z][\w'’]*(?:[-–][A-Z][\w'’]*)*\s+){1,4})(theorem|lemma|inequality|formula|identity|criterion|test|algorithm|method|equation|rule|transform|principle|conjecture|paradox|problem|distribution|process)\b/
const TRAILING_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'for', 'with', 'is', 'are', 'that', 'on', 'by', 'at', 'as', 'be', 'if', 'then', 'from', 'its',
])

/** Removes display math, Markdown markup and list/quote prefixes; keeps inline $…$. */
function plainText(markdown: string): string {
  return markdown
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/`{3}[\s\S]*?`{3}/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)]|\(?(?:[a-h]|[ivx]{1,4})\))\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)(?=\S)([^$]*?\S)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits on sentence ends outside inline math; "e.g." / "i.e." do not end a sentence. */
function sentences(text: string): string[] {
  const out: string[] = []
  let start = 0
  let inMath = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '$') inMath = !inMath
    if (inMath || !/[.?!]/.test(ch ?? '')) continue
    const next = text[i + 1]
    if (next !== undefined && next !== ' ') continue
    if (/\b(?:e\.g|i\.e|etc|cf|vs|resp|Thm|Prop|Lem|Fig|Eq|Sec|Ex)\.$/i.test(text.slice(Math.max(0, i - 5), i + 1))) continue
    out.push(text.slice(start, i + 1).trim())
    start = i + 1
  }
  const rest = text.slice(start).trim()
  if (rest) out.push(rest)
  return out.filter((s) => /[A-Za-z]/.test(s))
}

/** Words with each inline $…$ span kept whole. */
function tokens(s: string): string[] {
  return s.match(/\$[^$]*\$|[^\s$]+/g) ?? []
}

/**
 * Shortens a phrase to a name: clause cut, word cap, no dangling stopwords, no long math.
 * Null when fewer than `minWords` survive (a lone "Show" or "Linear" is not a name).
 */
function compress(phrase: string, minWords = 2): string | null {
  let s = phrase.replace(/[\s.?!:;,]+$/, '').trim()
  const ifThen = /^(?:if|when)\s+.+?,?\s+then\s+(.+)$/i.exec(s)
  if (ifThen?.[1]) s = ifThen[1]
  const cut = CUT_RE.exec(s)
  if (cut && tokens(s.slice(0, cut.index)).length >= 2) s = s.slice(0, cut.index)
  let words: string[] = []
  for (const w of tokens(s)) {
    if (w.startsWith('$') && w.length > MAX_MATH_CHARS) break
    if (words.length >= MAX_WORDS || [...words, w].join(' ').length > MAX_CHARS) break
    words.push(w)
  }
  while (words.length && TRAILING_STOPWORDS.has((words.at(-1) ?? '').toLowerCase())) words = words.slice(0, -1)
  const name = words.join(' ').replace(/[\s,;:(]+$/, '')
  if (words.length < minWords || !/[A-Za-z]{2}/.test(name.replace(/\$[^$]*\$/g, ''))) return null
  // Capitalize words, not variables: "every group …" → "Every group …", but "n^2 is odd" stays.
  return /^(?:[a-z]{2,}\b|a\s)/.test(name) ? name.charAt(0).toUpperCase() + name.slice(1) : name
}

/** A short lead-in like "**Sylow.**" or "Cauchy–Schwarz." that labels the problem. */
function leadIn(markdown: string, first: string | undefined, rest: number): string | null {
  const bold = /^\s*(?:\*\*|__)([^*_\n]{2,60}?)[.:]?(?:\*\*|__)/.exec(markdown)
  if (bold?.[1] && tokens(bold[1]).length <= 6) return bold[1].replace(/[.:\s]+$/, '').trim()
  if (!first || rest === 0) return null
  const s = first.replace(/[.:]$/, '').trim()
  if (tokens(s).length > 4 || s.includes('$') || ACTION_RE.test(s) || SETUP_RE.test(s) || !/^[A-Z]/.test(s)) return null
  return s
}

/** The first named theorem, inequality, algorithm … mentioned, without a leading verb. */
function namedResult(s: string): string | null {
  const m = NAMED_RESULT_RE.exec(s)
  if (!m?.[1] || !m[2]) return null
  const words = m[1].trim().split(/\s+/)
  while (words.length && (ACTION_RE.test(words[0] ?? '') || /^(?:use|apply|recall|the|a|an|by|using)$/i.test(words[0] ?? ''))) words.shift()
  return words.length ? `${words.join(' ')} ${m[2]}` : null
}

/** "Let G be a group of order 12" → "Group of order 12"; "Consider the matrix A" → "Matrix A". */
function setupObject(s: string): string | null {
  const m = /^let\s+.+?\s+(?:be|denote)\s+(.+)$/i.exec(s) ?? /^consider\s+(.+)$/i.exec(s)
  return m?.[1] ? m[1].replace(/^(?:a|an|the)\s+/i, '') : null
}

/**
 * A short name for one statement, or null when nothing sensible can be derived. With `loose`,
 * falls back to the first sentence even when it is only setup ("Suppose n is odd").
 */
export function suggestTitle(markdown: string, loose = true): string | null {
  const text = plainText(markdown)
  if (!text) return null
  const parts = sentences(text)
  const lead = leadIn(markdown, parts[0], parts.length - 1)
  if (lead) return compress(lead, 1)
  const action = parts.find((s) => ACTION_RE.test(s))
  const named = namedResult(action ?? parts[0] ?? '')
  if (named) return named
  if (action) {
    // A claim that is all math ("Show that $8 \mid n^2-1$") keeps its verb.
    const name = compress(action.replace(CLAIM_RE, '')) ?? compress(action)
    if (name) return name
  }
  const claim = parts.find((s) => !SETUP_RE.test(s))
  const claimName = claim ? compress(claim) : null
  if (claimName) return claimName
  for (const s of parts) {
    const object = setupObject(s.replace(/[.?!]$/, ''))
    const name = object ? compress(object) : null
    if (name) return name
  }
  return loose && parts[0] ? compress(parts[0]) : null
}

/**
 * Fills in a title for each top-level problem that has none, from its statement or,
 * when that is empty or only vague setup, from its first part.
 */
export function nameProblems(problems: DraftProblem[]): DraftProblem[] {
  return problems.map((p) => {
    if (p.title?.trim()) return p
    const firstPart = p.children[0]?.statementMarkdown ?? ''
    const title = suggestTitle(p.statementMarkdown, false) ?? suggestTitle(firstPart) ?? suggestTitle(p.statementMarkdown)
    return title ? { ...p, title } : p
  })
}
