import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, CornerDownRight, Eye, IndentDecrease, IndentIncrease, Merge, Plus, Scissors, Trash2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Badge, Tip } from '@/components/ui/misc'
import { LazyMarkdown } from '@/components/LazyMarkdown'
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
  type DraftProblem,
} from '@/lib/parser'
import type { PdfHandle } from '@/lib/extract'

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tip content={label}>
      <button type="button" onClick={onClick} disabled={disabled} aria-label={label} className="rounded p-1 text-faint hover:bg-surface-2 hover:text-text disabled:pointer-events-none disabled:opacity-30 [&_svg]:size-3.5">
        {children}
      </button>
    </Tip>
  )
}

/** Edit the parsed problem tree before anything is published. Every operation is a pure function from lib/parser. */
export function ReviewEditor({ drafts, onChange, showStatements }: { drafts: DraftProblem[]; onChange: (d: DraftProblem[]) => void; showStatements: boolean }) {
  const flat = flattenDrafts(drafts)
  const cursors = useRef(new Map<string, number>())
  const [preview, setPreview] = useState<Set<string>>(new Set())

  return (
    <ol className="space-y-2">
      {flat.map(({ problem: p, depth, parentId }, i) => {
        const siblings = parentId ? flat.filter((f) => f.parentId === parentId) : flat.filter((f) => f.depth === 0)
        const idx = siblings.findIndex((s) => s.problem.id === p.id)
        const parentLabel = parentId ? flat.find((f) => f.problem.id === parentId)?.problem.label : null
        const showing = preview.has(p.id)
        return (
          <li key={p.id} className={cn('rounded-lg border border-border bg-surface', depth === 1 && 'ml-6 sm:ml-10')}>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-2.5 py-1.5">
              {depth === 1 ? <CornerDownRight className="size-3.5 text-faint" aria-hidden /> : null}
              <span className="text-xs text-muted">{depth === 1 ? `${parentLabel} ›` : 'Problem'}</span>
              <input
                value={p.label}
                onChange={(e) => onChange(updateProblem(drafts, p.id, { label: e.target.value }))}
                aria-label={`Label of item ${i + 1}`}
                className={cn('h-7 w-16 rounded border bg-surface px-1.5 text-sm font-semibold', p.label.trim() ? 'border-border' : 'border-danger')}
                maxLength={60}
              />
              <input
                value={p.title ?? ''}
                onChange={(e) => onChange(updateProblem(drafts, p.id, { title: e.target.value || null }))}
                placeholder="Title (optional)"
                aria-label={`Title of problem ${p.label}`}
                className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm hover:border-border focus:border-border"
                maxLength={200}
              />
              {p.confidence !== 'high' ? <Badge tone={p.confidence === 'low' ? 'warn' : 'neutral'}>{p.confidence} confidence</Badge> : null}
              {p.pageStart ? <span className="text-[11px] text-faint">p. {p.pageStart}{p.pageEnd && p.pageEnd !== p.pageStart ? `–${p.pageEnd}` : ''}</span> : null}
              <div className="ml-auto flex items-center">
                <IconBtn label="Move up" onClick={() => onChange(moveProblem(drafts, p.id, -1))} disabled={idx === 0}><ArrowUp /></IconBtn>
                <IconBtn label="Move down" onClick={() => onChange(moveProblem(drafts, p.id, 1))} disabled={idx === siblings.length - 1}><ArrowDown /></IconBtn>
                {depth === 0 ? (
                  <IconBtn label="Make it a part of the previous problem" onClick={() => onChange(indentProblem(drafts, p.id))} disabled={idx === 0}><IndentIncrease /></IconBtn>
                ) : (
                  <IconBtn label="Make it a separate problem" onClick={() => onChange(outdentProblem(drafts, p.id))}><IndentDecrease /></IconBtn>
                )}
                <IconBtn label="Merge with the next one" onClick={() => onChange(mergeWithNext(drafts, p.id))} disabled={idx === siblings.length - 1}><Merge /></IconBtn>
                {showStatements ? (
                  <IconBtn label="Split at the cursor" onClick={() => onChange(splitProblem(drafts, p.id, cursors.current.get(p.id) ?? Math.floor(p.statementMarkdown.length / 2)))} disabled={p.statementMarkdown.length < 2}>
                    <Scissors />
                  </IconBtn>
                ) : null}
                <IconBtn label="Add a problem after this" onClick={() => onChange(addProblem(drafts, p.id))}><Plus /></IconBtn>
                {depth === 0 ? <IconBtn label="Add a part (a), (b)…" onClick={() => onChange(addProblem(drafts, p.children.at(-1)?.id ?? null, p.id))}><CornerDownRight /></IconBtn> : null}
                {showStatements ? <IconBtn label={showing ? 'Edit' : 'Preview'} onClick={() => setPreview((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}><Eye /></IconBtn> : null}
                <IconBtn label="Delete" onClick={() => onChange(removeProblem(drafts, p.id))}><Trash2 /></IconBtn>
              </div>
            </div>
            {showStatements ? (
              showing ? (
                <div className="px-3 py-2.5">{p.statementMarkdown.trim() ? <LazyMarkdown>{p.statementMarkdown}</LazyMarkdown> : <p className="text-sm text-faint">(no statement)</p>}</div>
              ) : (
                <AutoTextarea
                  value={p.statementMarkdown}
                  onChange={(v) => onChange(updateProblem(drafts, p.id, { statementMarkdown: v }))}
                  onCursor={(pos) => cursors.current.set(p.id, pos)}
                  label={`Statement of problem ${parentLabel ? `${parentLabel}(${p.label})` : p.label}`}
                />
              )
            ) : null}
            {p.warnings.length ? (
              <ul className="border-t border-border px-3 py-1.5 text-[11px] text-warn">
                {p.warnings.map((w, k) => (
                  <li key={k}>{w}</li>
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function AutoTextarea({ value, onChange, onCursor, label }: { value: string; onChange: (v: string) => void; onCursor: (pos: number) => void; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(360, el.scrollHeight + 2)}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onSelect={(e) => onCursor(e.currentTarget.selectionStart)}
      aria-label={label}
      placeholder="Statement (Markdown + LaTeX). Leave empty to publish just the label."
      rows={2}
      maxLength={20000}
      className="block w-full resize-y rounded-b-lg bg-transparent px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none placeholder:font-sans placeholder:text-faint"
    />
  )
}

/** Rendered PDF pages beside the editor so the reviewer can check the parse against the original. */
export function PdfPreview({ pdf }: { pdf: PdfHandle }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <PdfPage key={i} pdf={pdf} n={i + 1} />
      ))}
    </div>
  )
}

function PdfPage({ pdf, n }: { pdf: PdfHandle; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(n <= 2)
  useEffect(() => {
    if (visible || !wrap.current) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '400px' })
    io.observe(wrap.current)
    return () => io.disconnect()
  }, [visible])
  useEffect(() => {
    if (!visible || !ref.current || !wrap.current) return
    void pdf.render(n, ref.current, wrap.current.clientWidth).catch(() => {})
  }, [visible, pdf, n])
  return (
    <figure ref={wrap} className="overflow-hidden rounded-md border border-border bg-white" style={{ minHeight: visible ? undefined : 400 }}>
      <canvas ref={ref} aria-label={`Page ${n}`} />
      <figcaption className="border-t border-border bg-surface px-2 py-1 text-[11px] text-faint">Page {n}</figcaption>
    </figure>
  )
}
