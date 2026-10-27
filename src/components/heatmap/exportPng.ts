import type { Theme } from '@/lib/scale'
import type { OfferingOverview } from '@/lib/types'
import { buildHeatmap, cellAppearance, METRIC_LABELS, type HeatmapOptions } from './model'
import { difficultyColor } from '@/lib/scale'

/**
 * Draws the heatmap straight onto a canvas from the same model the DOM uses (no DOM screenshotting, so the
 * result is reliable across browsers) and downloads it as a PNG.
 */
export function exportHeatmapPng(overview: OfferingOverview, options: HeatmapOptions, theme: Theme, title: string, subtitle: string, isDemo: boolean) {
  const model = buildHeatmap(overview, undefined, { ...options, onlyRated: options.onlyRated })
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const cellW = model.wide ? 92 : 44
  const cellH = 36
  const gap = 3
  const left = 190
  const top = 96
  const avgW = 52
  const width = Math.max(640, left + model.columns * (cellW + gap) + avgW + 48)
  const height = top + model.rows.length * (cellH + gap) + 64
  const dpr = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  const font = (size: number, weight = 400) => `${weight} ${size}px Geist, ui-sans-serif, system-ui, sans-serif`

  ctx.fillStyle = v('--bg')
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = v('--text')
  ctx.font = font(20, 600)
  ctx.fillText(title, 24, 40)
  ctx.fillStyle = v('--muted')
  ctx.font = font(13)
  ctx.fillText(`${subtitle} · ${METRIC_LABELS[options.metric]}${isDemo ? ' · DEMO / SYNTHETIC DATA' : ''}`, 24, 62)

  model.rows.forEach((row, r) => {
    const y = top + r * (cellH + gap)
    ctx.fillStyle = v('--text')
    ctx.font = font(13, 500)
    ctx.textBaseline = 'middle'
    ctx.fillText(row.assignment.title.length > 24 ? row.assignment.title.slice(0, 23) + '…' : row.assignment.title, 24, y + cellH / 2)
    row.cells.forEach((cell, c) => {
      const x = left + c * (cellW + gap)
      const look = cellAppearance(cell, options.metric, theme, model.maxCount)
      ctx.beginPath()
      ctx.roundRect(x, y, cellW, cellH, 5)
      if (look.swatch) {
        ctx.fillStyle = look.swatch.bg
        ctx.fill()
      } else {
        ctx.setLineDash(look.state === 'unrated' ? [3, 3] : [])
        ctx.strokeStyle = v('--border-strong')
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.fillStyle = look.swatch?.fg ?? v('--faint')
      ctx.font = font(12, 500)
      ctx.textAlign = 'center'
      const text = look.state === 'unrated' ? (cell.label.length <= 4 ? cell.label : '—') : look.text
      ctx.fillText(model.wide ? `${cell.label.slice(0, 10)} ${text}` : text, x + cellW / 2, y + cellH / 2 + 1)
      ctx.textAlign = 'left'
    })
    const ax = left + model.columns * (cellW + gap) + 8
    const mean = row.summary.mean
    ctx.beginPath()
    ctx.roundRect(ax, y, avgW - 8, cellH, 5)
    if (mean != null) {
      const s = difficultyColor(mean, theme)
      ctx.fillStyle = s.bg
      ctx.fill()
      ctx.fillStyle = s.fg
    } else {
      ctx.strokeStyle = v('--border')
      ctx.stroke()
      ctx.fillStyle = v('--faint')
    }
    ctx.font = font(12, 600)
    ctx.textAlign = 'center'
    ctx.fillText(mean != null ? mean.toFixed(1) : '—', ax + (avgW - 8) / 2, y + cellH / 2 + 1)
    ctx.textAlign = 'left'
  })
  ctx.fillStyle = v('--faint')
  ctx.font = font(11)
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${window.location.href.split('?')[0]} · crowdsourced ratings; dashed = unrated`, 24, height - 24)

  canvas.toBlob((blob) => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-heatmap.png`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }, 'image/png')
}
