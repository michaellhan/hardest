import { describe, expect, it } from 'vitest'
import {
  applyVoteToStats,
  bayesianMean,
  buildUnits,
  computeProblemStats,
  displayLabel,
  histogramMedian,
  median,
  standardError,
  summarizeAssignment,
  summarizeCourse,
} from '@/lib/stats'
import { assignment, overview, problem, stats } from './fixtures'

describe('median / histogram median', () => {
  it('matches percentile_cont(0.5) for odd and even counts', () => {
    expect(median([])).toBeNull()
    expect(median([5])).toBe(5)
    expect(median([1, 9, 5])).toBe(5)
    expect(median([1, 2, 3, 10])).toBe(2.5)
  })
  it('histogram median equals the median of the expanded ratings', () => {
    const values = [2, 2, 3, 7, 7, 7, 10, 10]
    const hist = Array.from({ length: 10 }, (_, i) => values.filter((v) => v === i + 1).length)
    expect(histogramMedian(hist)).toBe(median(values))
    expect(histogramMedian(Array(10).fill(0))).toBeNull()
  })
})

describe('computeProblemStats', () => {
  it('computes count, mean, sample SD, histogram, time median', () => {
    const s = computeProblemStats([
      { difficulty: 4, time_minutes: 30, completion_status: 'solved_independently' },
      { difficulty: 6, time_minutes: 90, completion_status: 'solved_with_help' },
      { difficulty: 8, time_minutes: null, completion_status: null },
    ])!
    expect(s.rating_count).toBe(3)
    expect(s.mean).toBe(6)
    expect(s.median).toBe(6)
    expect(s.stddev).toBe(2)
    expect(s.histogram).toEqual([0, 0, 0, 1, 0, 1, 0, 1, 0, 0])
    expect(s.time_count).toBe(2)
    expect(s.median_time_minutes).toBe(60)
    expect(s.completion.solved_independently).toBe(1)
  })
  it('returns null for no ratings', () => {
    expect(computeProblemStats([])).toBeNull()
  })
})

describe('applyVoteToStats (optimistic updates)', () => {
  it('adding, changing and removing a vote is exact', () => {
    const base = stats([3, 5, 7])
    const added = applyVoteToStats(base, null, 10)!
    expect(added).toMatchObject({ rating_count: 4, mean: 6.25, median: 6 })
    expect(added).toMatchObject({ histogram: stats([3, 5, 7, 10])!.histogram, stddev: stats([3, 5, 7, 10])!.stddev })
    const changed = applyVoteToStats(added, 10, 1)!
    expect(changed).toMatchObject({ rating_count: 4, mean: 4, median: 4 })
    expect(applyVoteToStats(stats([5]), 5, null)).toBeNull()
  })
})

describe('uncertainty and ranking', () => {
  it('standard error needs at least two ratings', () => {
    expect(standardError(stats([5]))).toBeNull()
    expect(standardError(stats([4, 6]))).toBeCloseTo(1, 3)
  })
  it('Bayesian mean shrinks small samples toward the prior', () => {
    expect(bayesianMean(10, 1, 5)).toBeCloseTo((10 + 5 * 5) / 6, 6)
    expect(bayesianMean(9, 30, 5)).toBeGreaterThan(bayesianMean(10, 1, 5))
  })
})

describe('units and assignment summaries', () => {
  it('a parent with parts is the mean of its rated part means; unrated parts are excluded', () => {
    const parent = problem('3')
    const a = problem('a', [2, 4], { parent_problem_id: parent.id })
    const b = problem('b', [8], { parent_problem_id: parent.id })
    const c = problem('c', [], { parent_problem_id: parent.id })
    const [unit] = buildUnits(assignment('PS', [parent, a, b, c]))
    expect(unit.parts.map((p) => p.label)).toEqual(['a', 'b', 'c'])
    expect(unit.stats).toMatchObject({ mean: 5.5, count: 3, ratedParts: 2, totalParts: 3, derived: true })
  })
  it('assignment average is the mean of problem means and ignores unrated problems', () => {
    const s = summarizeAssignment(assignment('PS 1', [problem('1', [2, 2, 2, 2]), problem('2', [8]), problem('3')]))
    expect(s.mean).toBe(5)
    expect(s.ratedUnits).toBe(2)
    expect(s.totalUnits).toBe(3)
    expect(s.ratingCount).toBe(5)
  })
  it('unrated assignment has no average (never "easy")', () => {
    expect(summarizeAssignment(assignment('PS 2', [problem('1'), problem('2')])).mean).toBeNull()
  })
  it('workload is reported only with time data for at least half the problems', () => {
    const p1 = problem('1', [5])
    p1.stats = stats([5], [60])
    const p2 = problem('2', [5])
    const p3 = problem('3', [5])
    expect(summarizeAssignment(assignment('A', [p1, p2, p3])).workloadMinutes).toBeNull()
    p2.stats = stats([5], [30])
    expect(summarizeAssignment(assignment('B', [p1, p2, p3])).workloadMinutes).toBe(90)
  })
  it('course hardest ranking prefers well-supported hard problems', () => {
    const lone = problem('1', [10])
    const solid = problem('2', Array(30).fill(9))
    const easy = problem('3', [2, 2, 3])
    const course = summarizeCourse(overview(assignment('PS 1', [lone, solid, easy])))
    expect(course.hardest[0].problem.id).toBe(solid.id)
    expect(course.totalRatings).toBe(34)
  })
  it('displayLabel', () => {
    expect(displayLabel({ label: 'b' }, '3')).toBe('3(b)')
    expect(displayLabel({ label: 'ii' }, '3')).toBe('3(ii)')
    expect(displayLabel({ label: '2' }, '4')).toBe('4.2')
    expect(displayLabel({ label: '7' })).toBe('7')
  })
})
