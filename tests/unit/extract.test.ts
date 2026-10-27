import { describe, expect, it } from 'vitest'
import { detectKind, itemsToText, parseLabelList } from '@/lib/extract'

describe('parseLabelList (manual entry)', () => {
  it('handles commas, ranges and subparts', () => {
    expect(parseLabelList('1, 2, 3a, 3b, 4')).toEqual([
      { label: '1', children: [] },
      { label: '2', children: [] },
      { label: '3', children: ['a', 'b'] },
      { label: '4', children: [] },
    ])
    expect(parseLabelList('1-3').map((p) => p.label)).toEqual(['1', '2', '3'])
    expect(parseLabelList('Problem 1\nProblem 2(ii)')).toEqual([
      { label: '1', children: [] },
      { label: '2', children: ['ii'] },
    ])
    expect(parseLabelList(' , ;')).toEqual([])
  })
})

describe('itemsToText (pdf.js line reconstruction)', () => {
  const item = (str: string, x: number, y: number, width = str.length * 5, height = 10) => ({ str, transform: [1, 0, 0, height, x, y], width, height })
  it('orders lines top to bottom and words left to right, keeping superscripts attached to their line', () => {
    const text = itemsToText([item('world', 60, 700), item('Hello', 10, 700), item('2', 36, 703, 4, 6), item('Next line', 10, 686)])
    expect(text.split('\n')).toEqual(['Hello2 world', 'Next line'])
  })
  it('inserts a blank line at large vertical gaps', () => {
    expect(itemsToText([item('A', 10, 700), item('B', 10, 640)])).toBe('A\n\nB')
  })
})

describe('detectKind', () => {
  const f = (name: string, type = '') => new File(['x'], name, { type })
  it('recognizes supported types', () => {
    expect(detectKind(f('ps4.pdf'))?.kind).toBe('pdf')
    expect(detectKind(f('ps4.tex'))?.kind).toBe('tex')
    expect(detectKind(f('ps4.md'))?.kind).toBe('markdown')
    expect(detectKind(f('notes.txt'))?.kind).toBe('text')
    expect(detectKind(f('essay.docx'))?.kind).toBe('docx')
    expect(detectKind(f('image.png', 'image/png'))).toBeNull()
  })
})
