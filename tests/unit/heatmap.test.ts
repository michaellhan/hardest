import { describe, expect, it } from 'vitest'
import { buildHeatmap, cellAppearance, DEFAULT_OPTIONS } from '@/components/heatmap/model'
import { assignment, overview, problem } from './fixtures'

describe('heatmap model', () => {
  const parent = problem('3', [], { display_order: 3 })
  const ps1 = assignment('Problem Set 1', [problem('1', [2, 3, 2], { display_order: 1 }), problem('2', [9], { display_order: 2 }), parent, problem('a', [6, 6, 6], { parent_problem_id: parent.id, display_order: 4 }), problem('b', [], { parent_problem_id: parent.id, display_order: 5 })], { due_date: '2026-09-10', assignment_number: 1 })
  const ps2 = assignment('Problem Set 2', [problem('1'), problem('2')], { due_date: '2026-09-03', assignment_number: 2 })
  const ov = overview(ps1, ps2)

  it('collapses parts into their problem by default and expands on request', () => {
    const m = buildHeatmap(ov, undefined, DEFAULT_OPTIONS)
    const row = m.rows.find((r) => r.assignment.id === ps1.id)!
    expect(row.cells.map((c) => c.label)).toEqual(['1', '2', '3'])
    expect(row.cells[2]).toMatchObject({ mean: 6, parts: 2, ratedParts: 1, derived: true })
    const x = buildHeatmap(ov, undefined, { ...DEFAULT_OPTIONS, expand: true })
    expect(x.rows.find((r) => r.assignment.id === ps1.id)!.cells.map((c) => c.label)).toEqual(['1', '2', '3(a)', '3(b)'])
  })
  it('chronological sort uses due dates', () => {
    expect(buildHeatmap(ov, undefined, DEFAULT_OPTIONS).rows.map((r) => r.assignment.title)).toEqual(['Problem Set 2', 'Problem Set 1'])
  })
  it('hardest sort puts unrated assignments last', () => {
    expect(buildHeatmap(ov, undefined, { ...DEFAULT_OPTIONS, sort: 'hardest' }).rows[0].assignment.id).toBe(ps1.id)
  })
  it('only-rated hides unrated cells and empty rows', () => {
    const m = buildHeatmap(ov, undefined, { ...DEFAULT_OPTIONS, onlyRated: true })
    expect(m.rows).toHaveLength(1)
    expect(m.hiddenRows).toBe(1)
  })
  it('marks partially rated problems', () => {
    const mine = { [ps1.problems[3].id]: { problem_id: ps1.problems[3].id, difficulty: 6, time_minutes: null, completion_status: null, stale: false, updated_at: '' } }
    const cell = buildHeatmap(ov, mine, DEFAULT_OPTIONS).rows.find((r) => r.assignment.id === ps1.id)!.cells[2]
    expect(cell.mine).toBe('partial')
  })
  it('unrated cells are never colored; low samples are flagged', () => {
    expect(cellAppearance({ count: 0, mean: null, median: null, timeMinutes: null }, 'mean', 'light', 1)).toMatchObject({ swatch: null, state: 'unrated' })
    expect(cellAppearance({ count: 1, mean: 9, median: 9, timeMinutes: null }, 'mean', 'light', 1)).toMatchObject({ state: 'value', lowSample: true })
    expect(cellAppearance({ count: 5, mean: 9, median: 9, timeMinutes: null }, 'time', 'light', 1)).toMatchObject({ swatch: null, state: 'no-data' })
  })
})
