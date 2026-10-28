import { describe, expect, it } from 'vitest'
import { nameProblems, parseDocument, suggestTitle } from '../index'

describe('suggestTitle', () => {
  it.each([
    ['Let G be a group of order $p^2$, where $p$ is prime. Prove that G is abelian.', 'G is abelian'],
    ['Find all integers $n$ such that $n^2 + 1$ divides $n^3 + 1$.', 'Find all integers $n$'],
    ['Prove that if $f$ is continuous on $[a,b]$, then $f$ is uniformly continuous.', '$f$ is uniformly continuous'],
    ['Use the Cauchy–Schwarz inequality to show that $(a+b)^2 \\le 2(a^2+b^2)$.', 'Cauchy–Schwarz inequality'],
    ["Implement Dijkstra's algorithm and report its running time.", "Dijkstra's algorithm"],
    ['Show that the eigenvalues of a Hermitian matrix are real.', 'The eigenvalues of a Hermitian matrix are real'],
    ['In this problem we study random walks. Compute the expected return time to the origin.', 'Compute the expected return time to the origin'],
    ['**Sylow.** Let G be a group of order 12. Prove that G is not simple.', 'Sylow'],
    ['Cauchy-Schwarz. Show that $|x \\cdot y| \\le |x||y|$.', 'Cauchy-Schwarz'],
    ['Compute the integral\n$$\\int_0^1 x^2\\,dx.$$', 'Compute the integral'],
    ['Show that $8 \\mid n^2 - 1$ for odd $n$.', '$8 \\mid n^2 - 1$ for odd $n$'],
    ['Show that $8 \\mid n^2 - 1$.', 'Show that $8 \\mid n^2 - 1$'],
    ['Let G be a group of order 12.', 'Group of order 12'],
    ['Let $V$ and $W$ be finite-dimensional. Show $\\dim(V \\otimes W) = \\dim V \\cdot \\dim W$.', 'Let $V$ and $W$ be finite-dimensional'],
  ])('%s', (statement, title) => {
    expect(suggestTitle(statement)).toBe(title)
  })

  it('gives up on empty or math-only statements', () => {
    expect(suggestTitle('')).toBeNull()
    expect(suggestTitle('$$x^2 + y^2 = z^2$$')).toBeNull()
  })

  it('caps long sentences without a dangling stopword', () => {
    const t = suggestTitle('Write a short program that reads a list of numbers from standard input and prints the median.')
    expect(t).toBe('Write a short program that reads a list')
  })
})

describe('nameProblems', () => {
  it('names untitled top-level problems and keeps titles from the source', () => {
    const r = parseDocument({
      kind: 'tex',
      text: String.raw`\begin{document}
\begin{problem}[Sylow theorems] Prove that $G$ has a normal subgroup. \end{problem}
\begin{problem} Show that every finite integral domain is a field. \end{problem}
\end{document}`,
    })
    expect(nameProblems(r.problems).map((p) => p.title)).toEqual(['Sylow theorems', 'Every finite integral domain is a field'])
  })

  it('uses the first part when the statement is only setup', () => {
    const r = parseDocument({ kind: 'text', text: 'Problem 1. Suppose $n$ is odd.\n(a) Show that n^2 is odd.\n(b) Deduce that 8 divides n^2 - 1.' })
    const [p] = nameProblems(r.problems)
    expect(p?.title).toBe('n^2 is odd')
    expect(p?.children.map((c) => c.title)).toEqual([null, null])
  })

  it('skips a one-word setup like "be linear" in favour of the first part', () => {
    const r = parseDocument({ kind: 'text', text: 'Problem 1. Let $T : V \\to V$ be linear.\n(a) Show that $T$ has an eigenvalue.\n(b) Deduce more.' })
    expect(nameProblems(r.problems)[0]?.title).toBe('$T$ has an eigenvalue')
  })

  it('leaves problems with nothing to go on untitled', () => {
    const r = parseDocument({ kind: 'text', text: 'Problem 1.\nProblem 2.' })
    expect(nameProblems(r.problems).map((p) => p.title)).toEqual([null, null])
  })
})
