import { describe, expect, it } from 'vitest'
import { fontRole, hasMathFonts, runsToMarkdown, type GlyphRun } from '@/lib/pdfMath'
import { parseDocument } from '@/lib/parser'

/**
 * Glyph runs as pdf.js reports them, one per line: "str" FONT a,b,c,d,x,y width.
 * The fixtures below are copied from real TeX-produced problem sets.
 */
function runs(dump: string): GlyphRun[] {
  return dump
    .trim()
    .split('\n')
    .map((line) => {
      const m = /^\s*"(.*)" (\S+) ([\d.,-]+) ([\d.]+)$/.exec(line)
      if (!m) throw new Error(`bad fixture line: ${line}`)
      const [, , c, d, x, y] = m[3].split(',').map(Number)
      return { str: JSON.parse(`"${m[1]}"`) as string, font: m[2], x, y, width: Number(m[4]), size: Math.hypot(c, d) }
    })
}

const md = (dump: string) => runsToMarkdown(runs(dump))

describe('fontRole', () => {
  it('reads TeX font names', () => {
    expect(fontRole('MCSREA+CMMI10')).toBe('math')
    expect(fontRole('ABCDEF+CMSY8')).toBe('symbol')
    expect(fontRole('ABCDEF+CMEX10')).toBe('ex')
    expect(fontRole('ABCDEF+MSBM10')).toBe('bb')
    expect(fontRole('ABCDEF+CMR10')).toBe('text')
    expect(fontRole('ABCDEF+CMBX12')).toBe('bold')
    expect(fontRole('ABCDEF+CMTI10')).toBe('italic')
    expect(fontRole('ZFQOCN+LINE10')).toBe('arrow')
    expect(fontRole('')).toBe('text')
  })

  it('hasMathFonts is false for text-only documents', () => {
    expect(hasMathFonts(runs(`"Problem 1." ABCDEF+TimesNewRoman 12,0,0,12,72,700 60`))).toBe(false)
    expect(hasMathFonts(runs(`"x" ABCDEF+CMMI10 10.9,0,0,10.9,72,700 6`))).toBe(true)
  })
})

describe('runsToMarkdown', () => {
  it('wraps math-font glyphs in $…$ and maps blackboard bold and scripts', () => {
    expect(
      md(`
        "(c) What’s the story if" ABCDEF+CMR10 10.9,0,0,10.9,99.3,600 110
        "k" GHIJKL+CMMI10 10.9,0,0,10.9,213.2,600 5.7
        "=" ABCDEF+CMR10 10.9,0,0,10.9,222,600 8.5
        "F" MNOPQR+MSBM10 10.9,0,0,10.9,233.6,600 7.3
        "2" STUVWX+CMR8 8,0,0,8,240.9,598.4 4.2
        "?" ABCDEF+CMR10 10.9,0,0,10.9,245.6,600 5.2
      `),
    ).toBe('(c) What’s the story if $k = \\mathbb{F}_2$?')
  })

  it('keeps a script on a script together (c_{a^{-1}}) and joins ≠', () => {
    expect(
      md(`
        "c" AAAAAF+CMMI12 12,0,0,12,193.4,263.2 5
        "a" AAAAAI+CMMI8 8,0,0,8,198.5,261.2 4.5
        "−" AAAAAV+CMSY6 6,0,0,6,203,263.5 5.8
        "1" AAAAAW+CMR6 6,0,0,6,208.7,263.5 3.7
      `),
    ).toBe('$c_{a^{-1}}$')
    expect(
      md(`
        "a" GHIJKL+CMMI10 10.9,0,0,10.9,100,500 5.8
        "̸" QRQIHN+CMSY10 10.9,0,0,10.9,111,500 0
        "=" ABCDEF+CMR10 10.9,0,0,10.9,111,500 8.5
        "e" GHIJKL+CMMI10 10.9,0,0,10.9,122.6,500 5.1
      `),
    ).toBe('$a \\neq e$')
  })

  it('rebuilds a displayed fraction with big-operator limits', () => {
    const out = md(`
      "the distinct eigenvalues of a diagonalizable operator. Consider the linear operator" SLKQRM+CMR10 10.9,0,0,10.9,99.3,252 400
      "π" AITRCK+CMMI10 10.9,0,0,10.9,244.2,226.1 6.2
      "i" YXMPGT+CMMI8 8,0,0,8,250.4,224.5 2.9
      "=" SLKQRM+CMR10 10.9,0,0,10.9,256.8,226.1 8.5
      "1" SLKQRM+CMR10 10.9,0,0,10.9,300.1,233.5 5.5
      "Q" MDMUPD+CMEX10 10.9,0,0,10.9,269.6,226.8 10.3
      "j" YXMPGT+CMMI8 8,0,0,8,279.9,215.4 3.4
      "̸" QRQIHN+CMSY8 8,0,0,8,283.7,215.4 0
      "=" ABQBBP+CMR8 8,0,0,8,283.7,215.4 6.6
      "i" YXMPGT+CMMI8 8,0,0,8,290.3,215.4 2.9
      "(" SLKQRM+CMR10 10.9,0,0,10.9,293.7,218.7 4.2
      "λ" AITRCK+CMMI10 10.9,0,0,10.9,297.9,218.7 6.4
      "i" YXMPGT+CMMI8 8,0,0,8,304.3,217 2.9
      "−" YWAVOU+CMSY10 10.9,0,0,10.9,310.1,218.7 8.5
      "λ" AITRCK+CMMI10 10.9,0,0,10.9,321,218.7 6.4
      "j" YXMPGT+CMMI8 8,0,0,8,327.4,217 3.4
      ")" SLKQRM+CMR10 10.9,0,0,10.9,331.8,218.7 4.2
      "Y" MDMUPD+CMEX10 10.9,0,0,10.9,339,236.5 13.9
      "j" YXMPGT+CMMI8 8,0,0,8,339.3,212.8 3.4
      "̸" QRQIHN+CMSY8 8,0,0,8,343.2,212.8 0
      "=" ABQBBP+CMR8 8,0,0,8,343.2,212.8 6.6
      "i" YXMPGT+CMMI8 8,0,0,8,349.8,212.8 2.9
      "(" SLKQRM+CMR10 10.9,0,0,10.9,353,226.1 4.2
      "ϕ" AITRCK+CMMI10 10.9,0,0,10.9,357.2,226.1 6.5
      "−" YWAVOU+CMSY10 10.9,0,0,10.9,366.1,226.1 8.5
      "λ" AITRCK+CMMI10 10.9,0,0,10.9,377,226.1 6.4
      "j" YXMPGT+CMMI8 8,0,0,8,383.4,224.5 3.4
      ")" SLKQRM+CMR10 10.9,0,0,10.9,387.8,226.1 4.2
      "." AITRCK+CMMI10 10.9,0,0,10.9,392,226.1 3
      "What is the kernel of" SLKQRM+CMR10 10.9,0,0,10.9,99.3,193.2 101.3
    `)
    expect(out).toBe(
      [
        'the distinct eigenvalues of a diagonalizable operator. Consider the linear operator',
        '',
        '$$',
        '\\pi_i = \\frac{1}{\\prod_{j\\neq i}(\\lambda_i - \\lambda_j)} \\prod_{j\\neq i}(\\phi - \\lambda_j).',
        '$$',
        '',
        'What is the kernel of',
      ].join('\n'),
    )
  })

  it('puts limits above and below a displayed sum on the sum', () => {
    const out = md(`
      "such that" ASDNGA+CMR10 10.9,0,0,10.9,99.3,682.6 44.6
      "∞" BECFBN+CMSY8 8,0,0,8,287.2,677.1 8.5
      "X" WTODRA+CMEX10 10.9,0,0,10.9,283.6,673.8 15.8
      "i" PGKEHK+CMMI8 8,0,0,8,284.6,650.4 2.9
      "=0" RUYZIE+CMR8 8,0,0,8,287.5,650.4 10.8
      "|" IOPESM+CMSY10 10.9,0,0,10.9,301.2,663.5 3
      "a" ZZQCRF+CMMI10 10.9,0,0,10.9,304.2,663.5 5.8
      "i" PGKEHK+CMMI8 8,0,0,8,310,661.8 2.9
      "|" IOPESM+CMSY10 10.9,0,0,10.9,313.3,663.5 3
      "p" PGKEHK+CMMI8 8,0,0,8,316.4,668 4.3
      "<" ZZQCRF+CMMI10 10.9,0,0,10.9,327.2,663.5 8.5
      "∞" IOPESM+CMSY10 10.9,0,0,10.9,341.7,663.5 10.9
      "." ZZQCRF+CMMI10 10.9,0,0,10.9,352.7,663.5 3
    `)
    expect(out).toBe('such that\n\n$$\n\\sum_{i=0}^{\\infty}|a_i|^p < \\infty.\n$$')
  })

  it('handles inline integral limits and inline fractions', () => {
    expect(
      md(`
        "(c)" ASDNGA+CMR10 10.9,0,0,10.9,99.3,451.1 14
        "W" ZZQCRF+CMMI10 10.9,0,0,10.9,123.3,451.1 10.3
        "3" RUYZIE+CMR8 8,0,0,8,133.6,449.5 4.2
        "=" ASDNGA+CMR10 10.9,0,0,10.9,141.3,451.1 8.5
        "R" WTODRA+CMEX10 10.9,0,0,10.9,196,459.9 5.2
        "1" RUYZIE+CMR8 8,0,0,8,203.3,456.7 4.2
        "0" RUYZIE+CMR8 8,0,0,8,201.2,447.3 4.2
        "f dx" ZZQCRF+CMMI10 10.9,0,0,10.9,209.9,451.1 18.4
      `),
    ).toBe('(c) $W_3 = \\int_0^1 f dx$')
    expect(
      md(`
        "let" FUGLFJ+CMR10 10.9,0,0,10.9,128.7,495.2 12.1
        "f" RACMAX+CMMI10 10.9,0,0,10.9,144.4,495.2 5.3
        "(" FUGLFJ+CMR10 10.9,0,0,10.9,151,495.2 4.2
        "w" RACMAX+CMMI10 10.9,0,0,10.9,155.2,495.2 7.8
        ") =" FUGLFJ+CMR10 10.9,0,0,10.9,163.3,495.2 15.8
        "1" CGCFOU+CMR8 8,0,0,8,190.6,499.5 4.2
        "∥" FXUQAN+CMSY8 8,0,0,8,183.3,491.2 4.2
        "w" PFOSXC+CMMI8 8,0,0,8,187.5,491.2 6.1
        "∥" FXUQAN+CMSY8 8,0,0,8,193.8,491.2 4.2
        "2" PJZRLC+CMR6 6,0,0,6,198,493.5 3.7
        "⟨" IOZEFD+CMSY10 10.9,0,0,10.9,203.4,495.2 4.2
        "T w, w" RACMAX+CMMI10 10.9,0,0,10.9,207.6,495.2 28.6
        "⟩" IOZEFD+CMSY10 10.9,0,0,10.9,236.6,495.2 4.2
      `),
    ).toBe('let $f(w) = \\frac{1}{\\|w\\|^2}\\langle T w, w\\rangle$')
  })

  it('turns labelled picture-mode arrows into \\xrightarrow', () => {
    const out = md(`
      "0" ASDNGA+CMR10 10.9,0,0,10.9,188.1,562.5 5.5
      "-" ZFQOCN+LINE10 10,0,0,10,209.3,565.3 10
      "V" ZZQCRF+CMMI10 10.9,0,0,10.9,223.4,562.5 6.4
      "1" RUYZIE+CMR8 8,0,0,8,229.7,560.9 4.2
      "ϕ" PGKEHK+CMMI8 8,0,0,8,244.8,569.5 5
      "1" XTJZVU+CMR6 6,0,0,6,249.8,568.4 3.7
      "-" ZFQOCN+LINE10 10,0,0,10,250.2,565.3 10
      "V" ZZQCRF+CMMI10 10.9,0,0,10.9,264.3,562.5 6.4
      "2" RUYZIE+CMR8 8,0,0,8,270.6,560.9 4.2
    `)
    expect(out).toContain('0 \\to V_1 \\xrightarrow{\\phi_1} V_2')
  })

  it('keeps footnote marks and sentence punctuation in the text', () => {
    expect(
      md(`
        "week." MNVPMX+CMR10 10.9,0,0,10.9,72,510.3 26.1
        "1" WTQQTU+CMR8 8,0,0,8,102.9,514.2 4.2
      `),
    ).toBe('week.¹')
    expect(
      md(`
        "(as functions of the input length" MNVPMX+CMR10 10.9,0,0,10.9,72,564.5 152.4
        "n" GXZSKC+CMMI10 10.9,0,0,10.9,227.6,564.5 6.5
        "): (a)" MNVPMX+CMR10 10.9,0,0,10.9,234.1,564.5 25.8
        "n" GXZSKC+CMMI10 10.9,0,0,10.9,263.1,564.5 6.5
        "operations, (b)" MNVPMX+CMR10 10.9,0,0,10.9,272.8,564.5 70.3
      `),
    ).toBe('(as functions of the input length $n$): (a) $n$ operations, (b)')
  })

  it('escapes dollar signs in text', () => {
    expect(md(`"It costs $5 per" ABCDEF+CMR10 10.9,0,0,10.9,72,500 70\n"x" GHIJKL+CMMI10 10.9,0,0,10.9,145,500 6`)).toBe('It costs \\$5 per $x$')
  })
})

describe('parseDocument with rebuilt PDF math', () => {
  const page = '1. Show that $x^2 \\ge 0$ for all $x \\in \\mathbb{R}$.\n\n2. Compute\n\n$$\n\\sum_{i=1}^n i\n$$\n'
  it('keeps $…$ when the extractor produced LaTeX', () => {
    const res = parseDocument({ kind: 'pdf', pages: [page], texMath: true })
    expect(res.problems.map((p) => p.label)).toEqual(['1', '2'])
    expect(res.problems[0].statementMarkdown).toBe('Show that $x^2 \\ge 0$ for all $x \\in \\mathbb{R}$.')
    expect(res.problems[1].statementMarkdown).toContain('$$\n\\sum_{i=1}^n i\n$$')
  })
  it('still escapes $ in plain PDF text', () => {
    const res = parseDocument({ kind: 'pdf', pages: ['1. It costs $5 and $6.\n2. Next.'] })
    expect(res.problems[0].statementMarkdown).toBe('It costs \\$5 and \\$6.')
  })
})
