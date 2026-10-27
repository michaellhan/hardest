import type { FileKind } from './types'
import type { SourceKind } from './parser'

export const MAX_FILE_BYTES = 20 * 1024 * 1024
export const MAX_PDF_PAGES = 80

export interface Extracted {
  kind: SourceKind
  fileKind: FileKind
  /** PDF only: text per page. */
  pages?: string[]
  text?: string
  pageCount: number | null
  /** PDF only: kept for rendering page previews during review. */
  pdf?: PdfHandle
}

export interface PdfHandle {
  numPages: number
  render(page: number, canvas: HTMLCanvasElement, width: number): Promise<void>
  destroy(): void
}

export function detectKind(file: File): { kind: SourceKind; fileKind: FileKind } | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return { kind: 'pdf', fileKind: 'pdf' }
  if (name.endsWith('.tex') || name.endsWith('.ltx')) return { kind: 'tex', fileKind: 'tex' }
  if (name.endsWith('.md') || name.endsWith('.markdown')) return { kind: 'markdown', fileKind: 'markdown' }
  if (name.endsWith('.txt') || file.type === 'text/plain') return { kind: 'text', fileKind: 'text' }
  if (name.endsWith('.docx')) return { kind: 'docx', fileKind: 'docx' }
  return null
}

/** Reads text out of a file entirely in the browser; nothing is uploaded at this point. */
export async function extractFile(file: File, onProgress?: (msg: string) => void): Promise<Extracted> {
  const k = detectKind(file)
  if (!k) throw new Error('Unsupported file type. Use PDF, LaTeX (.tex), Markdown (.md), plain text (.txt), or Word (.docx).')
  if (file.size > MAX_FILE_BYTES) throw new Error('That file is larger than 20 MB.')
  if (k.kind === 'pdf') return extractPdf(file, onProgress)
  if (k.kind === 'docx') {
    onProgress?.('Reading Word document…')
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return { ...k, text: value, pageCount: null }
  }
  const text = await file.text()
  if (text.includes('\u0000')) throw new Error('This looks like a binary file, not text.')
  return { ...k, text, pageCount: null }
}

interface TextItem {
  str: string
  transform: number[]
  width: number
  height: number
  hasEOL?: boolean
}

/** Rebuilds lines from pdf.js text items by grouping on baseline and ordering left to right. */
export function itemsToText(items: TextItem[]): string {
  const rows: Array<{ y: number; h: number; parts: Array<{ x: number; w: number; s: string }> }> = []
  for (const it of items) {
    if (!it.str) continue
    const x = it.transform[4]
    const y = it.transform[5]
    const h = Math.abs(it.height || it.transform[3] || 10)
    // Superscripts/subscripts sit within ~half a line of their baseline.
    let row = rows.find((r) => Math.abs(r.y - y) < Math.max(2, Math.max(r.h, h) * 0.45))
    if (!row) {
      row = { y, h, parts: [] }
      rows.push(row)
    }
    row.parts.push({ x, w: it.width, s: it.str })
  }
  rows.sort((a, b) => b.y - a.y)
  const lines: string[] = []
  let prevY: number | null = null
  let prevH = 10
  for (const r of rows) {
    r.parts.sort((a, b) => a.x - b.x)
    let line = ''
    let end = -Infinity
    for (const p of r.parts) {
      const gap = p.x - end
      if (line && gap > r.h * 0.18 && !line.endsWith(' ') && !p.s.startsWith(' ')) line += ' '
      line += p.s
      end = p.x + p.w
    }
    // A large vertical jump marks a paragraph break.
    if (prevY != null && prevY - r.y > Math.max(prevH, r.h) * 1.9) lines.push('')
    lines.push(line.replace(/\s+$/, ''))
    prevY = r.y
    prevH = r.h
  }
  return lines.join('\n')
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist')
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = worker
  return pdfjs
}

async function extractPdf(file: File, onProgress?: (msg: string) => void): Promise<Extracted> {
  onProgress?.('Loading PDF reader…')
  const pdfjs = await loadPdfjs()
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  if (doc.numPages > MAX_PDF_PAGES) {
    await task.destroy()
    throw new Error(`That PDF has ${doc.numPages} pages; the limit is ${MAX_PDF_PAGES}. Upload just the assignment.`)
  }
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    onProgress?.(`Reading page ${i} of ${doc.numPages}…`)
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(itemsToText(content.items as TextItem[]))
    page.cleanup()
  }
  const handle: PdfHandle = {
    numPages: doc.numPages,
    async render(n, canvas, width) {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const viewport = page.getViewport({ scale: (width / base.width) * dpr })
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
    },
    destroy() {
      void task.destroy()
    },
  }
  return { kind: 'pdf', fileKind: 'pdf', pages, pageCount: doc.numPages, pdf: handle }
}

/**
 * Manual entry: "1, 2, 3a, 3b, 4" or "1-6" or one label per line → a problem tree.
 * Letters/roman numerals directly after a number become subproblems ("3a" → 3 › a).
 */
export function parseLabelList(input: string): Array<{ label: string; children: string[] }> {
  const out: Array<{ label: string; children: string[] }> = []
  const tokens = input
    .split(/[\n,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  for (const tok of tokens) {
    const range = tok.match(/^(\d+)\s*[-–]\s*(\d+)$/)
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])]
      if (b >= a && b - a < 60) for (let i = a; i <= b; i++) out.push({ label: String(i), children: [] })
      continue
    }
    const bare = tok.replace(/^(problem|prob\.?|p|q|question|#)\s*/i, '').trim()
    const sub = bare.match(/^(\d+)\s*\(?([a-z]|[ivx]+)\)?$/i)
    if (sub) {
      const parent = out.find((p) => p.label === sub[1]) ?? (out.push({ label: sub[1], children: [] }), out[out.length - 1])
      if (!parent.children.includes(sub[2].toLowerCase())) parent.children.push(sub[2].toLowerCase())
      continue
    }
    if (bare && !out.some((p) => p.label === bare)) out.push({ label: bare, children: [] })
  }
  return out
}
