/**
 * LaTeX → Markdown conversion for react-markdown + remark-math + rehype-katex.
 *
 * This is a deliberately small, non-expanding converter: math is copied verbatim (KaTeX
 * renders it), a fixed set of text-mode commands/environments is translated, unknown
 * text-mode commands degrade to their argument text, and malformed input never throws.
 */
import {
  counterLabel,
  enumStyle,
  findEnvEnd,
  matchBrace,
  matchBracket,
  readArg,
  readArgOrToken,
  readCsOrArg,
  readOptional,
  skipArgs,
  splitItems,
  stripLatexComments,
  VERBATIM_ENVS,
  type EnumStyle,
} from './latexScan'

const NUL = '\u0000'
const PLACEHOLDER_RE = new RegExp(`${NUL}(\\d+)${NUL}`, 'g')
const MAX_DEPTH = 120

// ---------------------------------------------------------------------------
// Command tables
// ---------------------------------------------------------------------------

const WRAP: Readonly<Record<string, string>> = { textbf: '**', textit: '*', emph: '*', textsl: '*' }

/** Commands rendered as one of their arguments: spec letters as in skipArgs, 'M' = the rendered argument. */
const PASS: Readonly<Record<string, string>> = {
  underline: 'M', uline: 'M', textrm: 'M', textsf: 'M', textsc: 'M', textup: 'M', textmd: 'M',
  textnormal: 'M', mbox: 'M', text: 'M', hbox: 'M', fbox: 'M', centerline: 'M', textsuperscript: 'M',
  textsubscript: 'M', framebox: 'ooM', makebox: 'ooM', caption: 'oM', parbox: 'omM', colorbox: 'mM',
  textcolor: 'mM', fcolorbox: 'mmM', multicolumn: 'mmM', multirow: 'momM', raisebox: 'mooM',
  resizebox: 'mmM', scalebox: 'moM', rotatebox: 'omM', subcaption: 'M', enquote: 'M',
}

const REPLACE: Readonly<Record<string, string>> = {
  ldots: '…', dots: '…', textellipsis: '…', LaTeX: 'LaTeX', TeX: 'TeX', LaTeXe: 'LaTeX2e',
  S: '§', P: '¶', copyright: '©', textregistered: '®', texttrademark: '™', textbackslash: '\\',
  textasciitilde: '~', textasciicircum: '^', textendash: '–', textemdash: '—', textbullet: '•',
  textdegree: '°', checkmark: '✓', ss: 'ß', o: 'ø', O: 'Ø', ae: 'æ', AE: 'Æ', oe: 'œ', OE: 'Œ',
  aa: 'å', AA: 'Å', l: 'ł', L: 'Ł', i: 'i', j: 'j', quad: ' ', qquad: ' ', enspace: ' ',
  thinspace: '', newline: '\n', linebreak: '\n', par: '\n\n', textquoteleft: '‘',
  textquoteright: '’', textquotedblleft: '“', textquotedblright: '”', dag: '†', ddag: '‡',
  pounds: '£', euro: '€', textunderscore: '\\_', qed: '∎', textbar: '|', textless: '<', textgreater: '>',
}

const REMOVE_NOARG = new Set([
  'noindent', 'indent', 'newpage', 'clearpage', 'cleardoublepage', 'pagebreak', 'nopagebreak',
  'medskip', 'bigskip', 'smallskip', 'maketitle', 'centering', 'raggedright', 'raggedleft', 'hfill',
  'vfill', 'hrulefill', 'dotfill', 'protect', 'relax', 'small', 'footnotesize', 'scriptsize', 'tiny',
  'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'bf', 'it', 'em', 'rm', 'sf', 'tt', 'sc',
  'sl', 'bfseries', 'itshape', 'mdseries', 'rmfamily', 'sffamily', 'ttfamily', 'upshape', 'scshape',
  'slshape', 'normalfont', 'displaystyle', 'tableofcontents', 'listoffigures', 'listoftables',
  'frenchspacing', 'sloppy', 'fussy', 'leavevmode', 'onecolumn', 'twocolumn', 'appendix', 'hrule',
  'today', 'printanswers', 'noprintanswers', 'allowdisplaybreaks', 'null', 'break', 'nobreak',
  'strut', 'unskip', 'ignorespaces', 'selectfont', 'boldmath', 'unboldmath', 'makeatletter',
  'makeatother', 'FloatBarrier', 'justifying', 'hline', 'toprule', 'midrule', 'bottomrule',
  'nonumber', 'notag', 'qedhere', 'item', 'bracketedpoints', 'pointsinmargin', 'pointsinrightmargin',
  'unframedsolutions', 'framedsolutions', 'nopointsinmargin', 'pagenumbering',
])

/** Commands removed together with their arguments (spec letters as in skipArgs). */
export const REMOVE_ARGS: Readonly<Record<string, string>> = {
  label: 'm', vspace: 'm', hspace: 'm', setlength: 'cm', addtolength: 'cm', setcounter: 'mm',
  addtocounter: 'mm', stepcounter: 'm', refstepcounter: 'm', pagestyle: 'm', thispagestyle: 'm',
  usepackage: 'om', RequirePackage: 'om', documentclass: 'om', newcommand: 'coom',
  renewcommand: 'coom', providecommand: 'coom', DeclareMathOperator: 'cm', newtheorem: 'momo',
  theoremstyle: 'm', newenvironment: 'moomm', renewenvironment: 'moomm', newcounter: 'mo',
  numberwithin: 'mm', definecolor: 'mmm', author: 'om', date: 'm', title: 'om', subtitle: 'm',
  geometry: 'm', hypersetup: 'm', graphicspath: 'm', bibliographystyle: 'm', bibliography: 'm',
  includeonly: 'm', fancyhead: 'om', fancyfoot: 'om', lhead: 'om', chead: 'om', rhead: 'om',
  lfoot: 'om', cfoot: 'om', rfoot: 'om', fancypagestyle: 'mm', firstpageheader: 'mmm',
  runningheader: 'mmm', firstpagefooter: 'mmm', runningfooter: 'mmm', header: 'mmm', footer: 'mmm',
  pointname: 'm', pointformat: 'm', qformat: 'm', color: 'm', linespread: 'm', setstretch: 'm',
  captionsetup: 'om', lstset: 'm', usetikzlibrary: 'm', tikzset: 'm', newgeometry: 'm',
  enlargethispage: 'm', phantom: 'm', hphantom: 'm', vphantom: 'm', cline: 'm', rule: 'omm',
  addcontentsline: 'mmm', nocite: 'm', hyphenation: 'm', needspace: 'm', marginpar: 'm',
  setmainfont: 'om', setsansfont: 'om', setmonofont: 'om', newlength: 'c', input: 'm', include: 'm',
  extraheadheight: 'om', extrafootheight: 'om', renewcommandx: 'coom', DeclarePairedDelimiter: 'cmm',
  hwnum: 'm', duedate: 'm', course: 'm', semester: 'm', instructor: 'm',
}

const SECTION_LEVEL: Readonly<Record<string, number>> = { part: 1, chapter: 1, section: 2, subsection: 3, subsubsection: 4 }

const ACCENTS: Readonly<Record<string, string>> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊',
}

type ListKind = 'bullet' | 'enum' | 'description' | 'parts' | 'subparts' | 'subsubparts' | 'choices'

export const LIST_ENVS: Readonly<Record<string, { items: string[]; kind: ListKind }>> = {
  itemize: { items: ['item'], kind: 'bullet' },
  compactitem: { items: ['item'], kind: 'bullet' },
  asparaitem: { items: ['item'], kind: 'bullet' },
  inparaitem: { items: ['item'], kind: 'bullet' },
  enumerate: { items: ['item'], kind: 'enum' },
  compactenum: { items: ['item'], kind: 'enum' },
  asparaenum: { items: ['item'], kind: 'enum' },
  inparaenum: { items: ['item'], kind: 'enum' },
  description: { items: ['item'], kind: 'description' },
  parts: { items: ['part'], kind: 'parts' },
  subparts: { items: ['subpart'], kind: 'subparts' },
  subsubparts: { items: ['subsubpart'], kind: 'subsubparts' },
  choices: { items: ['choice', 'CorrectChoice'], kind: 'choices' },
  oneparchoices: { items: ['choice', 'CorrectChoice'], kind: 'choices' },
  checkboxes: { items: ['choice', 'CorrectChoice'], kind: 'bullet' },
  oneparcheckboxes: { items: ['choice', 'CorrectChoice'], kind: 'bullet' },
}

const FIXED_LIST_STYLE: Partial<Record<ListKind, EnumStyle>> = {
  parts: { counter: 'alph', prefix: '(', suffix: ')' },
  subparts: { counter: 'roman', prefix: '', suffix: '.' },
  subsubparts: { counter: 'Alph', prefix: '', suffix: '.' },
  choices: { counter: 'Alph', prefix: '', suffix: '.' },
}

/** Label style of a list environment (exam-class lists have fixed styles). */
export function listStyle(envName: string, opt: string | null, enumDepth: number): EnumStyle | null {
  const def = LIST_ENVS[envName]
  if (!def) return null
  const fixed = FIXED_LIST_STYLE[def.kind]
  if (fixed) return fixed
  if (def.kind === 'enum') return enumStyle(opt, enumDepth)
  return null
}

type DisplayKind = 'plain' | 'aligned' | 'gathered' | 'alignedat' | 'array' | 'inline'

const MATH_ENVS: Readonly<Record<string, DisplayKind>> = {
  equation: 'plain', 'equation*': 'plain', displaymath: 'plain', math: 'inline',
  align: 'aligned', 'align*': 'aligned', flalign: 'aligned', 'flalign*': 'aligned',
  alignat: 'alignedat', 'alignat*': 'alignedat', gather: 'gathered', 'gather*': 'gathered',
  multline: 'gathered', 'multline*': 'gathered', eqnarray: 'array', 'eqnarray*': 'array',
}

/** Environments whose leading arguments are layout parameters, not content. */
const ENV_SKIP: Readonly<Record<string, string>> = {
  figure: 'o', 'figure*': 'o', table: 'o', 'table*': 'o', minipage: 'ooom', multicols: 'm',
  'multicols*': 'm', wrapfigure: 'omom', subfigure: 'om', adjustbox: 'm', mdframed: 'o',
  tcolorbox: 'o', boxedminipage: 'om', tabular: 'om', 'tabular*': 'mom', tabularx: 'mm',
  longtable: 'om', array: 'om',
}

const TABULAR_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'longtable', 'array'])
const FIGURE_ENVS = new Set(['tikzpicture', 'pspicture', 'picture', 'circuitikz', 'tikzcd', 'forest', 'asy'])
const THEOREM_LIKE = new Set([
  'theorem', 'lemma', 'proposition', 'corollary', 'definition', 'remark', 'example', 'claim', 'fact',
  'note', 'conjecture', 'observation', 'notation', 'hint', 'problem', 'exercise', 'question', 'solution',
  'answer',
])

// ---------------------------------------------------------------------------
// Converter
// ---------------------------------------------------------------------------

interface Ctx {
  enumDepth: number
  inTabular: boolean
}

export interface LatexConversion {
  markdown: string
  /** Problems noticed while converting: 'unbalanced-braces', 'unclosed-env:NAME', 'unclosed-math', 'unresolved-input', … */
  issues: string[]
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function codeFence(content: string, lang: string): string {
  let fence = '```'
  while (content.includes(fence)) fence += '`'
  return `${fence}${lang}\n${content}\n${fence}`
}

class LatexConverter {
  readonly issues = new Set<string>()
  private readonly blocks: string[] = []
  private depth = 0

  /** Stores text that later normalization must not touch; returns a placeholder token. */
  private protect(s: string): string {
    this.blocks.push(s)
    return `${NUL}${this.blocks.length - 1}${NUL}`
  }

  private expand(s: string): string {
    return s.replace(PLACEHOLDER_RE, (_m, n: string) => this.blocks[Number(n)] ?? '')
  }

  /** Whitespace cleanup of the unprotected skeleton, then placeholder expansion. */
  finish(s: string): string {
    const skeleton = s
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    return this.expand(skeleton)
  }

  private inline(s: string, ctx: Ctx): string {
    return this.finish(this.render(s, ctx)).replace(/\s*\n\s*/g, ' ').trim()
  }

  render(src: string, ctx: Ctx): string {
    if (this.depth >= MAX_DEPTH) {
      this.issues.add('too-deeply-nested')
      return src.replace(/[{}]/g, '')
    }
    this.depth++
    try {
      return this.renderLoop(src, ctx)
    } finally {
      this.depth--
    }
  }

  private renderLoop(src: string, ctx: Ctx): string {
    const out: string[] = []
    const n = src.length
    let i = 0
    while (i < n) {
      const c = src.charAt(i)
      switch (c) {
        case '\\':
          i = this.command(src, i, ctx, out)
          continue
        case '$':
          i = this.dollar(src, i, out)
          continue
        case '{': {
          const close = matchBrace(src, i)
          if (close < 0) {
            this.issues.add('unbalanced-braces')
            i++
            continue
          }
          out.push(this.group(src.slice(i + 1, close), ctx))
          i = close + 1
          continue
        }
        case '}':
          this.issues.add('unbalanced-braces')
          i++
          continue
        case '\n':
          out.push('\n')
          i++
          while (i < n && (src.charAt(i) === ' ' || src.charAt(i) === '\t')) i++
          continue
        case '~':
          out.push(' ')
          i++
          continue
        case '`':
          if (src.charAt(i + 1) === '`') {
            out.push('“')
            i += 2
          } else {
            out.push('‘')
            i++
          }
          continue
        case "'":
          if (src.charAt(i + 1) === "'") {
            out.push('”')
            i += 2
          } else {
            out.push("'")
            i++
          }
          continue
        case '-':
          if (src.startsWith('---', i)) {
            out.push('—')
            i += 3
          } else if (src.startsWith('--', i)) {
            out.push('–')
            i += 2
          } else {
            out.push('-')
            i++
          }
          continue
        case '&':
          out.push(ctx.inTabular ? ' | ' : '&')
          i++
          continue
        default:
          out.push(c)
          i++
      }
    }
    return out.join('')
  }

  /** `{…}` group: honors old-style `{\bf …}` / `{\it …}` declarations. */
  private group(inner: string, ctx: Ctx): string {
    const m = /^\s*\\(bf|bfseries|it|itshape|em|sl|slshape|tt|ttfamily)(?![a-zA-Z])\s*/.exec(inner)
    if (!m) return this.render(inner, ctx)
    const body = this.finish(this.render(inner.slice(m[0].length), ctx))
    const kind = m[1] ?? ''
    if (kind.startsWith('bf')) return this.wrap('**', body)
    if (kind.startsWith('tt')) return this.codeSpan(body)
    return this.wrap('*', body)
  }

  private wrap(marker: string, inner: string): string {
    const trimmed = inner.trim()
    if (!trimmed) return inner
    const lead = /^\s/.test(inner) ? ' ' : ''
    const trail = /\s$/.test(inner) ? ' ' : ''
    return `${lead}${marker}${trimmed}${marker}${trail}`
  }

  private codeSpan(raw: string): string {
    const text = raw.replace(/\\([_$#%&{}])/g, '$1')
    if (!text) return ''
    const fence = text.includes('`') ? '``' : '`'
    const pad = fence.length > 1 ? ' ' : ''
    return this.protect(`${fence}${pad}${text}${pad}${fence}`)
  }

  private displayMath(body: string, kind: DisplayKind, envArg = ''): string {
    const cleaned = body
      .replace(/\\label\s*\{[^}]*\}/g, '')
      .replace(/\\(?:nonumber|notag)(?![a-zA-Z])/g, '')
      .replace(/\n[ \t]*\n/g, '\n')
      .trim()
    if (kind === 'inline') return this.protect(`$${cleaned}$`)
    let math = cleaned
    if (kind === 'aligned' || kind === 'gathered') math = `\\begin{${kind}}\n${cleaned}\n\\end{${kind}}`
    else if (kind === 'alignedat') math = `\\begin{alignedat}{${envArg || '1'}}\n${cleaned}\n\\end{alignedat}`
    else if (kind === 'array') math = `\\begin{array}{rcl}\n${cleaned}\n\\end{array}`
    return `\n\n${this.protect(`$$\n${math}\n$$`)}\n\n`
  }

  private dollar(src: string, i: number, out: string[]): number {
    if (src.charAt(i + 1) === '$') {
      const end = findUnescaped(src, '$$', i + 2)
      if (end < 0) {
        this.issues.add('unclosed-math')
        out.push('\\$\\$')
        return i + 2
      }
      out.push(this.displayMath(src.slice(i + 2, end), 'plain'))
      return end + 2
    }
    const end = findUnescaped(src, '$', i + 1)
    const body = end >= 0 ? src.slice(i + 1, end) : ''
    if (end < 0 || /\n[ \t]*\n/.test(body)) {
      this.issues.add('unclosed-math')
      out.push('\\$')
      return i + 1
    }
    out.push(this.protect(`$${body}$`))
    return end + 1
  }

  private command(src: string, i: number, ctx: Ctx, out: string[]): number {
    const next = src.charAt(i + 1)
    if (next === '') return i + 1
    if (!/[a-zA-Z@]/.test(next)) return this.controlSymbol(src, i, next, ctx, out)
    let j = i + 1
    while (j < src.length && /[a-zA-Z@]/.test(src.charAt(j))) j++
    const name = src.slice(i + 1, j)
    if (src.charAt(j) === '*' && !(name in REPLACE)) j++
    return this.letterCommand(name, src, j, ctx, out)
  }

  private controlSymbol(src: string, i: number, sym: string, ctx: Ctx, out: string[]): number {
    switch (sym) {
      case '\\': {
        let j = i + 2
        if (src.charAt(j) === '*') j++
        if (src.charAt(j) === '[') {
          const close = matchBracket(src, j)
          if (close >= 0) j = close + 1
        }
        out.push('\n')
        return j
      }
      case '(': {
        const end = findClosingDelim(src, i + 2, ')')
        if (end < 0) {
          this.issues.add('unclosed-math')
          out.push(this.protect(`$${src.slice(i + 2)}$`))
          return src.length
        }
        out.push(this.protect(`$${src.slice(i + 2, end)}$`))
        return end + 2
      }
      case '[': {
        const end = findClosingDelim(src, i + 2, ']')
        if (end < 0) {
          this.issues.add('unclosed-math')
          out.push(this.displayMath(src.slice(i + 2), 'plain'))
          return src.length
        }
        out.push(this.displayMath(src.slice(i + 2, end), 'plain'))
        return end + 2
      }
      case ',':
      case ';':
      case ':':
      case '!':
      case '>':
      case '/':
      case '-':
      case '@':
        return i + 2
      case ' ':
      case '\n':
      case '\t':
        out.push(' ')
        return i + 2
      case '$':
        out.push('\\$')
        return i + 2
      case '#':
        out.push('\\#')
        return i + 2
      case '_':
        out.push('\\_')
        return i + 2
      case '%':
      case '&':
      case '{':
      case '}':
        out.push(sym)
        return i + 2
      default: {
        const mark = ACCENTS[sym]
        if (mark) return this.accent(src, i + 2, mark, ctx, out)
        out.push(sym)
        return i + 2
      }
    }
  }

  private accent(src: string, j: number, mark: string, ctx: Ctx, out: string[]): number {
    const arg = readArgOrToken(src, j)
    if (!arg) return j
    let base = arg.content.startsWith('\\') ? arg.content.replace(/^\\([ij])$/, '$1') : this.inline(arg.content, ctx)
    if (base.startsWith('\\')) base = ''
    out.push(base ? `${base.charAt(0)}${mark}${base.slice(1)}`.normalize('NFC') : '')
    return arg.end
  }

  private letterCommand(name: string, src: string, j: number, ctx: Ctx, out: string[]): number {
    if (name === 'begin') return this.environment(src, j, ctx, out)
    if (name === 'end') {
      const arg = readArg(src, j)
      this.issues.add('stray-end')
      return arg ? arg.end : j
    }

    const marker = WRAP[name]
    if (marker) {
      const arg = readArgOrToken(src, j)
      if (!arg) return j
      out.push(this.wrap(marker, this.finish(this.render(arg.content, ctx))))
      return arg.end
    }

    const pass = PASS[name]
    if (pass) return this.passThrough(name, pass, src, j, ctx, out)

    const accent = ACCENTS[name]
    if (accent && src.charAt(j) === '{') return this.accent(src, j, accent, ctx, out)

    const replacement = REPLACE[name]
    if (replacement !== undefined) {
      out.push(replacement)
      return skipTrailingSpace(src, j)
    }

    const level = SECTION_LEVEL[name]
    if (level !== undefined && (name !== 'part' || /^\s*[[{]/.test(src.slice(j, j + 4)))) {
      const short = readOptional(src, j)
      const arg = readArg(src, short ? short.end : j)
      if (!arg) return short ? short.end : j
      out.push(`\n\n${'#'.repeat(level)} ${this.inline(arg.content, ctx)}\n\n`)
      return arg.end
    }

    switch (name) {
      case 'paragraph':
      case 'subparagraph': {
        const arg = readArg(src, j)
        if (!arg) return j
        out.push(`\n\n**${this.inline(arg.content, ctx)}** `)
        return arg.end
      }
      case 'texttt': {
        const arg = readArgOrToken(src, j)
        if (!arg) return j
        out.push(this.codeSpan(this.finish(this.render(arg.content, ctx))))
        return arg.end
      }
      case 'verb':
      case 'lstinline':
      case 'mintinline':
        return this.inlineVerbatim(name, src, j, out)
      case 'url': {
        const arg = readArg(src, j)
        if (!arg) return j
        out.push(arg.content.replace(/\\([_#%&~$])/g, '$1'))
        return arg.end
      }
      case 'href': {
        const url = readArg(src, j)
        if (!url) return j
        const text = readArg(src, url.end)
        if (!text) {
          out.push(url.content)
          return url.end
        }
        const label = this.inline(text.content, ctx)
        out.push(label ? `${label} (${url.content})` : url.content)
        return text.end
      }
      case 'footnote':
      case 'footnotetext': {
        const opt = readOptional(src, j)
        const arg = readArg(src, opt ? opt.end : j)
        if (!arg) return j
        out.push(` (${this.inline(arg.content, ctx)})`)
        return arg.end
      }
      case 'ref':
      case 'pageref':
      case 'autoref':
      case 'cref':
      case 'Cref':
      case 'nameref': {
        const arg = readArg(src, j)
        if (!arg) return j
        out.push(arg.content)
        return arg.end
      }
      case 'eqref': {
        const arg = readArg(src, j)
        if (!arg) return j
        out.push(`(${arg.content})`)
        return arg.end
      }
      case 'cite':
      case 'citep':
      case 'citet': {
        const opt = readOptional(src, j)
        const arg = readArg(src, opt ? opt.end : j)
        if (!arg) return j
        out.push(`[${arg.content}]`)
        return arg.end
      }
      case 'includegraphics': {
        out.push('[figure omitted]')
        return skipArgs(src, j, 'om')
      }
      case 'input':
      case 'include':
      case 'subfile':
        this.issues.add('unresolved-input')
        return skipArgs(src, j, 'm')
      case 'def': {
        // \def\name#1#2{body}: skip the name, the parameter text, and the body.
        const nameTok = readCsOrArg(src, j)
        let k = nameTok ? nameTok.end : j
        while (k < src.length && src.charAt(k) !== '{' && src.charAt(k) !== '\n') k++
        const body = readArg(src, k)
        return body ? body.end : k
      }
      case 'let': {
        // \let\a\b or \let\a=\b
        let k = skipArgs(src, j, 'c')
        k = skipTrailingSpace(src, k)
        if (src.charAt(k) === '=') k++
        return skipArgs(src, k, 'c')
      }
      case 'vskip':
      case 'hskip':
      case 'kern': {
        const m = /^\s*-?[\d.]+\s*[a-z]{2}(?:\s+(?:plus|minus)\s+-?[\d.]+\s*[a-z]{2})*/.exec(src.slice(j, j + 60))
        return m ? j + m[0].length : j
      }
      case 'item': {
        const opt = readOptional(src, j)
        out.push(opt ? `\n- ${this.inline(opt.content, ctx)} ` : '\n- ')
        return opt ? opt.end : skipTrailingSpace(src, j)
      }
      case 'question':
      case 'titledquestion': {
        let k = j
        if (name === 'titledquestion') {
          const title = readArg(src, k)
          if (title) {
            out.push(`\n\n**${this.inline(title.content, ctx)}** `)
            k = title.end
          }
        } else {
          out.push('\n\n')
        }
        return skipArgs(src, k, 'o')
      }
      case 'part':
      case 'subpart':
      case 'subsubpart':
      case 'choice':
      case 'CorrectChoice':
        out.push('\n- ')
        return skipArgs(src, j, 'o')
    }

    if (REMOVE_NOARG.has(name)) return skipTrailingSpace(src, j)
    const removeSpec = REMOVE_ARGS[name]
    if (removeSpec !== undefined) return skipArgs(src, j, removeSpec)

    return this.unknownCommand(name, src, j, ctx, out)
  }

  private passThrough(name: string, spec: string, src: string, j: number, ctx: Ctx, out: string[]): number {
    let k = j
    for (const kind of spec) {
      if (kind === 'M') {
        const arg = readArgOrToken(src, k)
        if (!arg) return k
        const body = this.render(arg.content, ctx)
        out.push(name === 'enquote' ? `“${body}”` : body)
        k = arg.end
      } else {
        k = skipArgs(src, k, kind)
      }
    }
    return k
  }

  private inlineVerbatim(name: string, src: string, j: number, out: string[]): number {
    let k = j
    if (name === 'mintinline') k = skipArgs(src, k, 'om')
    else if (name === 'lstinline') k = skipArgs(src, k, 'o')
    const delim = src.charAt(k)
    if (!delim || /\s/.test(delim)) return k
    const closer = delim === '{' ? '}' : delim
    const end = src.indexOf(closer, k + 1)
    if (end < 0) {
      this.issues.add('unclosed-verb')
      return k + 1
    }
    const raw = src.slice(k + 1, end)
    const fence = raw.includes('`') ? '``' : '`'
    const pad = fence.length > 1 ? ' ' : ''
    out.push(this.protect(`${fence}${pad}${raw}${pad}${fence}`))
    return end + 1
  }

  /** Unknown text-mode command: keep its brace arguments' text, or the command itself if it takes none. */
  private unknownCommand(name: string, src: string, j: number, ctx: Ctx, out: string[]): number {
    let k = j
    const parts: string[] = []
    if (src.charAt(k) === '[') {
      const opt = readOptional(src, k)
      if (opt) k = opt.end
    }
    while (src.charAt(k) === '{') {
      const close = matchBrace(src, k)
      if (close < 0) break
      parts.push(this.render(src.slice(k + 1, close), ctx))
      k = close + 1
    }
    if (parts.length > 0) out.push(parts.join(' '))
    else out.push(`\\${name}`)
    return k
  }

  private environment(src: string, j: number, ctx: Ctx, out: string[]): number {
    const nameArg = readArg(src, j)
    if (!nameArg) {
      this.issues.add('malformed-begin')
      return j
    }
    const name = nameArg.content.trim()
    const bodyStart = nameArg.end

    if (VERBATIM_ENVS.has(name)) return this.verbatim(name, src, bodyStart, out)

    const endInfo = findEnvEnd(src, name, bodyStart)
    if (!endInfo) this.issues.add(`unclosed-env:${name}`)
    const contentEnd = endInfo ? endInfo.start : src.length
    const after = endInfo ? endInfo.end : src.length
    let content = src.slice(bodyStart, contentEnd)

    if (name === 'comment') return after

    const mathKind = MATH_ENVS[name]
    if (mathKind) {
      let envArg = ''
      if (mathKind === 'alignedat') {
        const arg = readArg(content, 0)
        if (arg) {
          envArg = arg.content.trim()
          content = content.slice(arg.end)
        }
      }
      out.push(this.displayMath(content, mathKind, envArg))
      return after
    }

    const list = LIST_ENVS[name]
    if (list) {
      out.push(this.list(name, list.kind, list.items, content, ctx))
      return after
    }

    if (FIGURE_ENVS.has(name)) {
      out.push('\n\n[figure omitted]\n\n')
      return after
    }

    const skip = ENV_SKIP[name]
    if (skip) content = content.slice(skipArgs(content, 0, skip))

    if (TABULAR_ENVS.has(name)) {
      const rows = this.finish(this.render(content, { ...ctx, inTabular: true }))
      out.push(`\n\n${rows}\n\n`)
      return after
    }

    const base = name.replace(/\*$/, '')
    if (base === 'proof') {
      const opt = readOptional(content, 0)
      const body = opt ? content.slice(opt.end) : content
      out.push(`\n\n*Proof.* ${this.render(body, ctx)}\n\n`)
      return after
    }
    if (THEOREM_LIKE.has(base)) {
      const opt = readOptional(content, 0)
      const body = opt ? content.slice(opt.end) : content
      const heading = opt ? `**${capitalize(base)} (${this.inline(opt.content, ctx)}).**` : `**${capitalize(base)}.**`
      out.push(`\n\n${heading} ${this.render(body, ctx)}\n\n`)
      return after
    }

    // Unknown (or purely presentational) environment: keep the content, drop begin/end.
    out.push(`\n\n${this.render(content, ctx)}\n\n`)
    return after
  }

  private verbatim(name: string, src: string, bodyStart: number, out: string[]): number {
    let start = bodyStart
    let lang = ''
    if (name === 'lstlisting') {
      const opt = readOptional(src, start)
      if (opt && !opt.content.includes('\n')) {
        lang = /language\s*=\s*\{?([A-Za-z0-9+#-]+)/.exec(opt.content)?.[1]?.toLowerCase() ?? ''
        start = opt.end
      }
    } else if (name === 'minted') {
      const opt = readOptional(src, start)
      if (opt && !opt.content.includes('\n')) start = opt.end
      const arg = readArg(src, start)
      if (arg) {
        lang = arg.content.trim().toLowerCase()
        start = arg.end
      }
    }
    const endTag = `\\end{${name}}`
    const endIdx = src.indexOf(endTag, start)
    if (endIdx < 0) this.issues.add(`unclosed-env:${name}`)
    const raw = src.slice(start, endIdx < 0 ? src.length : endIdx)
    const content = raw.replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '')
    out.push(`\n\n${this.protect(codeFence(content, lang))}\n\n`)
    return endIdx < 0 ? src.length : endIdx + endTag.length
  }

  private list(name: string, kind: ListKind, itemCmds: string[], rawContent: string, ctx: Ctx): string {
    let content = rawContent
    let opt: string | null = null
    const o = readOptional(content, 0)
    if (o && kind !== 'parts' && kind !== 'subparts') {
      opt = o.content
      content = content.slice(o.end)
    }
    const { before, items } = splitItems(content, itemCmds)
    const style = listStyle(name, opt, ctx.enumDepth)
    const childCtx: Ctx = { ...ctx, enumDepth: kind === 'enum' ? ctx.enumDepth + 1 : ctx.enumDepth }
    const lines: string[] = []
    const intro = this.finish(this.render(before, ctx))
    if (intro) lines.push(intro, '')
    items.forEach((item, k) => {
      let marker: string
      // Exam-class \part[2] / \choice options are point values, not labels.
      if (item.label !== null && (kind === 'bullet' || kind === 'enum' || kind === 'description')) {
        const label = this.inline(item.label, ctx)
        marker = kind === 'description' ? `- **${label}**` : `- ${label}`
      } else if (style && style.counter === 'arabic' && style.prefix === '' && (style.suffix === '.' || style.suffix === ')')) {
        marker = `${k + 1}.`
      } else if (style) {
        marker = `- ${style.prefix}${counterLabel(style.counter, k + 1)}${style.suffix}`
      } else {
        marker = '-'
      }
      const body = this.finish(this.render(item.body, childCtx))
      const indent = ' '.repeat(/^\d+\.$/.test(marker) ? marker.length + 1 : 2)
      const indented = body
        .split('\n')
        .map((line, idx) => (idx === 0 || line === '' ? line : indent + line))
        .join('\n')
      lines.push(indented ? `${marker} ${indented}` : marker)
    })
    return `\n\n${this.protect(lines.join('\n'))}\n\n`
  }
}

function skipTrailingSpace(src: string, j: number): number {
  let k = j
  while (src.charAt(k) === ' ' || src.charAt(k) === '\t') k++
  return k
}

/** Index of the next unescaped occurrence of `token` (`$` or `$$`) at or after `from`, or -1. */
function findUnescaped(src: string, token: string, from: number): number {
  for (let k = from; k < src.length; k++) {
    const c = src.charAt(k)
    if (c === '\\') {
      k++
      continue
    }
    if (src.startsWith(token, k)) return k
  }
  return -1
}

/** Index of the backslash in `\)` / `\]` closing a math span, skipping `\\` pairs. */
function findClosingDelim(src: string, from: number, closer: string): number {
  for (let k = from; k < src.length; k++) {
    if (src.charAt(k) === '\\') {
      if (src.charAt(k + 1) === closer) return k
      k++
    }
  }
  return -1
}

/** Converts a LaTeX fragment to Markdown and reports what looked malformed. Never throws. */
export function convertLatex(tex: string, opts: { enumDepth?: number } = {}): LatexConversion {
  const converter = new LatexConverter()
  const src = stripLatexComments(String(tex ?? '').replace(/\r\n?/g, '\n').split(NUL).join(''))
  try {
    const rendered = converter.render(src, { enumDepth: opts.enumDepth ?? 0, inTabular: false })
    return { markdown: converter.finish(rendered), issues: [...converter.issues] }
  } catch {
    // Defensive: the converter is not expected to throw, but a parse must never fail on odd input.
    return { markdown: src.trim(), issues: [...converter.issues, 'internal-error'] }
  }
}

/** Converts a LaTeX fragment into Markdown suitable for react-markdown + remark-math + rehype-katex. */
export function latexToMarkdown(tex: string): string {
  return convertLatex(tex).markdown
}

/** Single-line plain rendering of a short LaTeX snippet (titles, labels); emphasis markers removed. */
export function latexInlineText(tex: string): string {
  return convertLatex(tex)
    .markdown.replace(/\s*\n\s*/g, ' ')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .trim()
}
