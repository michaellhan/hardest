/**
 * Rebuilds Markdown with LaTeX math from a PDF's text layer.
 *
 * pdf.js reports text as runs of glyphs with a font, a position and a size. In TeX-produced PDFs the font
 * says what a glyph means (CMMI = math italic, CMSY = symbols and calligraphic capitals, MSBM = blackboard
 * bold, EUFM = fraktur, CMEX = big operators), and a smaller size plus a raised or lowered baseline marks a
 * superscript or subscript. Text-font glyphs that sit between math glyphs (digits, =, parentheses, operator
 * names like log or Aut) are pulled into the formula. Math becomes $…$ inline, or a $$ block when a line is
 * nothing but math. PDFs without usable font names (or without math) come out as plain text, as before.
 */

export interface GlyphRun {
  str: string
  /** PDF font name, e.g. "MCSREA+CMMI10"; empty when unknown. */
  font: string
  x: number
  /** Baseline, in PDF units (larger = higher on the page). */
  y: number
  width: number
  size: number
}

type Role = 'text' | 'bold' | 'italic' | 'mono' | 'math' | 'symbol' | 'ex' | 'bb' | 'frak' | 'script' | 'mathbold' | 'umath' | 'arrow' | 'raw'

export function fontRole(font: string): Role {
  const n = font.replace(/^[A-Z]{6}\+/, '').toUpperCase()
  if (/^(CMMIB|CMBSY)/.test(n)) return 'mathbold'
  if (/^(CMMI|LMMI|EURM|EURB)/.test(n) || /MATHITALIC/.test(n)) return 'math'
  if (/^(CMSY|LMSY|MSAM|STMARY|WASY|TXSY|PXSY)/.test(n) || /MATHSYMBOLS/.test(n)) return 'symbol'
  if (/^(CMEX|LMEX|EUEX|ESINT|TXEX|PXEX)/.test(n) || /MATHEXTENSION/.test(n)) return 'ex'
  // Picture-mode / xy-pic arrowheads; their shafts are rules, which aren't text.
  if (/^(LINE|LINEW|XYATIP|XYBTIP)\d/.test(n)) return 'arrow'
  if (/^MSBM/.test(n) || /^(TXMIA|PXMIA)/.test(n)) return 'bb'
  if (/^(EUFM|EUFB)/.test(n)) return 'frak'
  if (/^(RSFS|EUSM|EUSB)/.test(n)) return 'script'
  if (/CAMBRIAMATH|CAMBRIA-MATH|STIXTWOMATH|STIXMATH|XITSMATH|LATINMODERNMATH|ASANA|^SYMBOL(MT)?$/.test(n)) return 'umath'
  if (/^(CMTT|LMMONO|SFTT)|MONO|COURIER/.test(n)) return 'mono'
  if (/^(CMBX|CMB\d|SFBX|LMROMANDEMI)|BOLD/.test(n)) return 'bold'
  if (/^(CMTI|CMSL|SFTI|SFSL)|ITALIC|OBLIQUE/.test(n)) return 'italic'
  return 'text'
}

const isTextRole = (r: Role) => r === 'text' || r === 'bold' || r === 'italic' || r === 'mono'

// ───────────────────────── glyph → LaTeX ─────────────────────────

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ϵ: 'epsilon', ε: 'varepsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ϑ: 'vartheta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ϖ: 'varpi', ρ: 'rho', ϱ: 'varrho', σ: 'sigma', ς: 'varsigma',
  τ: 'tau', υ: 'upsilon', ϕ: 'phi', φ: 'varphi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Υ: 'Upsilon', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega',
}

const SYMBOLS: Record<string, string> = {
  '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow', '⇔': '\\Leftrightarrow',
  '⟹': '\\implies', '⟸': '\\impliedby', '⟺': '\\iff', '↦': '\\mapsto', '↪': '\\hookrightarrow', '↠': '\\twoheadrightarrow',
  '⟶': '\\longrightarrow', '⟵': '\\longleftarrow', '⟼': '\\longmapsto', '↑': '\\uparrow', '↓': '\\downarrow',
  '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '⊂': '\\subset', '⊆': '\\subseteq', '⊊': '\\subsetneq', '⊃': '\\supset', '⊇': '\\supseteq',
  '∪': '\\cup', '∩': '\\cap', '⋃': '\\bigcup', '⋂': '\\bigcap', '⊔': '\\sqcup', '∖': '\\setminus', '∅': '\\emptyset',
  '×': '\\times', '·': '\\cdot', '⋅': '\\cdot', '∘': '\\circ', '◦': '\\circ', '∗': '*', '⋆': '\\star', '÷': '\\div', '±': '\\pm', '∓': '\\mp',
  '⊕': '\\oplus', '⊗': '\\otimes', '⊙': '\\odot', '⊖': '\\ominus', '⨁': '\\bigoplus', '⨂': '\\bigotimes', '⋊': '\\rtimes', '⋉': '\\ltimes',
  '≤': '\\le', '≥': '\\ge', '≦': '\\leqq', '≧': '\\geqq', '≠': '\\neq', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '≃': '\\simeq',
  '≅': '\\cong', '∝': '\\propto', '≪': '\\ll', '≫': '\\gg', '≺': '\\prec', '≻': '\\succ', '⪯': '\\preceq', '⪰': '\\succeq',
  '⊲': '\\triangleleft', '⊳': '\\triangleright', '⊴': '\\trianglelefteq', '⊵': '\\trianglerighteq', '◁': '\\triangleleft', '▷': '\\triangleright',
  '∞': '\\infty', '∀': '\\forall', '∃': '\\exists', '∄': '\\nexists', '¬': '\\neg', '∧': '\\wedge', '∨': '\\vee', '⊤': '\\top', '⊥': '\\perp',
  '⊢': '\\vdash', '⊨': '\\models', '∥': '\\|', '∣': '\\mid', '∤': '\\nmid', '∂': '\\partial', '∇': '\\nabla', '√': '\\sqrt',
  '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∮': '\\oint',
  '⟨': '\\langle', '⟩': '\\rangle', '⌊': '\\lfloor', '⌋': '\\rfloor', '⌈': '\\lceil', '⌉': '\\rceil', '‖': '\\|',
  '−': '-', '–': '-', '′': '\\prime', '″': '\\prime\\prime', '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
  'ℵ': '\\aleph', 'ℏ': '\\hbar', 'ℓ': '\\ell', '℘': '\\wp', 'ℜ': '\\Re', 'ℑ': '\\Im', 'ı': '\\imath', 'ȷ': '\\jmath',
  '∠': '\\angle', '△': '\\triangle', '□': '\\square', '■': '\\blacksquare', '♯': '\\sharp', '♭': '\\flat', '♮': '\\natural',
  '†': '\\dagger', '‡': '\\ddagger', '§': '\\S', '¶': '\\P', '°': '^\\circ', '\\': '\\backslash',
  '{': '\\{', '}': '\\}', '#': '\\#', '%': '\\%', '&': '\\&', $: '\\$', _: '\\_', '~': '\\sim', '^': '\\wedge',
  ℕ: '\\mathbb{N}', ℤ: '\\mathbb{Z}', ℚ: '\\mathbb{Q}', ℝ: '\\mathbb{R}', ℂ: '\\mathbb{C}', ℙ: '\\mathbb{P}', ℍ: '\\mathbb{H}', ℎ: 'h',
  '⊋': '\\supsetneq', '⊈': '\\nsubseteq', '⊉': '\\nsupseteq', '≰': '\\nleq', '≱': '\\ngeq', '≲': '\\lesssim', '≳': '\\gtrsim',
  '⩽': '\\leqslant', '⩾': '\\geqslant', '≨': '\\lneqq', '≩': '\\gneqq', '⊏': '\\sqsubset', '⊐': '\\sqsupset', '⊑': '\\sqsubseteq',
  '⊒': '\\sqsupseteq', '≼': '\\preccurlyeq', '≽': '\\succcurlyeq', '∴': '\\therefore', '∵': '\\because', '∁': '\\complement',
  '⋄': '\\diamond', '♦': '\\diamondsuit', '✓': '\\checkmark', '⊸': '\\multimap', '↾': '\\upharpoonright', '⊠': '\\boxtimes',
  '⊞': '\\boxplus', '⇝': '\\leadsto', '↩': '\\hookleftarrow', '⇀': '\\rightharpoonup',
  '̸': '\\not ',
}

const OPERATORS = new Set([
  'arccos', 'arcsin', 'arctan', 'arg', 'cos', 'cosh', 'cot', 'coth', 'csc', 'deg', 'det', 'dim', 'exp', 'gcd', 'hom', 'inf', 'ker', 'lg',
  'lim', 'liminf', 'limsup', 'ln', 'log', 'max', 'min', 'Pr', 'sec', 'sin', 'sinh', 'sup', 'tan', 'tanh',
])
const LIMIT_OPS = new Set(['lim', 'liminf', 'limsup', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'Pr'])
const ROMAN_NAMES = new Set([
  'Aut', 'Hom', 'End', 'Gal', 'Spec', 'Im', 'im', 'Re', 'id', 'Id', 'tr', 'Tr', 'rank', 'rk', 'span', 'Span', 'char', 'sgn', 'sign', 'ord',
  'GL', 'SL', 'PGL', 'PSL', 'SO', 'SU', 'Sp', 'Sym', 'Alt', 'Inn', 'Out', 'Stab', 'Orb', 'Fix', 'lcm', 'mod', 'Var', 'Cov', 'poly', 'polylog',
  'coker', 'Ext', 'Tor', 'Ann', 'Frac', 'Res', 'Ind', 'diag', 'supp', 'vol', 'Area', 'dist', 'diam', 'Tr', 'adj', 'Mat', 'Ker',
])

/** Mathematical Alphanumeric Symbols block (𝑥, 𝔽, 𝓒 …), as produced by Word / Unicode math fonts. */
function alphanumeric(cp: number): string | null {
  if (cp >= 0x1d7ce && cp <= 0x1d7ff) {
    const off = cp - 0x1d7ce
    const d = String(off % 10)
    return Math.floor(off / 10) === 1 ? `\\mathbb{${d}}` : d
  }
  if (cp < 0x1d400 || cp > 0x1d6a3) return null
  const off = cp - 0x1d400
  const style = Math.floor(off / 52)
  const i = off % 52
  const ch = i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(97 + i - 26)
  const wrap = ['\\mathbf', '', '\\boldsymbol', '\\mathcal', '\\mathcal', '\\mathfrak', '\\mathbb', '\\mathfrak', '\\mathsf', '\\mathsf', '\\mathsf', '\\mathsf', '\\mathtt'][style]
  return wrap ? `${wrap}{${ch}}` : ch
}

/**
 * cmex10 by character code: what the glyph is, and its depth below the baseline in em (TeX hangs these
 * glyphs from the baseline, so the text layer reports them a long way above the formula's axis).
 */
function exGlyph(code: number): { latex: string; depth: number } {
  const delims = ['(', ')', '[', ']', '\\lfloor', '\\rfloor', '\\lceil', '\\rceil', '\\{', '\\}', '\\langle', '\\rangle', '|', '\\|', '/', '\\backslash']
  if (code <= 0x0f) return { latex: delims[code], depth: 1.2 }
  if (code <= 0x11) return { latex: delims[code - 0x10], depth: 1.8 }
  if (code <= 0x1f) return { latex: ['(', ')', '[', ']', '\\lfloor', '\\rfloor', '\\lceil', '\\rceil', '\\{', '\\}', '\\langle', '\\rangle', '/', '\\backslash'][code - 0x12] ?? '', depth: 2.4 }
  if (code <= 0x2d) return { latex: ['(', ')', '[', ']', '\\lfloor', '\\rfloor', '\\lceil', '\\rceil', '\\{', '\\}', '\\langle', '\\rangle', '/', '\\backslash'][code - 0x20] ?? '', depth: 3 }
  if (code >= 0x46 && code <= 0x61) {
    const ops = ['\\bigsqcup', '\\oint', '\\bigodot', '\\bigoplus', '\\bigotimes']
    if (code < 0x50) return { latex: ops[(code - 0x46) >> 1], depth: code % 2 ? 1.4 : 1 }
    if (code >= 0x60) return { latex: '\\coprod', depth: code === 0x61 ? 1.4 : 1 }
    const big = ['\\sum', '\\prod', '\\int', '\\bigcup', '\\bigcap', '\\biguplus', '\\bigwedge', '\\bigvee']
    const display = code >= 0x58
    const name = big[(code - 0x50) % 8]
    return { latex: name, depth: name === '\\int' ? (display ? 2.22 : 1.11) : display ? 1.4 : 1 }
  }
  if (code >= 0x68 && code <= 0x6f) return { latex: ['[', ']', '\\lfloor', '\\rfloor', '\\lceil', '\\rceil', '\\{', '\\}'][code - 0x68], depth: 1.8 }
  if (code >= 0x70 && code <= 0x73) return { latex: '\\sqrt', depth: [1, 1.6, 2.2, 2.8][code - 0x70] }
  // Extensible pieces of tall delimiters and accents carry no meaning on their own.
  return { latex: '', depth: 1 }
}

function glyphLatex(ch: string, role: Role): string {
  const cp = ch.codePointAt(0) ?? 0
  if (role === 'ex' && cp < 0x80) return exGlyph(cp).latex
  if (role === 'arrow') return '\\to'
  // cmsy's \mapstochar (code 0x37) is the bar of ↦; tidyLatex joins it with the arrow after it.
  if (role === 'symbol' && ch === '7') return '\\mapstochar'
  if (role === 'symbol' && ch === '\\') return '\\setminus'
  const alnum = alphanumeric(cp)
  if (alnum) return alnum
  const isUpper = ch >= 'A' && ch <= 'Z'
  const isLetter = isUpper || (ch >= 'a' && ch <= 'z')
  if (isLetter) {
    if (role === 'symbol' && isUpper) return `\\mathcal{${ch}}`
    if (role === 'bb') return ch === 'k' ? '\\Bbbk' : `\\mathbb{${ch}}`
    if (role === 'frak') return `\\mathfrak{${ch}}`
    if (role === 'script') return `\\mathscr{${ch}}`
    if (role === 'mathbold') return `\\boldsymbol{${ch}}`
    return ch
  }
  if (GREEK[ch]) return role === 'mathbold' ? `\\boldsymbol{\\${GREEK[ch]}}` : `\\${GREEK[ch]}`
  return SYMBOLS[ch] ?? ch
}

/** A text-font word inside math: digits/operators pass through, names become \log or \mathrm{Aut}. */
function wordLatex(word: string, role: Role): string {
  let out = ''
  for (const m of word.matchAll(/[A-Za-z]+|[^A-Za-z]/g)) {
    const w = m[0]
    if (/^[A-Za-z]+$/.test(w)) {
      if (OPERATORS.has(w)) out += `\\${w}`
      else if (role === 'bold') out += `\\mathbf{${w}}`
      else if (role === 'mono') out += `\\mathtt{${w}}`
      else if (role === 'italic') out += w
      else out += `\\mathrm{${w}}`
    } else out += glyphLatex(w, role === 'bold' ? 'text' : role)
  }
  return out
}

// ───────────────────────── layout ─────────────────────────

interface Atom {
  s: string
  role: Role
  x: number
  x2: number
  y: number
  size: number
  /** Whitespace separated it from the glyph before it in the same run. */
  spaced?: boolean
}

interface Elem {
  atom: Atom
  sup: Atom[]
  sub: Atom[]
  math: boolean
}

const SCRIPT_RATIO = 0.86
const SUPERSCRIPT_DIGITS: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '∗': '*', '*': '*', '†': '†', '‡': '‡' }

/** Text runs split into words; math runs into single glyphs (positions interpolated across the run). */
function toAtoms(runs: GlyphRun[]): Atom[] {
  const atoms: Atom[] = []
  for (const r of runs) {
    if (!r.str || !r.str.trim()) continue
    const role = fontRole(r.font)
    const chars = [...r.str]
    const per = chars.length ? r.width / chars.length : 0
    const pieces: Array<{ s: string; i: number }> = []
    if (isTextRole(role)) {
      let i = 0
      for (const w of r.str.split(/(\s+)/)) {
        const len = [...w].length
        if (w.trim()) for (const part of splitPunct(w)) pieces.push({ s: part.s, i: i + part.i })
        i += len
      }
    } else {
      chars.forEach((c, i) => {
        if (c.trim()) pieces.push({ s: c, i })
      })
    }
    for (const p of pieces) {
      const len = [...p.s].length
      const spaced = p.i > 0 && /\s/.test(chars[p.i - 1])
      const size = r.size || 10
      const cp = p.s.codePointAt(0) ?? 0
      // Big operators and delimiters: report them on the baseline of the formula they belong to (axis = 0.25em).
      // cmsy's √ hangs from its top edge too; the radicand's baseline is 0.72em below it.
      const y = role === 'ex' && cp < 0x80 ? r.y - (exGlyph(cp).depth * size) / 2 - size * 0.25 : role === 'symbol' && p.s === '√' ? r.y - size * 0.72 : r.y
      atoms.push({ s: p.s, role, x: r.x + p.i * per, x2: r.x + (p.i + len) * per, y, size, spaced })
    }
  }
  return atoms
}

/** "(16)," → "(", "16", ")", ","; brackets and trailing punctuation become their own atoms. */
function splitPunct(w: string): Array<{ s: string; i: number }> {
  if (/^[()[\]{}.,;:!?]+$/.test(w)) return [...w].map((s, i) => ({ s, i }))
  const m = /^([([{“‘"]*)(.*?)([)\]}”’".,;:!?]*)$/u.exec(w)
  if (!m) return [{ s: w, i: 0 }]
  const out: Array<{ s: string; i: number }> = []
  let i = 0
  for (const c of m[1]) out.push({ s: c, i: i++ })
  if (m[2]) {
    out.push({ s: m[2], i })
    i += [...m[2]].length
  }
  for (const c of m[3]) out.push({ s: c, i: i++ })
  return out
}

interface Row {
  atoms: Atom[]
  y: number
  size: number
}

/**
 * Groups atoms into lines. Full-size glyphs first; scripts then join the nearest line they sit beside,
 * reaching further than half a line (the limits of an inline ∫ do).
 */
function toRows(atoms: Atom[]): Row[] {
  const rows: Row[] = []
  const sizes = atoms.map((a) => a.size).sort((a, b) => a - b)
  const body = sizes[Math.floor(sizes.length / 2)] ?? 10
  const isScript = (a: Atom) => a.size < body * SCRIPT_RATIO
  for (const a of atoms.filter((a) => !isScript(a))) {
    let best: Row | null = null
    let bestD = Infinity
    for (const r of rows) {
      const d = Math.abs(r.y - a.y)
      if (d < Math.max(2, Math.max(r.size, a.size) * 0.5) && d < bestD) {
        best = r
        bestD = d
      }
    }
    if (!best) rows.push({ atoms: [a], y: a.y, size: a.size })
    else {
      best.atoms.push(a)
      if (a.size > best.size * 1.05) {
        best.size = a.size
        best.y = a.y
      }
    }
  }
  // Touching scripts move together (2^{O(√n log n)} is one group); a group joins the line beside its first glyph.
  const groups = touchingGroups(atoms.filter(isScript), atoms.filter((a) => !isScript(a)))
  const pending: Atom[] = []
  for (const g of groups) {
    const first = g.reduce((p, q) => (q.x < p.x ? q : p))
    let best: Row | null = null
    let bestD = Infinity
    for (const r of rows) {
      const d = Math.abs(r.y - first.y)
      const beside = r.atoms.some((b) => first.x < b.x2 + r.size * 1.5 && first.x2 > b.x - r.size * 1.5)
      if (d < r.size * (beside ? 0.75 : 0.3) && d < bestD) {
        best = r
        bestD = d
      }
    }
    if (best) best.atoms.push(...g)
    else pending.push(...g)
  }
  // Content order breaks ties between glyphs at the same x (the slash of ≠ before its =).
  const order = new Map(atoms.map((a, i) => [a, i]))
  for (const r of rows) r.atoms.sort((p, q) => order.get(p)! - order.get(q)!)
  pending.sort((p, q) => order.get(p)! - order.get(q)!)
  // What's left is small type of its own (footnotes, the limits over a displayed ∑): lines at its own size.
  const strays = pending.length && pending.length < atoms.length ? toRows(pending) : pending.map((a) => ({ atoms: [a], y: a.y, size: a.size }))
  return [...rows, ...strays].sort((a, b) => b.y - a.y)
}

/** Glyphs that touch (side by side, about level) in groups: one subscript, one limit, one exponent. */
function touchingGroups(atoms: Atom[], barriers: Atom[] = []): Atom[][] {
  const groups: Atom[][] = []
  // Nothing full-size in between: the limit 0.4N of ∑ and the N of the \binom after it stay apart.
  const between = (a: Atom, b: Atom) => barriers.some((c) => (c.x + c.x2) / 2 > Math.min(a.x2, b.x2) && (c.x + c.x2) / 2 < Math.max(a.x, b.x))
  for (const a of [...atoms].sort((p, q) => p.x - q.x)) {
    const touching = groups.filter((g) => g.some((b) => Math.abs(b.y - a.y) < Math.max(a.size, b.size) * 0.75 && a.x < b.x2 + a.size * 0.5 && a.x2 > b.x - a.size * 0.5 && !between(a, b)))
    const merged = [a, ...touching.flat()]
    for (const g of touching) groups.splice(groups.indexOf(g), 1)
    groups.push(merged)
  }
  const order = new Map(atoms.map((a, i) => [a, i]))
  return groups.map((g) => g.sort((p, q) => order.get(p)! - order.get(q)!))
}

/** The operator a group of limit glyphs sits over, under or beside: horizontally touching, vertically closest. */
function groupOp(g: Atom[], ops: Atom[]): Atom | undefined {
  let best: Atom | undefined
  let bestD = Infinity
  for (const a of g)
    for (const o of ops) {
      if (a.x >= o.x2 + o.size * 0.3 || a.x2 <= o.x - o.size * 0.3) continue
      const d = Math.abs(a.y - o.y)
      if (d < bestD) {
        best = o
        bestD = d
      }
    }
  return best
}

/** Attaches smaller, raised/lowered atoms to the base before them. */
function toElems(atoms: Atom[], mainSize: number): Elem[] {
  const sorted = [...atoms].sort((a, b) => a.x - b.x)
  const big = sorted.filter((a) => a.size >= mainSize * SCRIPT_RATIO)
  const ys = big.map((a) => a.y).sort((a, b) => a - b)
  const baseline = ys.length ? ys[Math.floor(ys.length / 2)] : (sorted[0]?.y ?? 0)
  const out: Elem[] = []
  // Scripts under or over lim / max / ∑ belong to it even when they start a little to its left.
  const limitOps = sorted.filter((b) => b.size >= mainSize * SCRIPT_RATIO && ((b.role === 'ex' && b.x2 - b.x > b.size * 0.3) || (isTextRole(b.role) && LIMIT_OPS.has(b.s))))
  const limitOf = new Map<Atom, { op: Atom; up: boolean }>()
  for (const g of touchingGroups(sorted.filter((a) => a.size < mainSize * SCRIPT_RATIO), sorted.filter((a) => a.size >= mainSize * SCRIPT_RATIO))) {
    const op = groupOp(g, limitOps)
    const first = g.reduce((p, q) => (q.x < p.x ? q : p))
    if (op && Math.abs(first.y - op.y) > mainSize * 0.08) for (const a of g) limitOf.set(a, { op, up: first.y > op.y })
  }
  for (const a of sorted) {
    if (limitOf.has(a)) continue
    const off = a.y - baseline
    const small = a.size < mainSize * SCRIPT_RATIO
    const prev = out[out.length - 1]
    // A script on a script (the 2 of WOW_{n²}) can land back on the baseline; it still belongs to the scripts it touches.
    const glued = small && prev && (prev.sup.length || prev.sub.length) && a.x - lastX(prev) < mainSize * 0.3
    const script = small && (Math.abs(off) > mainSize * 0.08 || glued)
    if (!script) {
      out.push({ atom: a, sup: [], sub: [], math: false })
      continue
    }
    let base = out[out.length - 1]
    let up = off > 0
    if (glued && base && Math.abs(off) <= mainSize * 0.08) {
      const near = (list: Atom[]) => (list.length ? Math.abs(list[list.length - 1].y - a.y) : Infinity)
      up = near(base.sup) < near(base.sub)
    }
    // Measured from the script already started on that side, else from the base glyph itself (a script starts
    // right at its base; one that starts a space later is a prescript or half of an inline fraction).
    const side = base ? (up ? base.sup : base.sub) : []
    // (A stack with no base, like an inline fraction, is measured from its far edge.)
    const gap = side.length ? a.x - Math.max(...side.map((s) => s.x2)) : base ? a.x - (base.atom.s ? base.atom.x2 : lastX(base)) : Infinity
    const limit = side.length ? mainSize * 0.6 : mainSize * 0.3
    if (!base || gap > limit) {
      base = { atom: { s: '', role: a.role, x: a.x, x2: a.x, y: baseline, size: mainSize }, sup: [], sub: [], math: false }
      out.push(base)
    }
    ;(up ? base.sup : base.sub).push(a)
  }
  for (const a of sorted) {
    const lim = limitOf.get(a)
    if (!lim) continue
    const el = out.find((e) => e.atom === lim.op)!
    ;(lim.up ? el.sup : el.sub).push(a)
  }
  // Raised and lowered glyphs stacked over each other with no base: an inline \frac{num}{den}.
  for (const e of out) {
    if (e.atom.s || !e.sup.length || !e.sub.length) continue
    const [ul, ur] = [Math.min(...e.sup.map((a) => a.x)), Math.max(...e.sup.map((a) => a.x2))]
    const [dl, dr] = [Math.min(...e.sub.map((a) => a.x)), Math.max(...e.sub.map((a) => a.x2))]
    if (ul >= dr || dl >= ur) continue
    const part = (atoms: Atom[]) => {
      const sz = Math.max(...atoms.map((a) => a.size))
      return elems2latex(toElems(atoms, sz), sz, true)
    }
    e.atom = { ...e.atom, s: `\\frac{${part(e.sup)}}{${part(e.sub)}}`, role: 'raw', x: Math.min(ul, dl), x2: Math.max(ur, dr) }
    e.sup = []
    e.sub = []
  }
  // A label over an arrowhead (the label sits over the shaft, so it comes first): \xrightarrow{label}.
  for (let i = out.length - 2; i >= 0; i--) {
    const label = out[i]
    const arrow = out[i + 1]
    if (label.atom.s || !label.sup.length || label.sub.length || arrow.atom.role !== 'arrow') continue
    // Label glyphs that run past the arrowhead's left edge got attached to the arrowhead itself.
    const glyphs = [...label.sup, ...arrow.sup]
    const sz = Math.max(...glyphs.map((a) => a.size))
    const s = `\\xrightarrow{${elems2latex(toElems(glyphs, sz), sz, true)}}`
    arrow.atom = { ...arrow.atom, s, role: 'raw', x: label.atom.x }
    arrow.sup = []
    out.splice(i, 1)
  }
  return out
}

function lastX(e: Elem) {
  return Math.max(e.atom.x2, ...e.sup.map((a) => a.x2), ...e.sub.map((a) => a.x2))
}

const MATH_CAPABLE = /^[0-9.,;:=+\-−()[\]/<>!|'*]+$/
const OPEN_FN = /^[A-Za-z]+\($/

function scriptIsFootnote(e: Elem): boolean {
  if (!isTextRole(e.atom.role) || e.sub.length || !e.sup.length) return false
  if (e.atom.s && !/[A-Za-z.,;:!?'’”]$/.test(e.atom.s)) return false
  return e.sup.every((a) => isTextRole(a.role) && [...a.s].every((c) => SUPERSCRIPT_DIGITS[c]))
}

function scriptIsText(e: Elem): boolean {
  // The A in the LaTeX logo, \textsuperscript{th}: letters in a text font, raised, after a text word.
  return isTextRole(e.atom.role) && /[A-Za-z]$/.test(e.atom.s) && [...e.sup, ...e.sub].every((a) => isTextRole(a.role) && /^[A-Za-z]+$/.test(a.s))
}

/** Decides which elements are math, pulling digits, =, ( ) and operator names in next to math glyphs. */
function classify(elems: Elem[], size: number) {
  for (const e of elems) {
    if (!isTextRole(e.atom.role)) e.math = true
    else if (e.sup.length || e.sub.length) {
      if (scriptIsFootnote(e)) {
        e.atom = { ...e.atom, s: e.atom.s + e.sup.map((a) => [...a.s].map((c) => SUPERSCRIPT_DIGITS[c]).join('')).join('') }
        e.sup = []
      } else if (scriptIsText(e)) {
        e.atom = { ...e.atom, s: e.atom.s + [...e.sup, ...e.sub].map((a) => a.s).join('') }
        e.sup = []
        e.sub = []
      } else e.math = true
    }
  }
  // An arrowhead's shaft is a rule, not text, so it reaches back further than its glyph.
  const arrow = (e: Elem) => e.atom.role === 'arrow' || e.atom.s.startsWith('\\xrightarrow')
  const near = (a: Elem, b: Elem) => {
    const gap = b.atom.x - lastX(a)
    return gap < size * (arrow(a) || arrow(b) ? 3 : 0.9)
  }
  let changed = true
  while (changed) {
    changed = false
    elems.forEach((e, i) => {
      if (e.math) return
      const prev = elems[i - 1]
      const next = elems[i + 1]
      // A colon or full stop followed by a space ends a clause, not a formula ("$n$): (a) $n$"). Commas are
      // ambiguous: TeX's thin space after a comma in math often comes through as a space too.
      // The dots of ". . ." are spaced out but aren't full stops.
      const dots = (k: number) => elems[k]?.atom.s === '.' && (elems[k - 1]?.atom.s === '.' || elems[k + 1]?.atom.s === '.')
      const stop = (k: number) => isTextRole(elems[k].atom.role) && /^[.;:!?]$/.test(elems[k].atom.s) && elems[k + 1]?.atom.spaced && !dots(k)
      const left = prev?.math && near(prev, e) && !stop(i - 1)
      const right = next?.math && near(e, next) && !stop(i)
      const w = e.atom.s
      if (!left && !right) return
      if (MATH_CAPABLE.test(w) || ((OPERATORS.has(w) || ROMAN_NAMES.has(w)) && (left || right)) || (OPEN_FN.test(w) && right)) {
        e.math = true
        changed = true
      }
    })
  }
  joinTightRuns(elems, size)
}

/**
 * Words set tight against math on both ends ({AND, OR, Exactly₀} is one formula: math commas are followed
 * by a thin space, text by a full one) join the formula.
 */
function joinTightRuns(elems: Elem[], size: number) {
  for (let i = 0; i < elems.length; ) {
    let j = i + 1
    while (j < elems.length && !elems[j].atom.spaced && elems[j].atom.x - lastX(elems[j - 1]) < size * 0.25) j++
    const run = elems.slice(i, j)
    if (run.length > 2 && run[0].math && run[run.length - 1].math && run.every((e) => e.math || /^[A-Za-z]+$|^[.,;:]$/.test(e.atom.s))) for (const e of run) e.math = true
    i = j
  }
}

function elemLatex(e: Elem): string {
  let base: string
  if (e.atom.role === 'raw') base = e.atom.s
  else if (isTextRole(e.atom.role)) base = wordLatex(e.atom.s, e.atom.role)
  else base = [...e.atom.s].map((c) => glyphLatex(c, e.atom.role)).join('')
  const script = (atoms: Atom[]) => {
    if (!atoms.length) return ''
    const sz = Math.max(...atoms.map((a) => a.size))
    const inner = elems2latex(toElems(atoms, sz), sz, true)
    if (/^(\\prime)+$/.test(inner)) return inner
    return [...inner].length === 1 ? inner : `{${inner}}`
  }
  let out = base
  const sub = script(e.sub)
  const sup = script(e.sup)
  if (sub) out += `_${sub}`
  if (sup) out += /^(\\prime)+$/.test(sup) ? "'".repeat(sup.length / 6) : `^${sup}`
  return out
}

function elems2latex(elems: Elem[], size: number, all = false): string {
  if (all) for (const e of elems) e.math = true
  let out = ''
  let prev: Elem | null = null
  for (const e of elems) {
    const piece = elemLatex(e)
    if (!piece) continue
    if (prev) {
      const gap = e.atom.x - lastX(prev)
      const needs = /\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(piece)
      if (needs || gap > size * 0.18) out += ' '
    }
    out += piece
    prev = e
  }
  return tidyLatex(out)
}

function tidyLatex(s: string): string {
  return s
    .replace(/\\not\s*=/g, '\\neq ')
    .replace(/\\not\s*\\in\b/g, '\\notin')
    .replace(/\\mapstochar\s*\\to\b/g, '\\mapsto')
    .replace(/\\mapstochar\s*\\longrightarrow\b/g, '\\longmapsto')
    .replace(/\\mapstochar\s*/g, '')
    .replace(/\.\s*\.\s*\./g, '\\ldots')
    .replace(/\\ldots\s*\./g, '\\ldots')
    .replace(/\\cdot\s*\\cdot\s*\\cdot/g, '\\cdots')
    .replace(/\\sqrt\s+(\S)/g, '\\sqrt $1')
    .replace(/\(\s*_(\{[^{}]*\}|[^{}\s])\^(\{[^{}]*\}|[^{}\s])\s*\)/g, (_, k, n) => `\\binom{${n.replace(/^\{|\}$/g, '')}}{${k.replace(/^\{|\}$/g, '')}}`)
    .replace(/ {2,}/g, ' ')
    .replace(/(\\[A-Za-z]+) (?=[}_^])/g, '$1')
    .replace(/\s+$/, '')
}

function escapeText(s: string): string {
  return s.replace(/\\/g, '\\textbackslash ').replace(/\$/g, '\\$').replace(/\bLATEX\b/g, 'LaTeX').replace(/\bTEX\b/g, 'TeX')
}

/** Splits leading "(" and trailing ")" / punctuation that don't belong to the formula back into the text. */
function trimSpan(elems: Elem[]): { lead: Elem[]; body: Elem[]; tail: Elem[] } {
  const body = [...elems]
  const lead: Elem[] = []
  const tail: Elem[] = []
  const text = (e: Elem) => isTextRole(e.atom.role) && !e.sup.length && !e.sub.length
  const count = (ch: string) => body.reduce((n, e) => n + [...e.atom.s].filter((c) => c === ch).length, 0)
  const PAIRS: Record<string, string> = { ')': '(', ']': '[' }
  const OPENS: Record<string, string> = { '(': ')', '[': ']' }
  for (;;) {
    const last = body[body.length - 1]
    if (!last || !text(last)) break
    const s = last.atom.s
    if (/^[.,;:!?]+$/.test(s) || OPENS[s] || (PAIRS[s] && count(s) > count(PAIRS[s]))) tail.unshift(body.pop()!)
    else break
  }
  for (;;) {
    const first = body[0]
    if (!first || !text(first)) break
    const s = first.atom.s
    if (PAIRS[s] || /^[.,;:!?]+$/.test(s) || (OPENS[s] && count(s) > count(OPENS[s]))) lead.push(body.shift()!)
    else break
  }
  return { lead, body, tail }
}

interface RenderedRow {
  text: string
  display: boolean
  y: number
  size: number
  left: number
}

function renderRow(row: Row, block: { left: number; right: number }): RenderedRow {
  const elems = toElems(row.atoms, row.size)
  classify(elems, row.size)
  const left = Math.min(...row.atoms.map((a) => a.x))
  const right = Math.max(...row.atoms.map((a) => a.x2))
  const words = elems.filter((e) => !(isTextRole(e.atom.role) && /^[.,;:]$/.test(e.atom.s)))
  const allMath = words.length >= 2 && words.every((e) => e.math)
  const width = block.right - block.left
  const centered = Math.abs((left + right) / 2 - (block.left + block.right) / 2) < width * 0.12 && left > block.left + row.size * 2
  if (allMath && centered) {
    return { text: elems2latex(elems, row.size), display: true, y: row.y, size: row.size, left }
  }
  let out = ''
  let prevEnd: number | null = null
  const push = (s: string, start: number, end: number) => {
    if (!s) return
    const footnote = /^[⁰¹²³⁴⁵⁶⁷⁸⁹*†‡]+$/.test(s)
    if (prevEnd != null && out && !footnote && start - prevEnd > row.size * 0.15 && !/\s$/.test(out)) out += ' '
    out += s
    prevEnd = end
  }
  for (let i = 0; i < elems.length; ) {
    const e = elems[i]
    if (!e.math) {
      push(escapeText(e.atom.s), e.atom.x, lastX(e))
      i++
      continue
    }
    let j = i
    while (j < elems.length && elems[j].math) j++
    const { lead, body, tail } = trimSpan(elems.slice(i, j))
    for (const l of lead) push(escapeText(l.atom.s), l.atom.x, lastX(l))
    if (body.length) push(`$${elems2latex(body, row.size)}$`, body[0].atom.x, lastX(body[body.length - 1]))
    for (const t of tail) push(escapeText(t.atom.s), t.atom.x, lastX(t))
    i = j
  }
  return { text: out, display: false, y: row.y, size: row.size, left }
}

const RELATION = /^(=|<|>|≤|≥|≠|→|←|↦|⇒|⇐|⇔|∈|⊂|⊆|⊃|⊇|≅|≡|∼|≃|≈|:=)$/

/**
 * A displayed formula spread over several lines of the text layer (fractions put numerator and denominator
 * above and below the main baseline) → one LaTeX expression.
 */
function layout2d(atoms: Atom[], size: number): string {
  const linear = () => elems2latex(toElems(atoms, size), size, true)
  const full = atoms.filter((a) => a.size >= size * SCRIPT_RATIO)
  const levels: number[] = []
  for (const a of [...full].sort((a, b) => b.y - a.y)) {
    if (!levels.length || levels[levels.length - 1] - a.y > size * 0.3) levels.push(a.y)
  }
  if (levels.length < 2) return linear()
  const levelOf = (y: number) => levels.reduce((best, l) => (Math.abs(l - y) < Math.abs(best - y) ? l : best), levels[0])
  const relations = (l: number) => full.filter((a) => levelOf(a.y) === l && RELATION.test(a.s)).length
  let main: number | null = [...levels].sort((a, b) => relations(b) - relations(a))[0]
  if (!relations(main)) main = levels.length >= 3 ? levels[Math.floor(levels.length / 2)] : null
  // Scripts under or over a big operator are its limits; other scripts belong to the nearest line.
  const ops = full.filter((a) => (a.role === 'ex' && a.x2 - a.x > size * 0.5) || (isTextRole(a.role) && LIMIT_OPS.has(a.s)))
  const home = new Map<Atom, number>()
  for (const a of full) home.set(a, levelOf(a.y))
  for (const g of touchingGroups(atoms.filter((a) => a.size < size * SCRIPT_RATIO), full)) {
    const op = groupOp(g, ops)
    for (const a of g) home.set(a, op ? levelOf(op.y) : levelOf(a.y))
  }
  if (main === null) {
    const upper = levels[0]
    const num = atoms.filter((a) => home.get(a) === upper)
    const den = atoms.filter((a) => home.get(a) !== upper)
    return `\\frac{${layout2d(num, size)}}{${layout2d(den, size)}}`
  }
  const mainLevel = main
  const above = atoms.filter((a) => home.get(a)! > mainLevel + size * 0.3)
  const below = atoms.filter((a) => home.get(a)! < mainLevel - size * 0.3)
  const runs = (list: Atom[]) => {
    const out: Atom[][] = []
    for (const a of [...list].sort((p, q) => p.x - q.x)) {
      const last = out[out.length - 1]
      if (last && a.x - Math.max(...last.map((b) => b.x2)) < size * 1.2) last.push(a)
      else out.push([a])
    }
    return out
  }
  const span = (list: Atom[]) => [Math.min(...list.map((a) => a.x)), Math.max(...list.map((a) => a.x2))]
  const used = new Set<Atom>()
  const pieces: Atom[] = atoms.filter((a) => home.get(a) === mainLevel)
  const lowerRuns = runs(below)
  for (const num of runs(above)) {
    const [l, r] = span(num)
    const den = lowerRuns.filter((d) => {
      const [dl, dr] = span(d)
      return dl < r && dr > l
    })
    if (!den.length) continue
    const denAtoms = den.flat()
    for (const a of [...num, ...denAtoms]) used.add(a)
    const [fl, fr] = span([...num, ...denAtoms])
    pieces.push({ s: `\\frac{${layout2d(num, size)}}{${layout2d(denAtoms, size)}}`, role: 'raw', x: fl, x2: fr, y: mainLevel, size })
  }
  // Whatever didn't pair up stays where it is.
  for (const a of [...above, ...below]) if (!used.has(a)) pieces.push(a)
  return elems2latex(toElems(pieces, size), size, true)
}

/** Every element is math, or a digit/bracket/operator that could be (a numerator "1" on its own line). */
function mathOnly(row: Row): boolean {
  const elems = toElems(row.atoms, row.size)
  classify(elems, row.size)
  return elems.every((e) => e.math || MATH_CAPABLE.test(e.atom.s))
}

/** A row of script-size glyphs sitting over/under a big operator (∑, ∏, ∫) of a neighbouring row: its limits. */
function limitsOf(row: Row, others: Row[]): boolean {
  const ops = others.flatMap((r) => r.atoms).filter((a) => a.role === 'ex' && a.x2 - a.x > a.size * 0.3)
  if (!ops.length || row.atoms.some((a) => a.size >= row.size * SCRIPT_RATIO && a.role !== 'ex' && a.size >= ops[0].size * SCRIPT_RATIO)) return false
  return row.atoms.every((a) => ops.some((o) => (a.x + a.x2) / 2 >= o.x - o.size * 0.3 && (a.x + a.x2) / 2 <= o.x2 + o.size * 0.8))
}

/** Runs of consecutive math-only rows closer together than lines of text: one displayed formula. */
function displayClusters(rows: Row[]): Row[][] {
  const out: Row[][] = []
  for (const row of rows) {
    const last = out[out.length - 1]
    const prev = last?.[last.length - 1]
    const span = (rs: Row[]) => [Math.min(...rs.flatMap((r) => r.atoms.map((a) => a.x))), Math.max(...rs.flatMap((r) => r.atoms.map((a) => a.x2)))]
    // Overlapping, or side by side (a fraction right after "P := lim").
    const overlaps = prev && span(last)[0] < span([row])[1] + row.size * 2 && span([row])[0] < span(last)[1] + row.size * 2
    const gap = prev ? prev.y - row.y : Infinity
    const close = gap < Math.max(prev?.size ?? 0, row.size) * 0.95 || (gap < Math.max(prev?.size ?? 0, row.size) * 1.7 && (limitsOf(prev!, [row]) || limitsOf(row, last)))
    if (prev && overlaps && close && mathOnly(prev) && mathOnly(row)) last.push(row)
    else out.push([row])
  }
  return out
}

/** True when at least one run uses a recognizable TeX math font (the reconstruction is worth doing). */
export function hasMathFonts(runs: GlyphRun[]): boolean {
  return runs.some((r) => r.str.trim() && !isTextRole(fontRole(r.font)))
}

/** One page of glyph runs → Markdown text with $…$ / $$…$$ math, lines in reading order. */
export function runsToMarkdown(runs: GlyphRun[]): string {
  const rows = toRows(toAtoms(runs))
  if (!rows.length) return ''
  const lefts = rows.map((r) => Math.min(...r.atoms.map((a) => a.x))).sort((a, b) => a - b)
  const rights = rows.map((r) => Math.max(...r.atoms.map((a) => a.x2))).sort((a, b) => a - b)
  const block = { left: lefts[Math.floor(lefts.length * 0.1)] ?? 0, right: rights[Math.floor(rights.length * 0.9)] ?? 0 }
  const lines: string[] = []
  let prev: RenderedRow | null = null
  for (const cluster of displayClusters(rows)) {
    const row = cluster[0]
    const r: RenderedRow =
      cluster.length > 1
        ? {
            text: layout2d(cluster.flatMap((c) => c.atoms), Math.max(...cluster.map((c) => c.size))),
            display: true,
            y: cluster[cluster.length - 1].y,
            size: row.size,
            left: Math.min(...cluster.flatMap((c) => c.atoms.map((a) => a.x))),
          }
        : renderRow(row, block)
    if (prev) {
      const gap = prev.y - r.y
      if (r.display || prev.display || gap > Math.max(prev.size, r.size) * 1.9) lines.push('')
    }
    if (r.display) lines.push('$$', r.text, '$$')
    else lines.push(r.text.replace(/\s+$/, '').replace(/\$ ([.,;:)\]])(?=\s|$|[.,;:])/g, '$$$1'))
    prev = r
  }
  return joinBrokenFormulas(lines).join('\n').replace(/\n{3,}/g, '\n\n')
}

/** Inline math that TeX broke after an operator ("… $T =$" / "$604, 800$ seconds") becomes one formula. */
function joinBrokenFormulas(lines: string[]): string[] {
  const out = [...lines]
  for (let i = 0; i + 1 < out.length; i++) {
    const end = /\$([^$]*?(?:[=+\-<>,]|\\(?:le|ge|to|times|cdot|in|subset|subseteq|cup|cap|neq|approx|equiv|sim|cong|mapsto|Rightarrow|iff|implies|oplus|otimes|circ|setminus)))\$$/.exec(out[i])
    const start = /^\$([^$]+)\$/.exec(out[i + 1])
    if (!end || !start || out[i + 1] === '$$') continue
    out[i] = `${out[i].slice(0, end.index)}$${end[1]} ${start[1]}$`
    out[i + 1] = out[i + 1].slice(start[0].length).replace(/^\s+/, '')
  }
  return out
}
