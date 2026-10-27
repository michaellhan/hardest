import { describe, expect, it } from 'vitest'
import { parseDocument } from '../index'

const tex = (t: string) => parseDocument({ kind: 'tex', text: t })

const PSET = String.raw`\documentclass[11pt]{article}
\usepackage{amsmath,amssymb}
\newcommand{\R}{\mathbb{R}}
\newtheorem{problem}{Problem}
\title{Math 55 Problem Set 4}
\date{Due: Thursday, September 17, 2026}
\begin{document}
\maketitle
Collaboration is allowed; cite your sources. % private note: grading rubric
\begin{problem}[Sylow theorems]
Let $G$ be a group of order $p^2 q$ where $p \neq q$ are primes.
\begin{enumerate}[(a)]
  \item Show that $n_p \mid q$ and $n_p \equiv 1 \pmod p$.
  \item Deduce that $G$ is not simple.
\end{enumerate}
\end{problem}
\begin{solution}Secret solution text.\end{solution}
\begin{problem}
Prove that for all $x \in \R$,
\begin{align}
  f(x) &= \sum_{k=0}^{\infty} \frac{x^k}{k!} \label{eq:exp} \\
  g(x) &= e^{x}
\end{align}
\end{problem}
\begin{exercise}
Compute $\int_0^1 x^2\,dx$.
\end{exercise}
\end{document}
`

describe('parseDocument — LaTeX problem environments', () => {
  const r = tex(PSET)

  it('detects problem/exercise environments with titles', () => {
    expect(r.quality.detectedScheme).toBe('latex-problem-env')
    expect(r.problems.map((p) => p.label)).toEqual(['1', '2', '3'])
    expect(r.problems[0]?.title).toBe('Sylow theorems')
    expect(r.problems[1]?.title).toBeNull()
  })

  it('turns an enumerate inside a problem into children', () => {
    const p1 = r.problems[0]!
    expect(p1.statementMarkdown).toBe('Let $G$ be a group of order $p^2 q$ where $p \\neq q$ are primes.')
    expect(p1.children.map((c) => c.label)).toEqual(['a', 'b'])
    expect(p1.children[0]?.statementMarkdown).toBe('Show that $n_p \\mid q$ and $n_p \\equiv 1 \\pmod p$.')
  })

  it('preserves inline math byte-for-byte', () => {
    expect(r.problems[2]?.statementMarkdown).toBe('Compute $\\int_0^1 x^2\\,dx$.')
  })

  it('converts align to aligned and strips labels', () => {
    const s = r.problems[1]!.statementMarkdown
    expect(s).toContain('$$\n\\begin{aligned}')
    expect(s).toContain('f(x) &= \\sum_{k=0}^{\\infty} \\frac{x^k}{k!}  \\\\')
    expect(s).toContain('\\end{aligned}\n$$')
    expect(s).not.toContain('\\label')
    expect(s).toContain('$x \\in \\R$')
  })

  it('strips the preamble, comments, macros and solutions', () => {
    const all = JSON.stringify(r)
    expect(all).not.toContain('documentclass')
    expect(all).not.toContain('usepackage')
    expect(all).not.toContain('private note')
    expect(all).not.toContain('Secret solution')
    expect(all).not.toContain('newcommand')
    expect(r.preamble).toBe('Collaboration is allowed; cite your sources.')
    expect(r.warnings).toContain('Removed 1 solution block from the LaTeX source.')
  })

  it('guesses metadata from \\title and \\date', () => {
    expect(r.guessedTitle).toBe('Problem Set 4')
    expect(r.guessedNumber).toBe(4)
    expect(r.guessedDueDate).toBe('2026-09-17')
  })

  it('reads explicit labels from the environment option', () => {
    const r2 = tex('\\begin{problem}[3]\nA.\n\\end{problem}\n\\begin{problem}[Problem 4: Rings]\nB.\n\\end{problem}')
    expect(r2.problems.map((p) => [p.label, p.title])).toEqual([
      ['3', null],
      ['4', 'Rings'],
    ])
  })
})

describe('parseDocument — LaTeX enumerate psets', () => {
  it('uses a top-level enumerate as problems and nested enumerates as children', () => {
    const r = tex(String.raw`\begin{document}
Answer all questions.
\begin{enumerate}
\item Prove that $\sqrt{2}$ is irrational.
\item Let $x \in \mathbb{R}$.
  \begin{enumerate}
  \item Show $x^2 \ge 0$.
  \item Show $|x| \ge 0$.
  \end{enumerate}
\item Compute $1+1$.
\end{enumerate}
\end{document}`)
    expect(r.quality.detectedScheme).toBe('latex-enumerate')
    expect(r.problems.map((p) => p.label)).toEqual(['1', '2', '3'])
    expect(r.problems[1]?.statementMarkdown).toBe('Let $x \\in \\mathbb{R}$.')
    expect(r.problems[1]?.children.map((c) => [c.label, c.statementMarkdown])).toEqual([
      ['a', 'Show $x^2 \\ge 0$.'],
      ['b', 'Show $|x| \\ge 0$.'],
    ])
    expect(r.preamble).toBe('Answer all questions.')
    expect(r.quality.status).toBe('ok')
  })
})

describe('parseDocument — LaTeX exam class', () => {
  it('handles \\question / \\part / \\subpart', () => {
    const r = tex(String.raw`\documentclass{exam}
\begin{document}
\begin{questions}
\question[10] Prove that $\sqrt 2$ is irrational.
\question Consider $f(x) = x^3$.
\begin{parts}
\part[2] Find $f'(x)$.
\part Find $f''(x)$.
  \begin{subparts}
  \subpart Evaluate at $0$.
  \subpart Evaluate at $1$.
  \end{subparts}
\end{parts}
\titledquestion{Bonus}[5] Anything.
\end{questions}
\end{document}`)
    expect(r.quality.detectedScheme).toBe('latex-exam')
    expect(r.problems.map((p) => p.label)).toEqual(['1', '2', '3'])
    expect(r.problems[0]?.statementMarkdown).toBe('Prove that $\\sqrt 2$ is irrational.')
    const q2 = r.problems[1]!
    expect(q2.statementMarkdown).toBe('Consider $f(x) = x^3$.')
    expect(q2.children.map((c) => c.label)).toEqual(['a', 'b'])
    expect(q2.children[0]?.statementMarkdown).toBe("Find $f'(x)$.")
    expect(q2.children[1]?.statementMarkdown).toBe("Find $f''(x)$.\n\n- i. Evaluate at $0$.\n- ii. Evaluate at $1$.")
    expect(r.problems[2]?.title).toBe('Bonus')
  })
})

describe('parseDocument — LaTeX headings', () => {
  it('uses \\section*{Problem n} headings with subsection parts', () => {
    const r = tex(String.raw`\section*{Problem 1: Groups}
Let $G$ be a group.
\section*{Problem 2}
\subsection*{(a)} Show this.
\subsection*{(b)} Show that.`)
    expect(r.quality.detectedScheme).toBe('latex-sections')
    expect(r.problems.map((p) => [p.label, p.title])).toEqual([
      ['1', 'Groups'],
      ['2', null],
    ])
    expect(r.problems[1]?.children.map((c) => [c.label, c.statementMarkdown])).toEqual([
      ['a', 'Show this.'],
      ['b', 'Show that.'],
    ])
  })

  it('uses \\textbf{Problem n.} headings', () => {
    const r = tex(String.raw`\noindent\textbf{Problem 1.} Show $a=a$.

\medskip\textbf{Problem 2} (Hard). Show $b=b$.

{\bf Problem 3.} Show $c = c$.`)
    expect(r.quality.detectedScheme).toBe('problem-n')
    expect(r.problems.map((p) => [p.label, p.title, p.statementMarkdown])).toEqual([
      ['1', null, 'Show $a=a$.'],
      ['2', 'Hard', 'Show $b=b$.'],
      ['3', null, 'Show $c = c$.'],
    ])
  })

  it('uses \\problem macros', () => {
    const r = tex('\\problem{1} Show A.\n\\problem{2} Show B.')
    expect(r.quality.detectedScheme).toBe('latex-problem-macro')
    expect(r.problems.map((p) => [p.label, p.statementMarkdown])).toEqual([
      ['1', 'Show A.'],
      ['2', 'Show B.'],
    ])
  })

  it('falls back to generic numbered sections', () => {
    const r = tex('\\section{Limits}\nCompute it.\n\\section{Derivatives}\nDifferentiate it.')
    expect(r.problems.map((p) => [p.label, p.title, p.statementMarkdown])).toEqual([
      ['1', 'Limits', 'Compute it.'],
      ['2', 'Derivatives', 'Differentiate it.'],
    ])
    expect(r.problems[0]?.confidence).toBe('medium')
  })

  it('falls back to text detection for plain "Problem n." lines', () => {
    const r = tex('Problem 1. Show $x$.\n\nProblem 2. Show $y$.')
    expect(r.problems.map((p) => p.statementMarkdown)).toEqual(['Show $x$.', 'Show $y$.'])
  })

  it('returns one low-confidence problem when there is no structure', () => {
    const r = tex('Just some text with $x$ math.')
    expect(r.quality.status).toBe('no_problems_found')
    expect(r.problems[0]?.statementMarkdown).toBe('Just some text with $x$ math.')
  })
})

describe('parseDocument — malformed LaTeX', () => {
  it('does not throw on unclosed environments, braces and math', () => {
    const inputs = [
      '\\begin{problem} Unclosed {brace and $x^2 and \\begin{itemize} \\item no end',
      '\\begin{document}\\section*{Problem 1}}}} \\end{enumerate} $$ x',
      '\\textbf{',
      '\\',
      '{'.repeat(5000) + 'deep',
      '\\begin{enumerate}\\item \\begin{enumerate}\\item a',
      '\\href{x}',
    ]
    for (const input of inputs) {
      expect(() => tex(input)).not.toThrow()
    }
    const r = tex(inputs[0]!)
    expect(r.problems).toHaveLength(1)
    expect(r.warnings.some((w) => /malformed/.test(w))).toBe(true)
    expect(r.problems[0]?.statementMarkdown).toContain('Unclosed')
  })
})
