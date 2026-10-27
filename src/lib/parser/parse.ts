/** parseDocument: turns extracted text (PDF pages, LaTeX, Markdown, text, docx) into draft problems. */
import {
  detectHeadings,
  findSubparts,
  markSkippedLines,
  splitInlineHeadings,
  type Line,
  type Strength,
} from './detect'
import { createIdGenerator } from './ids'
import { analyzeSequence } from './labels'
import { convertLatex } from './latex'
import { detectLatexStructure, extractLatexChildren, prepareLatex, type LatexSegment } from './latexStructure'
import { guessDueDate, guessTitle } from './metadata'
import { buildPdfLines, looksLikeGarbledMath } from './pdfQuality'
import {
  convertMathDelimiters,
  countNonWhitespace,
  countSuspicious,
  escapeDollars,
  hasSuspiciousChars,
  joinWithOffsets,
  lineIndexAt,
  looksLikeTexMath,
  normalizeExtractedText,
  tidyWhitespace,
  truncate,
} from './text'
import type { Confidence, DraftProblem, ParseInput, ParseResult, QualityStatus, SourceKind } from './types'

/** Below this many characters per page a PDF is treated as scanned / image-only. */
const SCANNED_CHARS_PER_PAGE = 40
const SUSPICIOUS_RATIO_LIMIT = 0.02
const LONG_STATEMENT_CHARS = 4000
const MAX_PROBLEMS = 300

export const WARNINGS = {
  scanned:
    'This PDF appears to be scanned or image-based; little text could be extracted. Please transcribe the problems manually or upload LaTeX source.',
  undecodable:
    'Some characters could not be decoded (common with math fonts). Compare each statement against the original PDF.',
  pdfGeneral:
    'Text extracted from PDFs often loses formatting, especially mathematical notation. Review each statement against the original.',
  noStructure:
    'No problem headings were detected, so the whole document was imported as a single problem. Please split it into problems manually.',
  numbering: 'Problem numbering has gaps, duplicates or reorderings; check that no problems were missed or merged.',
  malformedLatex:
    'The LaTeX source appears to be malformed (unbalanced braces, unclosed environments or math); some content may be misplaced.',
  unresolvedInput: 'The LaTeX source uses \\input/\\include; those files were not available. Upload a single self-contained .tex file.',
  replacementChars: 'Statement contains replacement characters (possible garbled math)',
  garbledMath: 'Mathematical notation may not have extracted correctly; check against the PDF.',
  emptyStatement: 'Statement is empty',
  longStatement: 'Statement is unusually long; it may contain more than one problem.',
} as const

interface Node {
  label: string
  title: string | null
  statement: string
  children: Node[]
  pageStart: number | null
  pageEnd: number | null
  warnings: string[]
  strength: Strength
}

interface Internal {
  nodes: Node[]
  preamble: string
  scheme: string | null
  warnings: string[]
  /** Header lines for metadata guessing. */
  metaLines: string[]
}

interface FormatOpts {
  kind: SourceKind
  /** Escape `$` (currency) so it is not rendered as math. */
  escapeDollars: boolean
}

function formatStatement(raw: string, f: FormatOpts): string {
  const stripIndent = f.kind === 'pdf' || f.kind === 'docx' || f.kind === 'text'
  let s = tidyWhitespace(raw, stripIndent)
  if (f.escapeDollars) s = escapeDollars(s)
  else if (f.kind === 'markdown' || f.kind === 'text' || f.kind === 'docx') s = tidyWhitespace(convertMathDelimiters(s), stripIndent)
  return s
}

// ---------------------------------------------------------------------------
// Plain text / Markdown / PDF
// ---------------------------------------------------------------------------

/** First and last page among non-blank lines in [from, to]; falls back to `fallback`. */
function pageRange(lines: Line[], from: number, to: number, fallback: number | null): [number | null, number | null] {
  let first: number | null = null
  let last: number | null = null
  for (let i = Math.max(0, from); i <= Math.min(to, lines.length - 1); i++) {
    const l = lines[i]
    if (!l || !l.text.trim() || l.page === null) continue
    first ??= l.page
    last = l.page
  }
  return [first ?? fallback, last ?? first ?? fallback]
}

function textNode(
  label: string,
  title: string | null,
  body: Line[],
  headingPage: number | null,
  f: FormatOpts,
  strength: Strength,
): Node {
  const { text, offsets } = joinWithOffsets(body.map((l) => l.text))
  const [, pageEnd] = pageRange(body, 0, body.length - 1, headingPage)
  const node: Node = {
    label,
    title,
    statement: '',
    children: [],
    pageStart: headingPage,
    pageEnd,
    warnings: [],
    strength,
  }
  const split = findSubparts(text)
  if (!split) {
    node.statement = formatStatement(text, f)
    return node
  }
  node.statement = formatStatement(split.intro, f)
  node.children = split.parts.map((part) => {
    const firstLine = lineIndexAt(offsets, part.start)
    const lastLine = lineIndexAt(offsets, Math.max(part.start, part.end - 1))
    const [ps, pe] = pageRange(body, firstLine, lastLine, headingPage)
    return {
      label: part.label,
      title: null,
      statement: formatStatement(part.text, f),
      children: [],
      pageStart: ps,
      pageEnd: pe,
      warnings: [],
      strength,
    }
  })
  return node
}

function applySequenceWarnings(nodes: Node[]): boolean {
  const { issues } = analyzeSequence(nodes.map((n) => n.label))
  let any = false
  issues.forEach((issue, k) => {
    const node = nodes[k]
    if (issue && node) {
      node.warnings.push(issue)
      any = true
    }
  })
  return any
}

function parseTextual(inputLines: Line[], f: FormatOpts): Internal {
  const lines = markSkippedLines(splitInlineHeadings(inputLines))
  const detection = detectHeadings(lines)
  const firstHeading = detection?.headings[0]
  if (!detection || !firstHeading) {
    const node = textNode('1', null, lines, lines.find((l) => l.text.trim())?.page ?? null, f, 'low')
    return {
      nodes: [node],
      preamble: '',
      scheme: null,
      warnings: [WARNINGS.noStructure],
      metaLines: lines.filter((l) => l.text.trim()).slice(0, 10).map((l) => l.text),
    }
  }
  const headings = detection.headings
  const nodes = headings.map((h, k) => {
    const end = headings[k + 1]?.line ?? lines.length
    const page = lines[h.line]?.page ?? null
    const body: Line[] = [{ text: h.rest, page }, ...lines.slice(h.line + 1, end)]
    return textNode(h.label, h.title, body, page, f, detection.strength)
  })
  const warnings: string[] = applySequenceWarnings(nodes) ? [WARNINGS.numbering] : []
  const preambleLines = lines.slice(0, firstHeading.line).map((l) => l.text)
  return {
    nodes,
    preamble: formatStatement(preambleLines.join('\n'), f),
    scheme: detection.scheme,
    warnings,
    metaLines: preambleLines.filter((l) => l.trim()).slice(0, 15),
  }
}

// ---------------------------------------------------------------------------
// LaTeX
// ---------------------------------------------------------------------------

function parseLatexSource(raw: string): Internal {
  const prepared = prepareLatex(raw)
  const issues = new Set<string>()
  const convert = (src: string, enumDepth: number): string => {
    const result = convertLatex(src, { enumDepth })
    result.issues.forEach((i) => issues.add(i))
    return result.markdown
  }
  const structure = detectLatexStructure(prepared.body)
  let internal: Internal
  if (structure) {
    const nodes = structure.segments.map((seg) => latexNode(seg, structure.strength, convert))
    const warnings: string[] = applySequenceWarnings(nodes) ? [WARNINGS.numbering] : []
    const leftovers = structure.leftovers.map((s) => convert(s, 0)).filter((s) => s.trim())
    if (leftovers.length) {
      warnings.push(
        `Some text outside the detected problems was not assigned to any problem: “${truncate(leftovers.join(' '), 120)}”`,
      )
    }
    const preamble = convert(structure.preamble, 0)
    internal = {
      nodes,
      preamble,
      scheme: structure.scheme,
      warnings,
      metaLines: preamble.split('\n').filter((l) => l.trim()).slice(0, 15),
    }
  } else {
    const markdown = convert(prepared.body, 0)
    internal = parseTextual(
      markdown.split('\n').map((text) => ({ text, page: null })),
      { kind: 'tex', escapeDollars: false },
    )
  }
  internal.metaLines = [...prepared.metaLines, ...internal.metaLines]
  if ([...issues].some((i) => /^(unbalanced|unclosed|malformed|stray|too-deeply|internal)/.test(i))) {
    internal.warnings.push(WARNINGS.malformedLatex)
  }
  if (issues.has('unresolved-input')) internal.warnings.push(WARNINGS.unresolvedInput)
  if (prepared.removedSolutions > 0) {
    internal.warnings.push(
      `Removed ${prepared.removedSolutions} solution block${prepared.removedSolutions === 1 ? '' : 's'} from the LaTeX source.`,
    )
  }
  return internal
}

function latexNode(seg: LatexSegment, strength: Strength, convert: (src: string, depth: number) => string): Node {
  const node: Node = {
    label: seg.label,
    title: seg.title,
    statement: '',
    children: [],
    pageStart: null,
    pageEnd: null,
    warnings: [],
    strength,
  }
  const leaf = (label: string, statement: string): Node => ({
    label,
    title: null,
    statement,
    children: [],
    pageStart: null,
    pageEnd: null,
    warnings: [],
    strength,
  })
  const kids = extractLatexChildren(seg.source, seg.enumDepth, seg.exam)
  if (kids) {
    node.statement = [convert(kids.intro, seg.enumDepth), convert(kids.outro, seg.enumDepth)].filter(Boolean).join('\n\n')
    node.children = kids.items.map((item) => leaf(item.label, convert(item.source, kids.childDepth)))
    return node
  }
  const markdown = convert(seg.source, seg.enumDepth)
  const split = findSubparts(markdown)
  if (!split) {
    node.statement = markdown
    return node
  }
  node.statement = tidyWhitespace(split.intro, false)
  node.children = split.parts.map((p) => leaf(p.label, tidyWhitespace(p.text, false)))
  return node
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

const DOWNGRADE: Readonly<Record<Strength, Confidence>> = { high: 'medium', medium: 'low', low: 'low' }

function finalizeNode(node: Node, isPdf: boolean, nextId: () => string, isChild: boolean): DraftProblem {
  const warnings = [...node.warnings]
  if (hasSuspiciousChars(node.statement)) warnings.push(WARNINGS.replacementChars)
  if (isPdf && looksLikeGarbledMath(node.statement)) warnings.push(WARNINGS.garbledMath)
  if (!node.statement.trim() && node.children.length === 0) warnings.push(WARNINGS.emptyStatement)
  if (node.statement.length > LONG_STATEMENT_CHARS) warnings.push(WARNINGS.longStatement)
  const id = nextId()
  const children = isChild ? [] : node.children.map((c) => finalizeNode(c, isPdf, nextId, true))
  return {
    id,
    label: node.label,
    title: node.title,
    statementMarkdown: node.statement,
    children,
    pageStart: node.pageStart,
    pageEnd: node.pageEnd,
    confidence: warnings.length ? DOWNGRADE[node.strength] : node.strength,
    warnings: [...new Set(warnings)],
  }
}

function emptyResult(
  quality: Omit<ParseResult['quality'], 'status' | 'detectedScheme'>,
  warning: string,
): ParseResult {
  return {
    problems: [],
    preamble: '',
    warnings: [warning],
    quality: { ...quality, status: 'empty', detectedScheme: null },
    guessedTitle: null,
    guessedNumber: null,
    guessedDueDate: null,
  }
}

function everyProblem(problems: DraftProblem[]): DraftProblem[] {
  return problems.flatMap((p) => [p, ...everyProblem(p.children)])
}

/** Parses extracted document text into draft problems for the review editor. Never throws. */
export function parseDocument(input: ParseInput): ParseResult {
  const kind: SourceKind = (['pdf', 'tex', 'markdown', 'text', 'docx'] as const).includes(input.kind) ? input.kind : 'text'
  const isPdf = kind === 'pdf'
  const pages = isPdf ? (input.pages ?? (typeof input.text === 'string' ? [input.text] : [])) : null
  const raw = normalizeExtractedText(pages ? pages.join('\n') : (input.text ?? ''))
  const charCount = countNonWhitespace(raw)
  const pageCount = pages ? pages.length : null
  const baseQuality = {
    charCount,
    pageCount,
    avgCharsPerPage: pageCount ? charCount / pageCount : null,
    suspiciousCharRatio: charCount ? countSuspicious(raw) / charCount : 0,
  }
  if (charCount === 0) {
    return emptyResult(
      baseQuality,
      isPdf
        ? 'No text could be extracted from this PDF. If it is scanned, please transcribe the problems manually or upload LaTeX source.'
        : 'The document is empty.',
    )
  }

  let internal: Internal
  let firstPageHeader: string[] = []
  try {
    if (kind === 'tex') {
      internal = parseLatexSource(raw)
    } else if (isPdf && pages) {
      const pdf = buildPdfLines(pages)
      firstPageHeader = pdf.firstPageHeader
      internal = parseTextual(pdf.lines, { kind, escapeDollars: true })
    } else {
      const escape = !looksLikeTexMath(raw)
      internal = parseTextual(
        raw.split('\n').map((text) => ({ text, page: null })),
        { kind, escapeDollars: escape },
      )
    }
  } catch {
    // Last resort: the heuristics above should not throw, but an upload must never crash the page.
    internal = {
      nodes: [{ label: '1', title: null, statement: raw.trim(), children: [], pageStart: null, pageEnd: null, warnings: [], strength: 'low' }],
      preamble: '',
      scheme: null,
      warnings: [WARNINGS.noStructure],
      metaLines: raw.split('\n').slice(0, 10),
    }
  }

  const nextId = createIdGenerator()
  const problems = internal.nodes.map((n) => finalizeNode(n, isPdf, nextId, false))
  const warnings: string[] = []
  const likelyScanned = isPdf && (pageCount ?? 0) >= 1 && (baseQuality.avgCharsPerPage ?? 0) < SCANNED_CHARS_PER_PAGE
  if (likelyScanned) warnings.push(WARNINGS.scanned)
  if (baseQuality.suspiciousCharRatio > SUSPICIOUS_RATIO_LIMIT) warnings.push(WARNINGS.undecodable)
  if (isPdf) warnings.push(WARNINGS.pdfGeneral)
  warnings.push(...internal.warnings)
  const all = everyProblem(problems)
  if (all.length > MAX_PROBLEMS) warnings.push(`Detected ${all.length} problems, more than the maximum of ${MAX_PROBLEMS}.`)

  let status: QualityStatus
  if (likelyScanned) status = 'likely_scanned'
  else if (internal.scheme === null) status = 'no_problems_found'
  else if (isPdf || warnings.length > 0 || all.some((p) => p.warnings.length > 0 || p.confidence !== 'high')) status = 'needs_review'
  else status = 'ok'

  const metaLines = [...firstPageHeader, ...internal.metaLines]
  const title = guessTitle(metaLines)
  return {
    problems,
    preamble: internal.preamble,
    warnings: [...new Set(warnings)],
    quality: { ...baseQuality, status, detectedScheme: internal.scheme },
    guessedTitle: title?.title ?? null,
    guessedNumber: title?.number ?? null,
    guessedDueDate: guessDueDate(metaLines),
  }
}
