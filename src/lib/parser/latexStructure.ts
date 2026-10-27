/**
 * Problem structure in LaTeX sources, detected on the source (not the converted Markdown) so
 * that environments and nested lists can become problems and subproblems directly.
 *
 * Order of preference: problem-like environments → exam-class \question → \problem macros →
 * keyword headings (\section*{Problem 1}, \textbf{Problem 1.}, plain "Problem 1." lines) →
 * a top-level enumerate → generic \section headings.
 */
import { matchKeywordHeading, parseHeadingTail, scoreLabels, type Strength } from './detect'
import { latexInlineText, listStyle, REMOVE_ARGS } from './latex'
import {
  counterLabel,
  enumStyle,
  findEnvEnd,
  matchBrace,
  readArg,
  readOptional,
  skipArgs,
  splitItems,
  stripLatexComments,
} from './latexScan'

export interface LatexSegment {
  label: string
  title: string | null
  /** LaTeX source of the problem body (after the heading). */
  source: string
  /** enumerate nesting depth of the body (decides default subpart labels). */
  enumDepth: number
  /** Exam class: subparts are \part items inside a parts environment. */
  exam: boolean
}

export interface LatexStructure {
  scheme: string
  strength: Strength
  /** LaTeX source before the first problem. */
  preamble: string
  segments: LatexSegment[]
  /** Non-problem source found between/after problems (reported, not silently merged). */
  leftovers: string[]
}

export interface PreparedLatex {
  body: string
  /** Text of \title, \date, header commands … (for metadata guessing). */
  metaLines: string[]
  removedSolutions: number
  hadDocumentEnv: boolean
}

const META_COMMANDS = /\\(title|subtitle|date|author|lhead|chead|rhead|fancyhead|header|firstpageheader|runningheader|hwnum|duedate|course)\*?(?![a-zA-Z@])/g
const DEFINITION_COMMANDS = new Set([
  'documentclass', 'usepackage', 'RequirePackage', 'newcommand', 'renewcommand', 'providecommand',
  'DeclareMathOperator', 'newtheorem', 'theoremstyle', 'newenvironment', 'renewenvironment',
  'title', 'subtitle', 'author', 'date', 'newcounter', 'setcounter', 'setlength', 'definecolor',
  'pagestyle', 'geometry', 'hypersetup', 'lhead', 'chead', 'rhead', 'lfoot', 'cfoot', 'rfoot',
  'fancyhead', 'fancyfoot', 'fancypagestyle', 'firstpageheader', 'runningheader', 'firstpagefooter',
  'runningfooter', 'header', 'footer', 'numberwithin', 'graphicspath', 'lstset', 'usetikzlibrary',
  'hwnum', 'duedate', 'course',
])
const SOLUTION_ENVS = ['solution', 'solution*', 'solutionorbox', 'solutionorlines', 'solutionordottedlines', 'solutionorgrid', 'sol', 'soln']

function collectMetaLines(src: string): string[] {
  const out: string[] = []
  META_COMMANDS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = META_COMMANDS.exec(src))) {
    let j = m.index + m[0].length
    const opt = readOptional(src, j)
    if (opt) j = opt.end
    for (let k = 0; k < 3; k++) {
      const arg = readArg(src, j)
      if (!arg) break
      const text = latexInlineText(arg.content)
      if (text) out.push(text)
      j = arg.end
    }
  }
  return out
}

/** Removes macro definitions and other preamble-only commands (with their arguments). */
function stripDefinitions(src: string): string {
  const re = /\\([a-zA-Z@]+)\*?/g
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    const name = m[1] ?? ''
    if (name === 'def') {
      const end = skipDef(src, m.index + m[0].length)
      out += src.slice(last, m.index)
      last = end
      re.lastIndex = end
    } else if (DEFINITION_COMMANDS.has(name)) {
      const end = skipArgs(src, m.index + m[0].length, REMOVE_ARGS[name] ?? 'm')
      out += src.slice(last, m.index)
      last = end
      re.lastIndex = end
    }
  }
  return out + src.slice(last)
}

function skipDef(src: string, j: number): number {
  let k = j
  while (k < src.length && /\s/.test(src.charAt(k))) k++
  if (src.charAt(k) === '\\') {
    k++
    while (k < src.length && /[a-zA-Z@]/.test(src.charAt(k))) k++
  }
  while (k < src.length && src.charAt(k) !== '{' && src.charAt(k) !== '\n') k++
  if (src.charAt(k) !== '{') return k
  const close = matchBrace(src, k)
  return close < 0 ? src.length : close + 1
}

function removeEnvironments(src: string, names: string[]): { text: string; count: number } {
  let text = src
  let count = 0
  for (const name of names) {
    const re = new RegExp(String.raw`\\begin\s*\{` + name.replace('*', String.raw`\*`) + String.raw`\}`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      const end = findEnvEnd(text, name, m.index + m[0].length)
      const stop = end ? end.end : text.length
      text = text.slice(0, m.index) + text.slice(stop)
      re.lastIndex = m.index
      count++
    }
  }
  return { text, count }
}

/** Strips comments, the preamble (\documentclass … \begin{document}), \end{document}, definitions and solutions. */
export function prepareLatex(raw: string): PreparedLatex {
  const clean = stripLatexComments(raw.replace(/\r\n?/g, '\n').split('\u0000').join(''))
  const metaLines = collectMetaLines(clean)
  const begin = /\\begin\s*\{document\}/.exec(clean)
  let body = begin ? clean.slice(begin.index + begin[0].length) : clean
  const end = /\\end\s*\{document\}/.exec(body)
  if (end) body = body.slice(0, end.index)
  body = stripDefinitions(body)
  const solutions = removeEnvironments(body, SOLUTION_ENVS)
  return { body: solutions.text, metaLines, removedSolutions: solutions.count, hadDocumentEnv: !!begin }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const LABEL_LIKE = /^(?:\d{1,3}(?:\.\d{1,3})?[a-z]?|[A-Z]|[ivx]{1,5}|[a-z])$/

/** Interprets a heading argument such as "3", "Problem 3: Sylow", or "Sylow theorems". */
function interpretHeadingArg(tex: string): { label?: string; title?: string } {
  const t = latexInlineText(tex).replace(/^[([]|[)\].:]$/g, '').trim()
  if (!t) return {}
  if (LABEL_LIKE.test(t)) return { label: t }
  const km = matchKeywordHeading(t)
  if (km && km.valid) {
    const title = km.title ?? (km.rest ? km.rest.replace(/[.:]+$/, '').trim() : '')
    return { label: km.label, ...(title ? { title } : {}) }
  }
  return { title: t }
}

function nonEmpty(sources: string[]): string[] {
  return sources.filter((s) => s.trim().length > 0)
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

const PROBLEM_ENVS = new Set([
  'problem', 'problem*', 'Problem', 'exercise', 'exercise*', 'Exercise', 'question', 'question*', 'prob',
  'hw', 'homework', 'hwproblem', 'homeworkproblem', 'exer', 'task', 'Question',
])

function byProblemEnvs(body: string): LatexStructure | null {
  const re = /\\begin\s*\{([^}]+)\}/g
  const found: Array<{ start: number; contentStart: number; contentEnd: number; after: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const name = (m[1] ?? '').trim()
    if (!PROBLEM_ENVS.has(name)) continue
    const contentStart = m.index + m[0].length
    const end = findEnvEnd(body, name, contentStart)
    const after = end ? end.end : body.length
    found.push({ start: m.index, contentStart, contentEnd: end ? end.start : body.length, after })
    re.lastIndex = after
  }
  if (!found.length) return null
  let counter = 0
  const segments: LatexSegment[] = found.map((f) => {
    let source = body.slice(f.contentStart, f.contentEnd)
    let label: string | undefined
    let title: string | undefined
    const opt = /^[ \t]*\[/.test(source) ? readOptional(source, 0) : null
    if (opt) {
      ;({ label, title } = interpretHeadingArg(opt.content))
      source = source.slice(opt.end)
    }
    const argMatch = /^[ \t]*\{/.exec(source)
    if (argMatch) {
      const arg = readArg(source, 0)
      const parsed = arg ? interpretHeadingArg(arg.content) : {}
      if (arg && parsed.label && !parsed.title) {
        label = parsed.label
        source = source.slice(arg.end)
      }
    }
    counter = label && /^\d+$/.test(label) ? Number(label) : counter + 1
    return { label: label ?? String(counter), title: title ?? null, source, enumDepth: 0, exam: false }
  })
  const leftovers = found.slice(1).map((f, k) => body.slice(found[k]?.after ?? 0, f.start))
  leftovers.push(body.slice(found[found.length - 1]?.after ?? body.length))
  return {
    scheme: 'latex-problem-env',
    strength: 'high',
    preamble: body.slice(0, found[0]?.start ?? 0),
    segments,
    leftovers: nonEmpty(leftovers),
  }
}

/** Splits at macro-style headings (\question, \problem); `parseArgs` consumes the macro's arguments. */
function splitAtMacros(
  body: string,
  re: RegExp,
  parseArgs: (src: string, j: number, name: string) => { end: number; label?: string; title?: string; inlineBody?: string },
): { preamble: string; parts: Array<{ label?: string; title?: string; source: string }> } | null {
  const hits: Array<{ start: number; end: number; label?: string; title?: string; inlineBody?: string }> = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const parsed = parseArgs(body, m.index + m[0].length, m[1] ?? '')
    hits.push({ start: m.index, ...parsed })
    re.lastIndex = Math.max(parsed.end, m.index + m[0].length)
  }
  if (!hits.length) return null
  return {
    preamble: body.slice(0, hits[0]?.start ?? 0),
    parts: hits.map((h, k) => {
      const rest = body.slice(h.end, hits[k + 1]?.start ?? body.length)
      return { label: h.label, title: h.title, source: h.inlineBody !== undefined ? `${h.inlineBody}\n${rest}` : rest }
    }),
  }
}

function byExamQuestions(body: string): LatexStructure | null {
  const split = splitAtMacros(body, /\\(question|titledquestion)(?![a-zA-Z@])/g, (src, j, name) => {
    let k = j
    let title: string | undefined
    if (name === 'titledquestion') {
      const arg = readArg(src, k)
      if (arg) {
        title = latexInlineText(arg.content) || undefined
        k = arg.end
      }
    }
    const pts = readOptional(src, k)
    return { end: pts ? pts.end : k, title }
  })
  if (!split) return null
  const leftovers: string[] = []
  const segments = split.parts.map((p, k) => {
    let source = p.source
    const close = /\\end\s*\{questions\}/.exec(source)
    if (close) {
      leftovers.push(source.slice(close.index + close[0].length))
      source = source.slice(0, close.index)
    }
    return { label: String(k + 1), title: p.title ?? null, source, enumDepth: 0, exam: true }
  })
  return {
    scheme: 'latex-exam',
    strength: 'high',
    preamble: split.preamble.replace(/\\begin\s*\{questions\}/g, ''),
    segments,
    leftovers: nonEmpty(leftovers),
  }
}

function byProblemMacros(body: string): LatexStructure | null {
  const split = splitAtMacros(body, /\\(problem|exercise|prob|hwproblem|homeworkproblem|Problem)(?![a-zA-Z@*])/g, (src, j) => {
    let k = j
    let label: string | undefined
    let title: string | undefined
    let inlineBody: string | undefined
    const opt = readOptional(src, k)
    if (opt) {
      const parsed = interpretHeadingArg(opt.content)
      label = parsed.label
      title = parsed.title
      k = opt.end
    }
    if (/^[ \t]*\{/.test(src.slice(k))) {
      const arg = readArg(src, k)
      if (arg) {
        const content = arg.content.trim()
        if (content.length <= 60 && !content.includes('\n')) {
          const parsed = interpretHeadingArg(content)
          label = parsed.label ?? label
          title = parsed.title ?? title
        } else {
          inlineBody = arg.content
        }
        k = arg.end
      }
    }
    return { end: k, label, title, inlineBody }
  })
  if (!split) return null
  let counter = 0
  const segments = split.parts.map((p) => {
    counter = p.label && /^\d+$/.test(p.label) ? Number(p.label) : counter + 1
    return { label: p.label ?? String(counter), title: p.title ?? null, source: p.source, enumDepth: 0, exam: false }
  })
  return { scheme: 'latex-problem-macro', strength: 'high', preamble: split.preamble, segments, leftovers: [] }
}

interface HeadingHit {
  start: number
  bodyStart: number
  label: string
  title: string | null
  key: string
  tier: 1 | 3
  scheme: string
  style: 'section' | 'bold' | 'plain'
}

/** What may precede a bold/plain heading on its line (spacing commands only). */
const LINE_PREFIX_RE =
  /^[ \t]*(?:\\(?:noindent|medskip|bigskip|smallskip|par|newpage|clearpage|pagebreak)(?![a-zA-Z])[ \t]*|\\vspace\*?\{[^}]*\}[ \t]*|\\vskip[ \t]*[\d.]+[a-z]{2}[ \t]*)*/

function lineStartBefore(body: string, pos: number): number {
  return body.lastIndexOf('\n', pos - 1) + 1
}

function onlySpacingBefore(body: string, pos: number): boolean {
  const prefix = body.slice(lineStartBefore(body, pos), pos)
  return (LINE_PREFIX_RE.exec(prefix)?.[0] ?? '').length === prefix.length
}

/** Parses "(Title)." etc. following a heading command on the same line. */
function headingSuffix(body: string, from: number): { titles: string[]; end: number } {
  const lineEnd = body.indexOf('\n', from)
  const tail = body.slice(from, lineEnd < 0 ? body.length : lineEnd)
  const parsed = parseHeadingTail(tail, false)
  return { titles: parsed.titles.map((t) => latexInlineText(t)).filter(Boolean), end: from + parsed.consumed }
}

function collectHeadingHits(body: string): HeadingHit[] {
  const hits: HeadingHit[] = []
  const add = (start: number, argText: string, after: number, style: HeadingHit['style']) => {
    const km = matchKeywordHeading(argText)
    if (!km || !km.valid || km.scheme === 'markdown-headings') return
    if (style !== 'plain' && km.rest && km.rest.length > 120) return
    const suffix = style === 'plain' ? { titles: [], end: after } : headingSuffix(body, after)
    const restTitle = style !== 'plain' && km.rest ? km.rest.replace(/[.:]+$/, '').trim() : ''
    const title = km.title ?? (suffix.titles.length ? suffix.titles.join(' — ') : restTitle || null)
    hits.push({
      start,
      bodyStart: suffix.end,
      label: km.label,
      title,
      key: `${km.scheme}:${km.family}`,
      tier: km.tier,
      scheme: km.scheme,
      style,
    })
  }

  const sectionRe = /\\(section|subsection|subsubsection|paragraph|subparagraph)\*?\s*(?:\[[^\]]*\])?\s*(?=\{)/g
  let m: RegExpExecArray | null
  while ((m = sectionRe.exec(body))) {
    const arg = readArg(body, m.index + m[0].length)
    if (arg) add(m.index, latexInlineText(arg.content), arg.end, 'section')
  }

  const boldRe = /\\textbf\s*(?=\{)|\{\s*\\(?:bf|bfseries)(?![a-zA-Z])\s*/g
  while ((m = boldRe.exec(body))) {
    if (!onlySpacingBefore(body, m.index)) continue
    if (m[0].startsWith('\\textbf')) {
      const arg = readArg(body, m.index + m[0].length)
      if (arg) add(m.index, latexInlineText(arg.content), arg.end, 'bold')
    } else {
      const close = matchBrace(body, m.index)
      if (close > 0) add(m.index, latexInlineText(body.slice(m.index + m[0].length, close)), close + 1, 'bold')
    }
  }

  const lineRe = /^.*$/gm
  while ((m = lineRe.exec(body))) {
    const line = m[0]
    if (!line.trim()) {
      lineRe.lastIndex++
      continue
    }
    const prefixLen = (LINE_PREFIX_RE.exec(line)?.[0] ?? '').length
    const text = line.slice(prefixLen)
    if (text.startsWith('\\')) continue
    const km = matchKeywordHeading(text)
    if (km && km.valid && km.scheme !== 'markdown-headings') {
      const start = m.index
      const bodyStart = m.index + prefixLen + km.restOffset
      hits.push({
        start,
        bodyStart,
        label: km.label,
        title: km.title ? latexInlineText(km.title) : null,
        key: `${km.scheme}:${km.family}`,
        tier: km.tier,
        scheme: km.scheme,
        style: 'plain',
      })
    }
  }
  return hits.sort((a, b) => a.start - b.start)
}

function byKeywordHeadings(body: string): LatexStructure | null {
  const hits = collectHeadingHits(body)
  if (!hits.length) return null
  const groups = new Map<string, HeadingHit[]>()
  for (const h of hits) groups.set(h.key, [...(groups.get(h.key) ?? []), h])
  let best: HeadingHit[] | null = null
  let bestScore = -1
  for (const tier of [1, 3] as const) {
    for (const g of groups.values()) {
      if (g[0]?.tier !== tier) continue
      const score = scoreLabels(g.map((h) => h.label))
      if (score > bestScore) {
        best = g
        bestScore = score
      }
    }
    if (best) break
  }
  if (!best || !best[0]) return null
  const chosen = best
  const sections = chosen.filter((h) => h.style === 'section').length
  return {
    scheme: sections * 2 >= chosen.length ? 'latex-sections' : chosen[0]?.scheme ?? 'problem-n',
    strength: chosen[0]?.tier === 1 ? 'high' : 'medium',
    preamble: body.slice(0, chosen[0]?.start ?? 0),
    segments: chosen.map((h, k) => ({
      label: h.label,
      title: h.title,
      source: body.slice(h.bodyStart, chosen[k + 1]?.start ?? body.length),
      enumDepth: 0,
      exam: false,
    })),
    leftovers: [],
  }
}

/** Non-nested occurrences of an environment. */
function topLevelEnvs(body: string, name: string): Array<{ start: number; contentStart: number; contentEnd: number; after: number }> {
  const re = new RegExp(String.raw`\\begin\s*\{` + name + String.raw`\}`, 'g')
  const out: Array<{ start: number; contentStart: number; contentEnd: number; after: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const contentStart = m.index + m[0].length
    const end = findEnvEnd(body, name, contentStart)
    const after = end ? end.end : body.length
    out.push({ start: m.index, contentStart, contentEnd: end ? end.start : body.length, after })
    re.lastIndex = after
  }
  return out
}

/** Strips "(a)" / "1." decoration from an explicit \item[...] label. */
function cleanItemLabel(raw: string): string {
  const t = latexInlineText(raw).trim()
  const km = matchKeywordHeading(t)
  if (km && km.valid && km.label) return km.label
  return t.replace(/^[([]\s*/, '').replace(/\s*[)\].:]+$/, '').trim() || t
}

function byTopEnumerate(body: string): LatexStructure | null {
  const envs = topLevelEnvs(body, 'enumerate')
  const segments: LatexSegment[] = []
  let k = 0
  for (const env of envs) {
    let content = body.slice(env.contentStart, env.contentEnd)
    const opt = /^\s*\[/.test(content) ? readOptional(content, 0) : null
    if (opt) content = content.slice(opt.end)
    const style = enumStyle(opt ? opt.content : null, 0)
    for (const item of splitItems(content, ['item']).items) {
      k++
      segments.push({
        label: item.label !== null ? cleanItemLabel(item.label) : counterLabel(style.counter, k),
        title: null,
        source: item.body,
        enumDepth: 1,
        exam: false,
      })
    }
  }
  if (segments.length < 2) return null
  const leftovers = envs.slice(1).map((e, i) => body.slice(envs[i]?.after ?? 0, e.start))
  leftovers.push(body.slice(envs[envs.length - 1]?.after ?? body.length))
  return {
    scheme: 'latex-enumerate',
    strength: 'high',
    preamble: body.slice(0, envs[0]?.start ?? 0),
    segments,
    leftovers: nonEmpty(leftovers),
  }
}

function byGenericSections(body: string): LatexStructure | null {
  for (const level of ['section', 'subsection']) {
    const re = new RegExp(String.raw`\\` + level + String.raw`\*?\s*(?:\[[^\]]*\])?\s*(?=\{)`, 'g')
    const hits: Array<{ start: number; bodyStart: number; title: string }> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(body))) {
      const arg = readArg(body, m.index + m[0].length)
      if (arg) hits.push({ start: m.index, bodyStart: arg.end, title: latexInlineText(arg.content) })
    }
    if (hits.length < 2) continue
    return {
      scheme: 'latex-sections',
      strength: 'medium',
      preamble: body.slice(0, hits[0]?.start ?? 0),
      segments: hits.map((h, k) => ({
        label: String(k + 1),
        title: h.title || null,
        source: body.slice(h.bodyStart, hits[k + 1]?.start ?? body.length),
        enumDepth: 0,
        exam: false,
      })),
      leftovers: [],
    }
  }
  return null
}

export function detectLatexStructure(body: string): LatexStructure | null {
  return (
    byProblemEnvs(body) ??
    byExamQuestions(body) ??
    byProblemMacros(body) ??
    byKeywordHeadings(body) ??
    byTopEnumerate(body) ??
    byGenericSections(body)
  )
}

export interface LatexChildren {
  intro: string
  outro: string
  items: Array<{ label: string; source: string }>
  childDepth: number
}

/**
 * Structural subparts of a problem body: exam-class \part items, or the items of the first
 * enumerate (≥2 items). Returns null when neither exists (text-based detection then applies).
 */
export function extractLatexChildren(source: string, enumDepth: number, exam: boolean): LatexChildren | null {
  const envName = exam ? 'parts' : 'enumerate'
  const env = topLevelEnvs(source, envName)[0]
  if (!env) return null
  let content = source.slice(env.contentStart, env.contentEnd)
  let opt: string | null = null
  if (!exam && /^\s*\[/.test(content)) {
    const o = readOptional(content, 0)
    if (o) {
      opt = o.content
      content = content.slice(o.end)
    }
  }
  const { before, items } = splitItems(content, exam ? ['part'] : ['item'])
  if (items.length < 2) return null
  const style = listStyle(envName, opt, enumDepth) ?? enumStyle(opt, enumDepth)
  return {
    intro: `${source.slice(0, env.start)}\n${before}`,
    outro: source.slice(env.after),
    items: items.map((item, k) => ({
      label: !exam && item.label !== null ? cleanItemLabel(item.label) : counterLabel(style.counter, k + 1),
      source: item.body,
    })),
    childDepth: exam ? enumDepth : enumDepth + 1,
  }
}
