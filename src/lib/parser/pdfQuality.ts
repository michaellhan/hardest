/** PDF-specific cleanup and quality heuristics (running headers, page numbers, garbled math). */
import { isHeadingLike, type Line } from './detect'
import { normalizeExtractedText } from './text'

/** How many non-empty lines at the top and bottom of a page are considered header/footer candidates. */
const EDGE_LINES = 3
const HEADER_PAGE_FRACTION = 0.6

const PAGE_NUMBER_RES: readonly RegExp[] = [
  /^[-–—]?\s*\d{1,4}\s*[-–—]?$/,
  /^page\s+\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i,
  /^\d{1,4}\s*(?:\/|of)\s*\d{1,4}$/i,
  /^p\.\s*\d{1,4}$/i,
]

export function isPageNumberLine(text: string): boolean {
  const t = text.trim()
  return PAGE_NUMBER_RES.some((re) => re.test(t))
}

/** Comparison key for repeated header/footer lines; digits are wildcarded so "Page 3" ≈ "Page 4". */
function edgeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/\d+/g, '#').toLowerCase()
}

function edgeIndices(lines: string[]): number[] {
  const nonEmpty: number[] = []
  lines.forEach((l, i) => {
    if (l.trim()) nonEmpty.push(i)
  })
  const picked = new Set([...nonEmpty.slice(0, EDGE_LINES), ...nonEmpty.slice(-EDGE_LINES)])
  return [...picked]
}

export interface PdfLines {
  lines: Line[]
  /** Lines removed from the top of page 1 (often the assignment title; used for metadata). */
  firstPageHeader: string[]
  removedCount: number
}

/**
 * Splits pages into lines tagged with page numbers, dropping running headers/footers
 * (identical modulo digits on ≥60% of pages, at the page edges) and bare page numbers.
 * Lines that look like problem headings are never dropped.
 */
export function buildPdfLines(pages: string[]): PdfLines {
  const pageLines = pages.map((p) => normalizeExtractedText(p).split('\n').map((l) => l.replace(/\s+$/, '')))
  const pageCount = pageLines.length
  const keyPages = new Map<string, number>()
  if (pageCount >= 2) {
    for (const lines of pageLines) {
      const keys = new Set(edgeIndices(lines).map((i) => edgeKey(lines[i] ?? '')))
      for (const k of keys) keyPages.set(k, (keyPages.get(k) ?? 0) + 1)
    }
  }
  const threshold = Math.max(2, Math.ceil(HEADER_PAGE_FRACTION * pageCount))

  const out: Line[] = []
  const firstPageHeader: string[] = []
  let removedCount = 0
  pageLines.forEach((lines, p) => {
    const edges = new Set(edgeIndices(lines))
    const nonEmpty = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0)
    const outerEdges = new Set([...nonEmpty.slice(0, 2), ...nonEmpty.slice(-2)])
    lines.forEach((text, i) => {
      if (edges.has(i) && text.trim()) {
        const repeated = pageCount >= 2 && (keyPages.get(edgeKey(text)) ?? 0) >= threshold
        const pageNo = outerEdges.has(i) && isPageNumberLine(text)
        if ((repeated || pageNo) && text.length <= 160 && !isHeadingLike(text)) {
          removedCount++
          if (p === 0 && i <= (nonEmpty[EDGE_LINES - 1] ?? -1) && !pageNo) firstPageHeader.push(text.trim())
          return
        }
      }
      out.push({ text, page: p + 1 })
    })
  })
  return { lines: out, firstPageHeader, removedCount }
}

const MATH_SYMBOL_RE =
  /[∑∏∫∮√∞≤≥≠≈≡∈∉⊂⊆⊃⊇∪∩∀∃∂∇±∓×÷→←↔⇒⇐⇔↦∧∨¬⊕⊗∘′″αβγδεζηθικλμνξπρστυφχψωΓΔΘΛΞΠΣΦΨΩℝℕℤℚℂ]/gu

/**
 * Heuristic for math that pdf.js flattened badly: lines made mostly of isolated single
 * characters ("f ( x ) = x 2 + 1"), or several math symbols with no TeX delimiters.
 */
export function looksLikeGarbledMath(text: string): boolean {
  for (const line of text.split('\n')) {
    const tokens = line.trim().split(/\s+/).filter(Boolean)
    if (tokens.length < 6) continue
    const singles = tokens.filter((t) => [...t].length === 1 && !/^[aAI]$/.test(t)).length
    if (singles >= 4 && singles / tokens.length >= 0.5) return true
  }
  const symbols = text.replace(/\$[^$]*\$/g, '').match(MATH_SYMBOL_RE)
  return (symbols?.length ?? 0) >= 3
}
