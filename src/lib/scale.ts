/**
 * Color scales. Difficulty uses a sequential green → amber → orange → red ramp defined in OKLCH with
 * monotonically decreasing lightness (light theme) so the order survives color-vision deficiencies and
 * grayscale; cells also always carry numbers. Time and vote-count use different hues so they can't be
 * mistaken for difficulty. Unrated cells never get a scale color.
 */

export type Theme = 'light' | 'dark'
type Stop = [value: number, l: number, c: number, h: number]

const DIFFICULTY: Record<Theme, Stop[]> = {
  light: [
    [1, 0.945, 0.055, 152],
    [3, 0.885, 0.085, 142],
    [5, 0.85, 0.12, 92],
    [6, 0.8, 0.135, 74],
    [7, 0.735, 0.145, 56],
    [8.5, 0.69, 0.145, 40],
    [10, 0.635, 0.135, 26],
  ],
  dark: [
    [1, 0.36, 0.05, 152],
    [3, 0.43, 0.075, 142],
    [5, 0.55, 0.11, 88],
    [6, 0.58, 0.125, 72],
    [7, 0.6, 0.14, 55],
    [8.5, 0.6, 0.155, 38],
    [10, 0.58, 0.16, 25],
  ],
}

const TIME: Record<Theme, [Stop, Stop]> = {
  light: [
    [0, 0.955, 0.025, 285],
    [1, 0.5, 0.13, 285],
  ],
  dark: [
    [0, 0.33, 0.04, 285],
    [1, 0.72, 0.12, 285],
  ],
}

const COUNT: Record<Theme, [Stop, Stop]> = {
  light: [
    [0, 0.955, 0.015, 235],
    [1, 0.55, 0.08, 235],
  ],
  dark: [
    [0, 0.32, 0.02, 235],
    [1, 0.7, 0.08, 235],
  ],
}

function oklchToHex(l: number, c: number, hDeg: number): string {
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const rgb = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return (
    '#' +
    rgb
      .map((x) => {
        const v = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055
        return Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}

function interpolate(stops: Stop[], value: number): [number, number, number] {
  const v = Math.min(stops[stops.length - 1][0], Math.max(stops[0][0], value))
  for (let i = 0; i < stops.length - 1; i++) {
    const [v0, l0, c0, h0] = stops[i]
    const [v1, l1, c1, h1] = stops[i + 1]
    if (v <= v1) {
      const t = (v - v0) / (v1 - v0 || 1)
      return [l0 + (l1 - l0) * t, c0 + (c1 - c0) * t, h0 + (h1 - h0) * t]
    }
  }
  const last = stops[stops.length - 1]
  return [last[1], last[2], last[3]]
}

export interface Swatch {
  bg: string
  fg: string
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const cache = new Map<string, Swatch>()
function swatch(key: string, l: number, c: number, h: number, theme: Theme): Swatch {
  let s = cache.get(key)
  if (!s) {
    const bg = oklchToHex(l, c, h)
    const dark = theme === 'light' ? '#1f1d1a' : '#151412'
    // Pick whichever text color reads better on this exact background.
    s = { bg, fg: contrast(bg, dark) >= contrast(bg, '#fbfaf8') ? dark : '#fbfaf8' }
    cache.set(key, s)
  }
  return s
}

export function difficultyColor(value: number, theme: Theme): Swatch {
  const v = Math.round(value * 10) / 10
  const [l, c, h] = interpolate(DIFFICULTY[theme], v)
  return swatch(`d:${theme}:${v}`, l, c, h, theme)
}

/** Time on a log scale from 10 minutes to 8 hours. */
export function timeColor(minutes: number, theme: Theme): Swatch {
  const t = Math.min(1, Math.max(0, (Math.log(Math.max(minutes, 1)) - Math.log(10)) / (Math.log(480) - Math.log(10))))
  const q = Math.round(t * 50) / 50
  const [l, c, h] = interpolate(TIME[theme], q)
  return swatch(`t:${theme}:${q}`, l, c, h, theme)
}

/** Vote counts on a square-root scale relative to the largest count in view. */
export function countColor(count: number, max: number, theme: Theme): Swatch {
  const t = max > 0 ? Math.sqrt(count / max) : 0
  const q = Math.round(t * 50) / 50
  const [l, c, h] = interpolate(COUNT[theme], q)
  return swatch(`c:${theme}:${q}`, l, c, h, theme)
}

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Trivial',
  2: 'Very easy',
  3: 'Easy',
  4: 'Fairly easy',
  5: 'Moderate',
  6: 'Somewhat hard',
  7: 'Hard',
  8: 'Very hard',
  9: 'Brutal',
  10: 'Extremely difficult',
}

export function difficultyBand(value: number) {
  if (value < 3.5) return 'Easy'
  if (value < 6.5) return 'Moderate'
  if (value < 8.5) return 'Hard'
  return 'Extremely hard'
}
