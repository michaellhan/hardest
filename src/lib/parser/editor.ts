/**
 * Pure helpers for the review editor. Every function returns a new array (or the input
 * unchanged when the operation does not apply) and never mutates its arguments.
 */
import { nextFreeId } from './ids'
import { nextLabel } from './labels'
import type { DraftProblem } from './types'

export const MAX_PROBLEMS = 300
export const MAX_STATEMENT_CHARS = 20000

/**
 * Finds the sibling list containing `id` and replaces it with `fn(list, index)`,
 * rebuilding the ancestors immutably. Returns null when `id` is not in the tree.
 */
function withSiblings(
  problems: DraftProblem[],
  id: string,
  fn: (list: DraftProblem[], index: number) => DraftProblem[],
): DraftProblem[] | null {
  const idx = problems.findIndex((p) => p.id === id)
  if (idx >= 0) return fn(problems, idx)
  for (let i = 0; i < problems.length; i++) {
    const parent = problems[i]
    if (!parent) continue
    const children = withSiblings(parent.children, id, fn)
    if (children) {
      const copy = problems.slice()
      copy[i] = { ...parent, children }
      return copy
    }
  }
  return null
}

function findProblem(problems: DraftProblem[], id: string): DraftProblem | null {
  for (const p of problems) {
    if (p.id === id) return p
    const inner = findProblem(p.children, id)
    if (inner) return inner
  }
  return null
}

/** A label for a new sibling inserted after `prev`, avoiding collisions with existing siblings. */
function freshLabel(siblings: DraftProblem[], prev: DraftProblem | undefined, isChild: boolean): string {
  const taken = new Set(siblings.map((s) => s.label.trim()))
  const base = prev ? prev.label.trim() : ''
  let candidate = prev ? nextLabel(base) : isChild ? 'a' : '1'
  if (!taken.has(candidate)) return candidate
  candidate = `${base || candidate}'`
  while (taken.has(candidate)) candidate += "'"
  return candidate
}

function emptyProblem(id: string, label: string): DraftProblem {
  return {
    id,
    label,
    title: null,
    statementMarkdown: '',
    children: [],
    pageStart: null,
    pageEnd: null,
    confidence: 'high',
    warnings: [],
  }
}

function joinStatements(a: string, b: string): string {
  return [a.trim(), b.trim()].filter(Boolean).join('\n\n')
}

export function flattenDrafts(
  problems: DraftProblem[],
): Array<{ problem: DraftProblem; depth: 0 | 1; parentId: string | null }> {
  const out: Array<{ problem: DraftProblem; depth: 0 | 1; parentId: string | null }> = []
  const walk = (list: DraftProblem[], depth: 0 | 1, parentId: string | null) => {
    for (const p of list) {
      out.push({ problem: p, depth, parentId })
      walk(p.children, 1, p.id)
    }
  }
  walk(problems, 0, null)
  return out
}

/** Appends the next sibling's statement and children to this problem and removes the sibling. */
export function mergeWithNext(problems: DraftProblem[], id: string): DraftProblem[] {
  return (
    withSiblings(problems, id, (list, idx) => {
      const cur = list[idx]
      const next = list[idx + 1]
      if (!cur || !next) return list
      const merged: DraftProblem = {
        ...cur,
        title: cur.title ?? next.title,
        statementMarkdown: joinStatements(cur.statementMarkdown, next.statementMarkdown),
        children: [...cur.children, ...next.children],
        pageStart: cur.pageStart ?? next.pageStart,
        pageEnd: next.pageEnd ?? cur.pageEnd,
        warnings: [...new Set([...cur.warnings, ...next.warnings])],
      }
      const copy = list.slice()
      copy.splice(idx, 2, merged)
      return copy
    }) ?? problems
  )
}

/**
 * Splits the statement at `offset` into two siblings. The new second problem takes the
 * label nextLabel(label) and the original's children (which follow the statement).
 */
export function splitProblem(problems: DraftProblem[], id: string, offset: number): DraftProblem[] {
  const newId = nextFreeId(problems)
  return (
    withSiblings(problems, id, (list, idx) => {
      const cur = list[idx]
      if (!cur) return list
      const text = cur.statementMarkdown
      const at = Math.max(0, Math.min(text.length, Math.floor(offset)))
      const first: DraftProblem = { ...cur, statementMarkdown: text.slice(0, at).trimEnd(), children: [] }
      const others = list.filter((_, k) => k !== idx)
      const second: DraftProblem = {
        ...emptyProblem(newId, freshLabel(others, cur, false)),
        statementMarkdown: text.slice(at).trimStart(),
        children: cur.children,
        pageStart: cur.pageStart,
        pageEnd: cur.pageEnd,
        confidence: cur.confidence,
      }
      const copy = list.slice()
      copy.splice(idx, 1, first, second)
      return copy
    }) ?? problems
  )
}

export function moveProblem(problems: DraftProblem[], id: string, direction: -1 | 1): DraftProblem[] {
  return (
    withSiblings(problems, id, (list, idx) => {
      const target = idx + direction
      const a = list[idx]
      const b = list[target]
      if (!a || !b) return list
      const copy = list.slice()
      copy[idx] = b
      copy[target] = a
      return copy
    }) ?? problems
  )
}

export function removeProblem(problems: DraftProblem[], id: string): DraftProblem[] {
  return withSiblings(problems, id, (list, idx) => list.filter((_, k) => k !== idx)) ?? problems
}

/**
 * Inserts an empty problem. With `parentId`, it goes into that problem's children (after
 * `afterId` if it is one of them, else at the end). Otherwise it goes after `afterId` in
 * whichever list contains it, or at the end of the top level when `afterId` is null.
 */
export function addProblem(problems: DraftProblem[], afterId: string | null, parentId?: string | null): DraftProblem[] {
  const newId = nextFreeId(problems)
  const insert = (list: DraftProblem[], isChild: boolean): DraftProblem[] => {
    const idx = afterId ? list.findIndex((p) => p.id === afterId) : -1
    const prev = idx >= 0 ? list[idx] : list[list.length - 1]
    const created = emptyProblem(newId, freshLabel(list, prev, isChild))
    const copy = list.slice()
    copy.splice(idx >= 0 ? idx + 1 : list.length, 0, created)
    return copy
  }
  if (parentId) {
    return withSiblings(problems, parentId, (list, idx) => {
      const parent = list[idx]
      if (!parent) return list
      const copy = list.slice()
      copy[idx] = { ...parent, children: insert(parent.children, true) }
      return copy
    }) ?? problems
  }
  if (afterId) {
    const isChild = !problems.some((p) => p.id === afterId)
    return withSiblings(problems, afterId, (list) => insert(list, isChild)) ?? insert(problems, false)
  }
  return insert(problems, false)
}

/** Makes a top-level problem (without children) the last child of its previous sibling. Label is kept. */
export function indentProblem(problems: DraftProblem[], id: string): DraftProblem[] {
  const idx = problems.findIndex((p) => p.id === id)
  const cur = problems[idx]
  const prev = problems[idx - 1]
  if (idx <= 0 || !cur || !prev || cur.children.length > 0) return problems
  const copy = problems.slice()
  copy.splice(idx - 1, 2, { ...prev, children: [...prev.children, cur] })
  return copy
}

/** Moves a subproblem to the top level, directly after its parent. */
export function outdentProblem(problems: DraftProblem[], id: string): DraftProblem[] {
  const parentIdx = problems.findIndex((p) => p.children.some((c) => c.id === id))
  const parent = problems[parentIdx]
  if (parentIdx < 0 || !parent) return problems
  const child = parent.children.find((c) => c.id === id)
  if (!child) return problems
  const copy = problems.slice()
  copy.splice(parentIdx, 1, { ...parent, children: parent.children.filter((c) => c.id !== id) }, child)
  return copy
}

export function updateProblem(
  problems: DraftProblem[],
  id: string,
  patch: Partial<Pick<DraftProblem, 'label' | 'title' | 'statementMarkdown'>>,
): DraftProblem[] {
  if (!findProblem(problems, id)) return problems
  return (
    withSiblings(problems, id, (list, idx) => {
      const cur = list[idx]
      if (!cur) return list
      const copy = list.slice()
      copy[idx] = { ...cur, ...patch }
      return copy
    }) ?? problems
  )
}

/** Human-readable validation errors for the review editor; [] when the drafts can be published. */
export function validateDrafts(problems: DraftProblem[]): string[] {
  const errors: string[] = []
  let total = 0
  const checkList = (list: DraftProblem[], parent: DraftProblem | null) => {
    const counts = new Map<string, number>()
    list.forEach((p, k) => {
      total++
      const label = p.label.trim()
      const name = parent ? `Problem ${parent.label.trim()}(${label})` : `Problem ${label}`
      if (!label) {
        errors.push(
          parent
            ? `Subproblem ${k + 1} of problem ${parent.label.trim() || '(unlabeled)'} has an empty label.`
            : `Problem at position ${k + 1} has an empty label.`,
        )
      } else {
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }
      if (p.statementMarkdown.length > MAX_STATEMENT_CHARS) {
        errors.push(
          `${label ? name : `Problem at position ${k + 1}`} statement is too long (${p.statementMarkdown.length} characters; maximum is ${MAX_STATEMENT_CHARS}).`,
        )
      }
      checkList(p.children, p)
    })
    for (const [label, count] of counts) {
      if (count > 1) {
        errors.push(
          parent
            ? `Duplicate label "${label}" used by ${count} subproblems of problem ${parent.label.trim()}.`
            : `Duplicate label "${label}" used by ${count} problems.`,
        )
      }
    }
  }
  checkList(problems, null)
  if (total > MAX_PROBLEMS) errors.push(`Too many problems: ${total} (maximum is ${MAX_PROBLEMS}).`)
  return errors
}
