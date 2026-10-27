/** Public types for the client-side assignment parser. */

export type SourceKind = 'pdf' | 'tex' | 'markdown' | 'text' | 'docx'

export type Confidence = 'high' | 'medium' | 'low'

export type QualityStatus = 'ok' | 'needs_review' | 'likely_scanned' | 'empty' | 'no_problems_found'

export interface ParseInput {
  kind: SourceKind
  /** For PDFs: text per page (index 0 = page 1). For others: omit. */
  pages?: string[]
  /** For non-PDFs: whole document text. */
  text?: string
  /** PDFs only: the pages already carry $…$ math rebuilt from the PDF's fonts, so `$` is not currency. */
  texMath?: boolean
}

export interface DraftProblem {
  /** Client-side temp id, stable within one parse ('d1', 'd2', … in document order). */
  id: string
  /** Label without any "Problem" prefix: '3' for a top-level problem, 'a' / 'ii' for a subproblem. */
  label: string
  /** e.g. "Sylow theorems" from "Problem 2 (Sylow theorems)." */
  title: string | null
  /** Markdown with $…$ / $$…$$ math; may be ''. */
  statementMarkdown: string
  /** Subproblems (one level; deeper levels are flattened into the statement). */
  children: DraftProblem[]
  /** 1-based page numbers, PDFs only. */
  pageStart: number | null
  pageEnd: number | null
  confidence: Confidence
  /** Per-problem issues, e.g. 'Label sequence jumps from 2 to 4'. */
  warnings: string[]
}

export interface ParseQuality {
  status: QualityStatus
  /** Number of non-whitespace characters in the extracted input. */
  charCount: number
  pageCount: number | null
  avgCharsPerPage: number | null
  /** Fraction of characters that are U+FFFD, private-use, or control characters. */
  suspiciousCharRatio: number
  detectedScheme: string | null
}

export interface ParseResult {
  problems: DraftProblem[]
  /** Text appearing before the first detected problem (instructions/header). */
  preamble: string
  /** Document-level warnings. */
  warnings: string[]
  quality: ParseQuality
  guessedTitle: string | null
  guessedNumber: number | null
  /** ISO yyyy-mm-dd, only when a full, unambiguous due date is present. */
  guessedDueDate: string | null
}
