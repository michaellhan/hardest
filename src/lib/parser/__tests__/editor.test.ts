import { describe, expect, it } from 'vitest'
import {
  addProblem,
  flattenDrafts,
  indentProblem,
  mergeWithNext,
  moveProblem,
  outdentProblem,
  removeProblem,
  splitProblem,
  updateProblem,
  validateDrafts,
  type DraftProblem,
} from '../index'

function p(id: string, label: string, statement = '', children: DraftProblem[] = []): DraftProblem {
  return {
    id,
    label,
    title: null,
    statementMarkdown: statement,
    children,
    pageStart: null,
    pageEnd: null,
    confidence: 'high',
    warnings: [],
  }
}

function sample(): DraftProblem[] {
  return [p('d1', '1', 'One.'), p('d2', '2', 'Two.', [p('d3', 'a', 'Two a.'), p('d4', 'b', 'Two b.')]), p('d5', '3', 'Three.')]
}

/** Deep-freezes the tree so any mutation throws in strict mode. */
function frozen(): DraftProblem[] {
  const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === 'object') {
      Object.values(o).forEach(deepFreeze)
      Object.freeze(o)
    }
    return o
  }
  return deepFreeze(sample())
}

const ids = (ps: DraftProblem[]) => flattenDrafts(ps).map((f) => f.problem.id)
const labels = (ps: DraftProblem[]) => ps.map((x) => x.label)

describe('flattenDrafts', () => {
  it('lists parents then children with depth and parent ids', () => {
    expect(flattenDrafts(sample()).map((f) => [f.problem.id, f.depth, f.parentId])).toEqual([
      ['d1', 0, null],
      ['d2', 0, null],
      ['d3', 1, 'd2'],
      ['d4', 1, 'd2'],
      ['d5', 0, null],
    ])
  })
})

describe('mergeWithNext', () => {
  it('appends the next sibling statement and children', () => {
    const src = frozen()
    const out = mergeWithNext(src, 'd1')
    expect(labels(out)).toEqual(['1', '3'])
    expect(out[0]?.statementMarkdown).toBe('One.\n\nTwo.')
    expect(out[0]?.children.map((c) => c.id)).toEqual(['d3', 'd4'])
    expect(src).toHaveLength(3)
  })

  it('works among children and is a no-op for the last sibling', () => {
    const out = mergeWithNext(frozen(), 'd3')
    expect(out[1]?.children.map((c) => c.statementMarkdown)).toEqual(['Two a.\n\nTwo b.'])
    const src = frozen()
    expect(mergeWithNext(src, 'd5')).toBe(src)
  })
})

describe('splitProblem', () => {
  it('splits a statement into two siblings with the next label', () => {
    const src = frozen()
    const out = splitProblem(src, 'd1', 3)
    expect(labels(out)).toEqual(['1', "1'", '2', '3'])
    expect(out[0]?.statementMarkdown).toBe('One')
    expect(out[1]?.statementMarkdown).toBe('.')
    expect(out[1]?.id).toBe('d6')
  })

  it('uses nextLabel when it is free and moves children to the second half', () => {
    const out = splitProblem(frozen(), 'd5', 2)
    expect(labels(out)).toEqual(['1', '2', '3', '4'])
    const split2 = splitProblem(frozen(), 'd2', 3)
    expect(split2[1]?.children).toEqual([])
    expect(split2[2]?.children.map((c) => c.id)).toEqual(['d3', 'd4'])
    expect(split2[2]?.statementMarkdown).toBe('.')
  })

  it('clamps out-of-range offsets', () => {
    const out = splitProblem(frozen(), 'd1', 999)
    expect(out[0]?.statementMarkdown).toBe('One.')
    expect(out[1]?.statementMarkdown).toBe('')
  })
})

describe('moveProblem', () => {
  it('reorders among siblings and ignores moves past the ends', () => {
    expect(ids(moveProblem(frozen(), 'd5', -1))).toEqual(['d1', 'd5', 'd2', 'd3', 'd4'])
    expect(ids(moveProblem(frozen(), 'd3', 1))).toEqual(['d1', 'd2', 'd4', 'd3', 'd5'])
    const src = frozen()
    expect(moveProblem(src, 'd1', -1)).toBe(src)
  })
})

describe('removeProblem', () => {
  it('removes top-level problems and subproblems', () => {
    expect(ids(removeProblem(frozen(), 'd2'))).toEqual(['d1', 'd5'])
    expect(ids(removeProblem(frozen(), 'd4'))).toEqual(['d1', 'd2', 'd3', 'd5'])
    const src = frozen()
    expect(removeProblem(src, 'nope')).toBe(src)
  })
})

describe('addProblem', () => {
  it('inserts after a problem with the next label', () => {
    const out = addProblem(frozen(), 'd5')
    expect(labels(out)).toEqual(['1', '2', '3', '4'])
    expect(out[3]).toMatchObject({ id: 'd6', statementMarkdown: '', children: [], title: null })
  })

  it('avoids duplicate labels when inserting in the middle', () => {
    expect(labels(addProblem(frozen(), 'd1'))).toEqual(['1', "1'", '2', '3'])
  })

  it('appends at the end when afterId is null, or starts at 1 when empty', () => {
    expect(labels(addProblem(frozen(), null))).toEqual(['1', '2', '3', '4'])
    expect(labels(addProblem([], null))).toEqual(['1'])
  })

  it('adds subproblems into a parent', () => {
    const out = addProblem(frozen(), 'd4', 'd2')
    expect(labels(out[1]!.children)).toEqual(['a', 'b', 'c'])
    const first = addProblem(frozen(), null, 'd1')
    expect(labels(first[0]!.children)).toEqual(['a'])
    const afterChild = addProblem(frozen(), 'd3')
    expect(labels(afterChild[1]!.children)).toEqual(['a', "a'", 'b'])
  })
})

describe('indentProblem / outdentProblem', () => {
  it('indents into the previous sibling, keeping the label', () => {
    const out = indentProblem(frozen(), 'd5')
    expect(labels(out)).toEqual(['1', '2'])
    expect(out[1]?.children.map((c) => [c.id, c.label])).toEqual([
      ['d3', 'a'],
      ['d4', 'b'],
      ['d5', '3'],
    ])
  })

  it('refuses to indent the first problem or one with children', () => {
    const src = frozen()
    expect(indentProblem(src, 'd1')).toBe(src)
    expect(indentProblem(src, 'd2')).toBe(src)
    expect(indentProblem(src, 'd3')).toBe(src)
  })

  it('outdents a child to just after its parent', () => {
    const out = outdentProblem(frozen(), 'd3')
    expect(ids(out)).toEqual(['d1', 'd2', 'd4', 'd3', 'd5'])
    expect(out.map((x) => x.id)).toEqual(['d1', 'd2', 'd3', 'd5'])
    const src = frozen()
    expect(outdentProblem(src, 'd1')).toBe(src)
  })
})

describe('updateProblem', () => {
  it('patches label, title and statement anywhere in the tree', () => {
    const src = frozen()
    const out = updateProblem(src, 'd4', { label: 'c', title: 'T', statementMarkdown: 'New' })
    expect(out[1]?.children[1]).toMatchObject({ label: 'c', title: 'T', statementMarkdown: 'New' })
    expect(out[0]).toBe(src[0])
    expect(src[1]?.children[1]?.label).toBe('b')
    expect(updateProblem(src, 'missing', { label: 'x' })).toBe(src)
  })
})

describe('validateDrafts', () => {
  it('accepts a valid tree', () => {
    expect(validateDrafts(sample())).toEqual([])
  })

  it('reports empty and duplicate labels', () => {
    const errs = validateDrafts([p('d1', '1'), p('d2', '1', '', [p('d3', ' '), p('d4', 'a'), p('d5', 'a')]), p('d6', '')])
    expect(errs).toContain('Duplicate label "1" used by 2 problems.')
    expect(errs).toContain('Duplicate label "a" used by 2 subproblems of problem 1.')
    expect(errs).toContain('Subproblem 1 of problem 1 has an empty label.')
    expect(errs).toContain('Problem at position 3 has an empty label.')
  })

  it('reports too many problems and overly long statements', () => {
    const many = Array.from({ length: 301 }, (_, k) => p(`d${k + 1}`, String(k + 1)))
    expect(validateDrafts(many)).toEqual(['Too many problems: 301 (maximum is 300).'])
    const long = [p('d1', '1', 'x'.repeat(20001))]
    expect(validateDrafts(long)).toEqual(['Problem 1 statement is too long (20001 characters; maximum is 20000).'])
  })
})
