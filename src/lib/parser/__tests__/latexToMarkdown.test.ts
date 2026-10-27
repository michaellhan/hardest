import { describe, expect, it } from 'vitest'
import { latexToMarkdown } from '../index'

describe('latexToMarkdown — math', () => {
  it('keeps $…$ verbatim and converts \\( \\)', () => {
    expect(latexToMarkdown('Let $x^2 + \\frac{a}{b}$ and \\(y_1\\).')).toBe('Let $x^2 + \\frac{a}{b}$ and $y_1$.')
  })

  it('converts \\[ \\] and keeps $$ $$ as display blocks', () => {
    expect(latexToMarkdown('A \\[ x = 1 \\] B')).toBe('A\n\n$$\nx = 1\n$$\n\nB')
    expect(latexToMarkdown('$$\\sum_i a_i$$')).toBe('$$\n\\sum_i a_i\n$$')
  })

  it('converts equation environments and strips labels', () => {
    expect(latexToMarkdown('\\begin{equation}\\label{eq:1} E = mc^2 \\end{equation}')).toBe('$$\nE = mc^2\n$$')
    expect(latexToMarkdown('\\begin{equation*} a \\nonumber \\end{equation*}')).toBe('$$\na\n$$')
  })

  it('wraps align-family environments in aligned / gathered', () => {
    expect(latexToMarkdown('\\begin{align*}\na &= b \\\\\nc &= d\n\\end{align*}')).toBe(
      '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$',
    )
    expect(latexToMarkdown('\\begin{gather*} a \\\\ b \\end{gather*}')).toBe('$$\n\\begin{gathered}\na \\\\ b\n\\end{gathered}\n$$')
    expect(latexToMarkdown('\\begin{multline*} a \\end{multline*}')).toContain('\\begin{gathered}')
    expect(latexToMarkdown('\\begin{alignat}{2} a &= b \\end{alignat}')).toContain('\\begin{alignedat}{2}')
  })

  it('leaves unknown commands inside math intact', () => {
    expect(latexToMarkdown('$\\R \\mycmd{x}$')).toBe('$\\R \\mycmd{x}$')
  })

  it('keeps escaped dollars as escaped', () => {
    expect(latexToMarkdown('It costs \\$5.')).toBe('It costs \\$5.')
  })
})

describe('latexToMarkdown — text formatting', () => {
  it('converts emphasis and code', () => {
    expect(latexToMarkdown('\\textbf{bold} \\textit{it} \\emph{em} \\texttt{a\\_b} \\underline{u}')).toBe(
      '**bold** *it* *em* `a_b` u',
    )
    expect(latexToMarkdown('{\\bf old bold} and {\\em old em}')).toBe('**old bold** and *old em*')
  })

  it('converts links without producing HTML', () => {
    expect(latexToMarkdown('\\url{https://x.org/a_b} and \\href{https://y.org}{the site}')).toBe(
      'https://x.org/a_b and the site (https://y.org)',
    )
  })

  it('handles quotes, dashes, ties, line breaks and spacing commands', () => {
    expect(latexToMarkdown("``quoted'' 1--2 a---b x~y one\\\\two a\\,b")).toBe('“quoted” 1–2 a—b x y one\ntwo ab')
  })

  it('removes layout commands and replaces figures', () => {
    expect(
      latexToMarkdown('\\noindent Text\\vspace{1em}\\hspace*{2cm} more\\medskip\\newpage\\label{x} \\includegraphics[width=2in]{f.png}'),
    ).toBe('Text more [figure omitted]')
  })

  it('keeps the argument text of unknown text-mode commands', () => {
    expect(latexToMarkdown('\\mystyle{important} words')).toBe('important words')
  })

  it('converts accents and escapes', () => {
    expect(latexToMarkdown("Erd\\H{o}s and G\\\"odel and caf\\'e 50\\% \\& \\#1")).toBe('Erdős and Gödel and café 50% & \\#1')
  })

  it('strips comments but not escaped percent signs', () => {
    expect(latexToMarkdown('a 10\\% rate % hidden\nnext')).toBe('a 10% rate next')
    expect(latexToMarkdown('% whole line\nkept')).toBe('kept')
  })
})

describe('latexToMarkdown — lists and blocks', () => {
  it('converts itemize and enumerate, with nesting', () => {
    expect(latexToMarkdown('\\begin{itemize}\n\\item One\n\\item Two\n\\end{itemize}')).toBe('- One\n- Two')
    expect(latexToMarkdown('\\begin{enumerate}\n\\item One\n\\item Two\n\\end{enumerate}')).toBe('1. One\n2. Two')
    expect(
      latexToMarkdown('\\begin{enumerate}\n\\item One\n\\begin{enumerate}\n\\item Inner\n\\item Inner2\n\\end{enumerate}\n\\item Two\n\\end{enumerate}'),
    ).toBe('1. One\n\n   - (a) Inner\n   - (b) Inner2\n2. Two')
  })

  it('honors enumerate label options', () => {
    expect(latexToMarkdown('\\begin{enumerate}[(i)]\\item A\\item B\\end{enumerate}')).toBe('- (i) A\n- (ii) B')
    expect(latexToMarkdown('\\begin{enumerate}[label=\\alph*)]\\item A\\item B\\end{enumerate}')).toBe('- a) A\n- b) B')
    expect(latexToMarkdown('\\begin{description}\\item[Term] Def\\end{description}')).toBe('- **Term** Def')
  })

  it('converts verbatim, lstlisting and minted to fenced code', () => {
    expect(latexToMarkdown('\\begin{verbatim}\nx = 1 % not a comment\n  y\n\\end{verbatim}')).toBe(
      '```\nx = 1 % not a comment\n  y\n```',
    )
    expect(latexToMarkdown('\\begin{lstlisting}[language=Python]\nprint(1)\n\\end{lstlisting}')).toBe('```python\nprint(1)\n```')
    expect(latexToMarkdown('\\begin{minted}{rust}\nfn main() {}\n\\end{minted}')).toBe('```rust\nfn main() {}\n```')
    expect(latexToMarkdown('Use \\verb|a_b| here')).toBe('Use `a_b` here')
  })

  it('keeps content of unknown environments', () => {
    expect(latexToMarkdown('\\begin{center}\nCentered\n\\end{center}')).toBe('Centered')
    expect(latexToMarkdown('\\begin{myenv}Inside\\end{myenv}')).toBe('Inside')
  })

  it('renders theorem-like environments and proofs', () => {
    expect(latexToMarkdown('\\begin{lemma}[Key]Statement.\\end{lemma}')).toBe('**Lemma (Key).** Statement.')
    expect(latexToMarkdown('\\begin{proof}Easy.\\end{proof}')).toBe('*Proof.* Easy.')
  })

  it('does not throw on malformed input', () => {
    for (const s of ['\\begin{itemize}\\item a', '{{{', '}}}', '$x', '\\textbf{x', '\\begin{', '\\verb|x', '\\[ x']) {
      expect(() => latexToMarkdown(s)).not.toThrow()
    }
    expect(latexToMarkdown('\\begin{itemize}\\item a')).toBe('- a')
    expect(latexToMarkdown('$x')).toBe('\\$x')
  })
})
