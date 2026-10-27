import { describe, expect, it } from 'vitest'
import { normalizeCode, parseCourseQuery, parseProblemQuery, searchOffering, slugify } from '@/lib/normalize'
import { trigramSimilarity } from '@/lib/trigram'
import { assignment, problem } from './fixtures'

describe('course codes and slugs', () => {
  it('normalizes codes the same way as SQL', () => {
    for (const s of ['MATH 55A', 'math55a', 'Math-55a', ' math 55 a ']) expect(normalizeCode(s)).toBe('math55a')
  })
  it('slugify', () => {
    expect(slugify('Math 55a: Honors!')).toBe('math-55a-honors')
    expect(slugify('***')).toBe('item')
  })
  it('typo tolerance via trigrams', () => {
    expect(trigramSimilarity('math55a', 'mth55a')).toBeGreaterThan(0.3)
    expect(trigramSimilarity('math55a', 'econ10a')).toBeLessThan(0.3)
  })
})

describe('parseCourseQuery', () => {
  it.each([
    ['math 55a fall 2026', 'math 55a', 'fall', 2026],
    ['Math 55a F26', 'Math 55a', 'fall', 2026],
    ['stat 110 spring', 'stat 110', 'spring', null],
    ['cs 1210 2025', 'cs 1210', null, 2025],
    ['math 55a', 'math 55a', null, null],
  ])('%s', (q, text, term, year) => {
    expect(parseCourseQuery(q)).toEqual({ text, term, year })
  })
})

describe('parseProblemQuery', () => {
  it.each([
    ['pset 4 problem 2', 4, '2'],
    ['ps4 p2', 4, '2'],
    ['problem set 4 #3b', 4, '3b'],
    ['4.2', 4, '2'],
    ['hw 3 2(a)', 3, '2a'],
  ])('%s', (q, num, label) => {
    const r = parseProblemQuery(q)
    expect(r.assignmentNumber).toBe(num)
    expect(r.problemLabel).toBe(label)
  })
})

describe('searchOffering', () => {
  it('finds a problem by assignment number and label', () => {
    const ps3 = assignment('Problem Set 3', [problem('1'), problem('2')], { assignment_number: 3 })
    const ps4 = assignment('Problem Set 4', [problem('1'), problem('2')], { assignment_number: 4 })
    const hits = searchOffering([ps3, ps4], 'pset 4 problem 2')
    expect(hits[0].assignment.id).toBe(ps4.id)
    expect(hits[0].problem.label).toBe('2')
  })
})
