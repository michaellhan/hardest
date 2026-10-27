import { describe, expect, it } from 'vitest'
import { parseDocument } from '../index'

describe('parseDocument — PDF', () => {
  const page1 = [
    'MATH 101: Problem Set 4',
    'Due: Thursday, September 17, 2026',
    'Problem 1. Prove that every group of order 4 is abelian.',
    'Problem 2 (Sylow theorems). Let G be a group of order 12.',
    'Show that G has a normal Sylow subgroup',
    '1',
  ].join('\n')
  const page2 = ['MATH 101: Problem Set 4', 'of order 3 or 4.', 'Problem 3.', '(a) Show that H is normal.', '(b) Deduce that G is solvable.', '2'].join('\n')

  it('parses problems across pages, strips headers and page numbers, and tracks pages', () => {
    const r = parseDocument({ kind: 'pdf', pages: [page1, page2] })
    expect(r.quality.detectedScheme).toBe('problem-n')
    expect(r.quality.pageCount).toBe(2)
    expect(r.problems.map((p) => p.label)).toEqual(['1', '2', '3'])
    const [p1, p2, p3] = r.problems
    expect(p1?.pageStart).toBe(1)
    expect(p1?.pageEnd).toBe(1)
    expect(p2?.title).toBe('Sylow theorems')
    expect(p2?.pageStart).toBe(1)
    expect(p2?.pageEnd).toBe(2)
    expect(p2?.statementMarkdown).toBe('Let G be a group of order 12.\nShow that G has a normal Sylow subgroup\nof order 3 or 4.')
    expect(p3?.pageStart).toBe(2)
    expect(p3?.children.map((c) => [c.label, c.pageStart, c.pageEnd])).toEqual([
      ['a', 2, 2],
      ['b', 2, 2],
    ])
    const all = JSON.stringify(r.problems)
    expect(all).not.toContain('MATH 101')
    expect(r.preamble).toBe('Due: Thursday, September 17, 2026')
    expect(r.guessedTitle).toBe('Problem Set 4')
    expect(r.guessedNumber).toBe(4)
    expect(r.guessedDueDate).toBe('2026-09-17')
    expect(r.quality.status).toBe('needs_review')
  })

  it('strips "Page N of M" footers', () => {
    const pages = [1, 2, 3].map((n) => `Problem ${n}. Statement number ${n} is here.\nPage ${n} of 3`)
    const r = parseDocument({ kind: 'pdf', pages })
    expect(r.problems.map((p) => p.statementMarkdown)).toEqual([
      'Statement number 1 is here.',
      'Statement number 2 is here.',
      'Statement number 3 is here.',
    ])
    expect(r.problems.map((p) => p.pageStart)).toEqual([1, 2, 3])
  })

  it('does not strip a heading that repeats at the top of every page', () => {
    const pages = ['Problem 1.\nProve A carefully with details.', 'Problem 2.\nProve B carefully with details.', 'Problem 3.\nProve C carefully with details.']
    const r = parseDocument({ kind: 'pdf', pages })
    expect(r.problems.map((p) => p.label)).toEqual(['1', '2', '3'])
  })

  it('splits headings when pdf.js joined all lines', () => {
    const r = parseDocument({
      kind: 'pdf',
      pages: ['Problem 1. Show that the sum of two even integers is even. Problem 2. Using Problem 1, show that the sum of four even integers is even. Problem 3. (a) Show X holds in general. (b) Deduce Y from it.'],
    })
    expect(r.problems.map((p) => p.label)).toEqual(['1', '2', '3'])
    expect(r.problems[1]?.statementMarkdown).toBe('Using Problem 1, show that the sum of four even integers is even.')
    expect(r.problems[2]?.children.map((c) => c.label)).toEqual(['a', 'b'])
  })

  it('reports empty PDFs', () => {
    const r = parseDocument({ kind: 'pdf', pages: ['', ''] })
    expect(r.quality.status).toBe('empty')
    expect(r.problems).toEqual([])
    expect(r.quality.charCount).toBe(0)
    expect(r.quality.pageCount).toBe(2)
  })

  it('reports likely scanned PDFs', () => {
    const r = parseDocument({ kind: 'pdf', pages: ['abcde', 'fghij', 'klmno'] })
    expect(r.quality.status).toBe('likely_scanned')
    expect(r.quality.avgCharsPerPage).toBe(5)
    expect(r.warnings.some((w) => w.includes('scanned or image-based'))).toBe(true)
  })

  it('flags undecodable characters (U+FFFD and private use)', () => {
    const r = parseDocument({
      kind: 'pdf',
      pages: ['Problem 1. Let � be the map with (x) =  for all x in the domain of interest.\nProblem 2. Show the identity holds for every real number x and y.'],
    })
    expect(r.quality.suspiciousCharRatio).toBeGreaterThan(0.02)
    expect(r.quality.status).toBe('needs_review')
    expect(r.warnings).toContain(
      'Some characters could not be decoded (common with math fonts). Compare each statement against the original PDF.',
    )
    expect(r.problems[0]?.warnings).toContain('Statement contains replacement characters (possible garbled math)')
    expect(r.problems[0]?.confidence).not.toBe('high')
    expect(r.problems[1]?.warnings).not.toContain('Statement contains replacement characters (possible garbled math)')
  })

  it('flags likely garbled math and keeps the text verbatim', () => {
    const r = parseDocument({
      kind: 'pdf',
      pages: ['Problem 1. Let\nf ( x ) = x 2 + 1\nand compute the derivative.\nProblem 2. Prove that the sky is blue on clear days.'],
    })
    expect(r.problems[0]?.warnings).toContain('Mathematical notation may not have extracted correctly; check against the PDF.')
    expect(r.problems[0]?.statementMarkdown).toBe('Let\nf ( x ) = x 2 + 1\nand compute the derivative.')
    expect(r.problems[1]?.warnings).toEqual([])
    expect(r.problems[1]?.confidence).toBe('high')
  })

  it('escapes dollar signs from PDF text instead of creating math', () => {
    const r = parseDocument({ kind: 'pdf', pages: ['Problem 1. A ticket costs $5 and a pass costs $20 at the fair today.'] })
    expect(r.problems[0]?.statementMarkdown).toBe('A ticket costs \\$5 and a pass costs \\$20 at the fair today.')
  })

  it('always marks PDFs as needs_review at minimum', () => {
    const r = parseDocument({ kind: 'pdf', pages: ['Problem 1. Prove that the integers are infinite in number.\nProblem 2. Prove that the primes are infinite in number.'] })
    expect(r.problems.every((p) => p.confidence === 'high')).toBe(true)
    expect(r.quality.status).toBe('needs_review')
  })

  it('accepts text instead of pages for a PDF', () => {
    const r = parseDocument({ kind: 'pdf', text: 'Problem 1. Prove that the integers are infinite in number for sure.' })
    expect(r.quality.pageCount).toBe(1)
    expect(r.problems).toHaveLength(1)
  })
})
