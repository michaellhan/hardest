/** Assignment-level metadata guesses (title, number, due date) from header lines. */

const TITLE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bProblem[\s-]*Set\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Problem Set'],
  [/\bP[\s-]?Set\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Problem Set'],
  [/\bPS\s*#?\s*(\d{1,3})\b/, 'Problem Set'],
  [/\bHomework\s*(?:Assignment\s*)?(?:#|No\.?|Number)?\s*(\d{1,3})\b/i, 'Homework'],
  [/\bHW\s*#?\s*(\d{1,3})\b/i, 'Homework'],
  [/\bAssignment\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Assignment'],
  [/\bLab\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Lab'],
  [/\bEssay\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Essay'],
  [/\bWorksheet\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Worksheet'],
  [/\bProject\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Project'],
  [/\bQuiz\s*(?:#|No\.?)?\s*(\d{1,3})\b/i, 'Quiz'],
]

export interface TitleGuess {
  title: string
  number: number
}

/**
 * Finds "Problem Set 4" / "HW 5" / "Pset 7" … in the header lines. Returns null when no
 * match is found or when matches disagree on the number (e.g. "Homework 3" and "Homework 4").
 */
export function guessTitle(lines: string[]): TitleGuess | null {
  let found: TitleGuess | null = null
  for (const line of lines) {
    // Leftmost match first, so "Homework 3 (Problem Set 3)" reads as Homework 3.
    const matches: Array<{ index: number; guess: TitleGuess }> = []
    for (const [re, name] of TITLE_PATTERNS) {
      const m = re.exec(line)
      if (m) matches.push({ index: m.index, guess: { title: `${name} ${Number(m[1])}`, number: Number(m[1]) } })
    }
    matches.sort((a, b) => a.index - b.index)
    for (const { guess } of matches) {
      if (!found) found = guess
      else if (found.number !== guess.number) return null
    }
  }
  return found
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}
const MONTH_SRC = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`

const DATE_PATTERNS: ReadonlyArray<{ re: RegExp; parse: (m: RegExpExecArray) => [number, number, number | null] }> = [
  {
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/,
    parse: (m) => [Number(m[2]), Number(m[3]), Number(m[1])],
  },
  {
    re: new RegExp(String.raw`\b${MONTH_SRC}\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4})\b)?`, 'i'),
    parse: (m) => [MONTHS[(m[1] ?? '').slice(0, 3).toLowerCase()] ?? 0, Number(m[2]), m[3] ? Number(m[3]) : null],
  },
  {
    re: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH_SRC}(?:,?\s+(\d{4})\b)?`, 'i'),
    parse: (m) => [MONTHS[(m[2] ?? '').slice(0, 3).toLowerCase()] ?? 0, Number(m[1]), m[3] ? Number(m[3]) : null],
  },
  {
    // US-style M/D/Y (the platform's primary audience); 2-digit years are read as 20YY.
    re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/,
    parse: (m) => [Number(m[1]), Number(m[2]), m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null],
  },
]

function isoDate(month: number, day: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2200) return null
  const dim = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > dim) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Parses the earliest date in `text`; `undefined` = no date at all, null = a date without a year / invalid. */
function parseFirstDate(text: string): string | null | undefined {
  let best: { index: number; value: string | null } | null = null
  for (const { re, parse } of DATE_PATTERNS) {
    const m = re.exec(text)
    if (!m || (best && best.index <= m.index)) continue
    const [month, day, year] = parse(m)
    best = { index: m.index, value: year === null ? null : isoDate(month, day, year) }
  }
  return best ? best.value : undefined
}

/**
 * Due date from phrases like "Due: Thursday, September 17, 2026" or "due 9/17/2026".
 * Dates without a year, invalid dates, and conflicting due dates all yield null.
 */
export function guessDueDate(lines: string[]): string | null {
  const results = new Set<string | null>()
  for (const line of lines) {
    const re = /\b(?:due(?:\s+date)?|deadline|submit\s+by)\b\s*(?:on|by|at|:)?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(line))) {
      const window = line.slice(m.index + m[0].length, m.index + m[0].length + 80)
      const value = parseFirstDate(window)
      if (value !== undefined) results.add(value)
    }
  }
  if (results.size !== 1) return null
  const [only] = [...results]
  return only ?? null
}
