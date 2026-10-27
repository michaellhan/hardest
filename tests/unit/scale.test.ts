import { describe, expect, it } from 'vitest'
import { countColor, difficultyBand, difficultyColor, timeColor } from '@/lib/scale'

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

describe('difficulty scale', () => {
  it('returns valid hex colors', () => {
    for (let v = 1; v <= 10; v += 0.5) expect(difficultyColor(v, 'light').bg).toMatch(/^#[0-9a-f]{6}$/)
  })
  it('gets monotonically darker with difficulty in light mode (order survives grayscale)', () => {
    let prev = Infinity
    for (let v = 1; v <= 10; v++) {
      const l = luminance(difficultyColor(v, 'light').bg)
      expect(l).toBeLessThan(prev)
      prev = l
    }
  })
  it('text on every swatch meets WCAG AA for its size (≥ 4.5:1 light, ≥ 3:1 dark)', () => {
    for (let v = 1; v <= 10; v += 0.1) {
      const l = difficultyColor(v, 'light')
      const d = difficultyColor(v, 'dark')
      expect(contrast(l.bg, l.fg)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(d.bg, d.fg)).toBeGreaterThanOrEqual(3)
    }
  })
  it('time and count scales use different colors from difficulty', () => {
    expect(timeColor(60, 'light').bg).not.toBe(difficultyColor(5, 'light').bg)
    expect(countColor(5, 10, 'light').bg).not.toBe(difficultyColor(5, 'light').bg)
  })
  it('bands', () => {
    expect(difficultyBand(2)).toBe('Easy')
    expect(difficultyBand(5)).toBe('Moderate')
    expect(difficultyBand(7.9)).toBe('Hard')
    expect(difficultyBand(9.2)).toBe('Extremely hard')
  })
})
