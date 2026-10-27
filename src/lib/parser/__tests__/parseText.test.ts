import { describe, expect, it } from 'vitest'
import { parseDocument, type DraftProblem } from '../index'

const text = (t: string) => parseDocument({ kind: 'text', text: t })
const labels = (ps: DraftProblem[]) => ps.map((p) => p.label)

describe('parseDocument — "Problem N" text', () => {
  it('parses the spec example with subparts, preserving order', () => {
    const r = text(
      'Problem 1. Prove that ...\nProblem 2. Let G be a group ...\nProblem 3.\n(a) Show that ...\n(b) Deduce that ...',
    )
    expect(r.quality.detectedScheme).toBe('problem-n')
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
    expect(r.problems[0]?.statementMarkdown).toBe('Prove that ...')
    expect(r.problems[1]?.statementMarkdown).toBe('Let G be a group ...')
    const p3 = r.problems[2]!
    expect(p3.statementMarkdown).toBe('')
    expect(labels(p3.children)).toEqual(['a', 'b'])
    expect(p3.children.map((c) => c.statementMarkdown)).toEqual(['Show that ...', 'Deduce that ...'])
    expect(r.problems.flatMap((p) => [p.id, ...p.children.map((c) => c.id)])).toEqual(['d1', 'd2', 'd3', 'd4', 'd5'])
    expect(r.quality.status).toBe('ok')
    expect(r.problems.every((p) => p.confidence === 'high')).toBe(true)
  })

  it('ids are deterministic across parses', () => {
    const a = text('Problem 1. A.\nProblem 2. B.')
    const b = text('Problem 1. A.\nProblem 2. B.')
    expect(a.problems.map((p) => p.id)).toEqual(['d1', 'd2'])
    expect(b.problems.map((p) => p.id)).toEqual(['d1', 'd2'])
  })

  it('splits inline subparts after the heading', () => {
    const r = text('Problem 3. (a) Show X. (b) Deduce Y.')
    const p = r.problems[0]!
    expect(p.label).toBe('3')
    expect(p.statementMarkdown).toBe('')
    expect(p.children.map((c) => [c.label, c.statementMarkdown])).toEqual([
      ['a', 'Show X.'],
      ['b', 'Deduce Y.'],
    ])
  })

  it('keeps intro text before subparts in the parent statement', () => {
    const r = text('Problem 1. Let $f(x) = x^2$.\n(a) Compute $f(2)$.\n(b) Compute $f(3)$.')
    expect(r.problems[0]?.statementMarkdown).toBe('Let $f(x) = x^2$.')
    expect(r.problems[0]?.children).toHaveLength(2)
  })

  it('recognizes roman numeral subparts', () => {
    const r = text('Problem 1. Show the following.\n(i) First claim.\n(ii) Second claim.\n(iii) Third claim.')
    expect(labels(r.problems[0]!.children)).toEqual(['i', 'ii', 'iii'])
  })

  it('treats (i) after (h) as a letter', () => {
    const parts = 'abcdefghi'.split('').map((l) => `(${l}) Part ${l}.`).join('\n')
    const r = text(`Problem 1. Many parts.\n${parts}`)
    expect(labels(r.problems[0]!.children)).toEqual('abcdefghi'.split(''))
  })

  it('keeps nested roman items inside the letter subpart', () => {
    const r = text('Problem 1.\n(a) Outer one.\n(i) inner one\n(ii) inner two\n(b) Outer two.')
    const p = r.problems[0]!
    expect(labels(p.children)).toEqual(['a', 'b'])
    expect(p.children[0]?.statementMarkdown).toContain('(ii) inner two')
  })

  it('supports primed subparts like (b\')', () => {
    const r = text("Problem 1.\n(a) One.\n(b) Two.\n(b') Two prime.\n(c) Three.")
    expect(labels(r.problems[0]!.children)).toEqual(['a', 'b', "b'", 'c'])
  })

  it('needs at least two sequential subparts', () => {
    const r = text('Problem 1. Consider case (a) only.\n(a) Lonely part.')
    expect(r.problems[0]?.children).toEqual([])
  })

  it('does not split on mid-sentence references to other problems', () => {
    const r = text(
      'Problem 1. Prove the lemma.\nProblem 2. Using Problem 1, show that the claim holds, as in Problem 1 (a).\nProblem 2 is similar to the previous one.\nProblem 3. Done.',
    )
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
    expect(r.problems[1]?.statementMarkdown).toContain('Using Problem 1, show that')
    expect(r.problems[1]?.statementMarkdown).toContain('Problem 2 is similar')
  })

  it('splits headings joined mid-line after a sentence end', () => {
    const r = text('Problem 1. Prove A. Problem 2. Prove B. See Problem 3 for hints. Problem 3: Prove C.')
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
    expect(r.problems[1]?.statementMarkdown).toBe('Prove B. See Problem 3 for hints.')
  })

  it('extracts titles and drops point values', () => {
    const r = text(
      'Problem 1 (Sylow theorems). Let G be a group.\nProblem 2 (10 points) Prove that x = x.\nProblem 3 [Warm-up]: Easy.',
    )
    expect(r.problems.map((p) => p.title)).toEqual(['Sylow theorems', null, 'Warm-up'])
    expect(r.problems[1]?.statementMarkdown).toBe('Prove that x = x.')
  })

  it('handles bold and uppercase headings', () => {
    const r = text('**Problem 1.** First.\n\n**Problem 2: Groups.** Second.\n\nPROBLEM 3\nThird.')
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
    expect(r.problems[1]?.title).toBe('Groups')
    expect(r.problems[1]?.statementMarkdown).toBe('Second.')
    expect(r.problems[2]?.statementMarkdown).toBe('Third.')
  })

  it('does not read plural all-caps words as headings', () => {
    const r = text('PROBLEMS\nProblem 1. A.\nProblem 2. B.\nQUESTIONS AND TOPICS')
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.preamble).toBe('PROBLEMS')
  })

  it('treats "Problem N (continued)" as a carry-over, not a new problem', () => {
    const r = parseDocument({
      kind: 'pdf',
      pages: ['Problem 1. Start of a long statement that keeps going.', 'Problem 1 (continued)\nmore of the same statement here.\nProblem 2. Next.'],
    })
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.problems[0]?.pageEnd).toBe(2)
  })

  it('captures the preamble before the first problem', () => {
    const r = text('Homework 3\nDue 9/17/2026\nShow all work.\n\nProblem 1. A.\nProblem 2. B.')
    expect(r.preamble).toBe('Homework 3\nDue 9/17/2026\nShow all work.')
    expect(r.guessedTitle).toBe('Homework 3')
    expect(r.guessedNumber).toBe(3)
    expect(r.guessedDueDate).toBe('2026-09-17')
  })
})

describe('parseDocument — other heading schemes', () => {
  it('Exercise / Ex.', () => {
    expect(text('Exercise 1. A.\nExercise 2. B.').quality.detectedScheme).toBe('exercise-n')
    expect(labels(text('Ex. 1 Show A.\nEx. 2 Show B.').problems)).toEqual(['1', '2'])
  })

  it('Question / Q4.', () => {
    const r = text('Q1. What?\nQ2. Why?\nQ3. How?')
    expect(r.quality.detectedScheme).toBe('question-n')
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
    expect(text('Question 1: A\nQuestion 2: B').quality.detectedScheme).toBe('question-n')
  })

  it('#1 style and Milestone', () => {
    expect(labels(text('#1 Do this.\n#2 Do that.').problems)).toEqual(['1', '2'])
    expect(text('Milestone 1: Setup.\nMilestone 2: Build.').quality.detectedScheme).toBe('milestone-n')
  })

  it('Part N is used only when nothing else matches', () => {
    const r = text('Part 1. Read the chapter.\nPart 2. Write a summary.')
    expect(r.quality.detectedScheme).toBe('part-n')
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.problems[0]?.confidence).toBe('medium')
    const mixed = text('Problem 1. Intro.\nPart 1. Not a problem.\nProblem 2. Next.')
    expect(mixed.quality.detectedScheme).toBe('problem-n')
    expect(labels(mixed.problems)).toEqual(['1', '2'])
  })

  it('Part I / Part II roman labels', () => {
    const r = text('Part I. Theory.\nPart II. Practice.\nPart III. Review.')
    expect(labels(r.problems)).toEqual(['I', 'II', 'III'])
    expect(r.problems.every((p) => p.warnings.length === 0)).toBe(true)
  })

  it('essay prompts', () => {
    const r = text(
      'English 101 — Essay 2\nChoose one prompt.\n\nPrompt A: Discuss the role of memory in the novel.\n\nPrompt B: Compare two narrators.\n\nPrompt C: Analyze the ending.',
    )
    expect(r.quality.detectedScheme).toBe('essay-prompts')
    expect(labels(r.problems)).toEqual(['A', 'B', 'C'])
    expect(r.problems[1]?.statementMarkdown).toBe('Compare two narrators.')
    expect(r.preamble).toContain('Choose one prompt.')
    expect(r.guessedTitle).toBe('Essay 2')
  })

  it('Essay Prompt A / Option 1', () => {
    expect(labels(text('Essay Prompt A. One.\nEssay Prompt B. Two.').problems)).toEqual(['A', 'B'])
    expect(labels(text('Option 1: One.\nOption 2: Two.').problems)).toEqual(['1', '2'])
  })
})

describe('parseDocument — numbered lists', () => {
  it('detects sequential "1." lists', () => {
    const r = text('Math 1A Homework 5\n\n1. Prove that 2 is prime.\n2. Show that 3 is odd.\n3. Compute 4 + 4.')
    expect(r.quality.detectedScheme).toBe('numbered-list')
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
    expect(r.problems[2]?.statementMarkdown).toBe('Compute 4 + 4.')
    expect(r.preamble).toBe('Math 1A Homework 5')
  })

  it('detects "1)" and "(1)" lists', () => {
    expect(labels(text('1) A thing.\n2) Another.').problems)).toEqual(['1', '2'])
    expect(labels(text('(1) A thing.\n(2) Another.').problems)).toEqual(['1', '2'])
  })

  it('detects "1 Capital" only for unbroken runs', () => {
    expect(labels(text('1 Prove it.\n2 Show it.\n3 Compute it.').problems)).toEqual(['1', '2', '3'])
    expect(text('2026 Final Exam\n12 Angry Men').quality.status).toBe('no_problems_found')
  })

  it('ignores indented nested lists', () => {
    const r = text('1. First problem.\n   1. sub item\n   2. sub item\n2. Second problem.')
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.problems[0]?.statementMarkdown).toContain('sub item')
  })

  it('warns on gaps in numbering', () => {
    const r = text('1. One.\n2. Two.\n4. Four.')
    expect(labels(r.problems)).toEqual(['1', '2', '4'])
    expect(r.problems[2]?.warnings).toContain('Label sequence jumps from 2 to 4')
    expect(r.quality.status).toBe('needs_review')
  })

  it('prefers the numbered list over keyword lines nested inside it', () => {
    const r = text('1. First.\n2. Second.\n3. Pick one:\nOption 1: Python.\nOption 2: Rust.\n4. Fourth.\n5. Fifth.')
    expect(r.quality.detectedScheme).toBe('numbered-list')
    expect(labels(r.problems)).toEqual(['1', '2', '3', '4', '5'])
    expect(r.problems[2]?.statementMarkdown).toContain('Option 2: Rust.')
  })

  it('prefers numbered problems over "## Part A" section headings in Markdown', () => {
    const r = parseDocument({ kind: 'markdown', text: '## Part A\n1. One.\n2. Two.\n## Part B\n3. Three.' })
    expect(r.quality.detectedScheme).toBe('numbered-list')
    expect(labels(r.problems)).toEqual(['1', '2', '3'])
  })

  it('does not treat dates or years as problems', () => {
    const r = text('Due 10. October\nSome notes about 2026.\n17. is a number')
    expect(r.quality.detectedScheme).toBeNull()
  })
})

describe('parseDocument — ambiguous numbering', () => {
  it('warns on a gap 1, 2, 4', () => {
    const r = text('Problem 1. A.\nProblem 2. B.\nProblem 4. D.')
    expect(r.problems[2]?.warnings).toContain('Label sequence jumps from 2 to 4')
    expect(r.problems[2]?.confidence).toBe('medium')
    expect(r.warnings.some((w) => /numbering/i.test(w))).toBe(true)
    expect(r.quality.status).toBe('needs_review')
  })

  it('warns on duplicate numbers', () => {
    const r = text('Problem 1. A.\nProblem 2. B.\nProblem 2. C.\nProblem 3. D.')
    expect(labels(r.problems)).toEqual(['1', '2', '2', '3'])
    expect(r.problems[2]?.warnings).toContain('Duplicate label 2')
  })

  it('returns a single low-confidence problem when there is no structure', () => {
    const body = 'Write an essay about your summer.\nIt should be at least 500 words.'
    const r = text(body)
    expect(r.quality.status).toBe('no_problems_found')
    expect(r.quality.detectedScheme).toBeNull()
    expect(r.problems).toHaveLength(1)
    expect(r.problems[0]?.label).toBe('1')
    expect(r.problems[0]?.confidence).toBe('low')
    expect(r.problems[0]?.statementMarkdown).toBe(body)
    expect(r.warnings.some((w) => /split it into problems manually/.test(w))).toBe(true)
  })

  it('returns [] and status empty for empty text', () => {
    const r = text('   \n\n  ')
    expect(r.problems).toEqual([])
    expect(r.quality.status).toBe('empty')
    expect(r.quality.charCount).toBe(0)
  })
})

describe('parseDocument — Markdown', () => {
  it('detects ## Problem N headings with titles', () => {
    const r = parseDocument({
      kind: 'markdown',
      text: '# Homework 2\n\nInstructions here.\n\n## Problem 1: Limits\n\nCompute $\\lim_{x\\to 0} x$.\n\n## Problem 2\n\nProve **this**.\n\n- (a) part one\n- (b) part two\n',
    })
    expect(r.quality.detectedScheme).toBe('markdown-headings')
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.problems[0]?.title).toBe('Limits')
    expect(r.problems[0]?.statementMarkdown).toBe('Compute $\\lim_{x\\to 0} x$.')
    expect(r.problems[1]?.statementMarkdown).toBe('Prove **this**.')
    expect(labels(r.problems[1]!.children)).toEqual(['a', 'b'])
    expect(r.preamble).toBe('# Homework 2\n\nInstructions here.')
    expect(r.guessedTitle).toBe('Homework 2')
  })

  it('detects ### 1. headings and **1.** bold numbers', () => {
    expect(labels(parseDocument({ kind: 'markdown', text: '### 1. First\nBody.\n### 2. Second\nBody.' }).problems)).toEqual(['1', '2'])
    const bold = parseDocument({ kind: 'markdown', text: '**1.** First.\n\n**2.** Second.' })
    expect(labels(bold.problems)).toEqual(['1', '2'])
    expect(bold.problems[0]?.statementMarkdown).toBe('First.')
  })

  it('ignores headings inside code fences', () => {
    const r = parseDocument({ kind: 'markdown', text: '## Problem 1\nCode:\n```\n## Problem 2\n```\n## Problem 2\nReal.' })
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.problems[0]?.statementMarkdown).toContain('## Problem 2')
  })

  it('converts \\( \\) delimiters to dollars', () => {
    const r = parseDocument({ kind: 'markdown', text: '## Problem 1\nLet \\(x^2\\) be given and \\[y = 1\\]' })
    expect(r.problems[0]?.statementMarkdown).toBe('Let $x^2$ be given and\n$$\ny = 1\n$$')
  })
})

describe('parseDocument — dollar escaping', () => {
  it('escapes currency in plain text without TeX math', () => {
    const r = text('Problem 1. A pen costs $5 and a book costs $10.')
    expect(r.problems[0]?.statementMarkdown).toBe('A pen costs \\$5 and a book costs \\$10.')
  })

  it('keeps TeX math in text files that use it', () => {
    const r = text('Problem 1. Show $x^2 \\ge 0$.')
    expect(r.problems[0]?.statementMarkdown).toBe('Show $x^2 \\ge 0$.')
  })
})

describe('parseDocument — docx text', () => {
  it('parses paragraphs separated by blank lines', () => {
    const r = parseDocument({ kind: 'docx', text: 'Lab 3\n\nQuestion 1. Measure it.\n\nQuestion 2. Report it.\n\n' })
    expect(labels(r.problems)).toEqual(['1', '2'])
    expect(r.guessedTitle).toBe('Lab 3')
    expect(r.problems[0]?.pageStart).toBeNull()
  })
})
