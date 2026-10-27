import type { DraftProblem } from './types'

/** Sequential temp-id factory: 'd1', 'd2', … A fresh one is created per parse so ids are deterministic. */
export function createIdGenerator(prefix = 'd'): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

function collectIds(problems: DraftProblem[], into: Set<string>): Set<string> {
  for (const p of problems) {
    into.add(p.id)
    collectIds(p.children, into)
  }
  return into
}

/** An id not used anywhere in the tree, continuing the 'dN' numbering. */
export function nextFreeId(problems: DraftProblem[]): string {
  const ids = collectIds(problems, new Set())
  let max = 0
  for (const id of ids) {
    const m = /^d(\d+)$/.exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let candidate = max + 1
  while (ids.has(`d${candidate}`)) candidate++
  return `d${candidate}`
}
