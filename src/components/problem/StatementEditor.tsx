import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/misc'
import { LazyMarkdown } from '@/components/LazyMarkdown'
import { useToast } from '@/components/ui/toast'
import { getApi } from '@/lib/api'
import type { ProblemChanges } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { useAuth } from '@/hooks/useAuth'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  problemId: string
  offeringId: string
  mode: 'add-statement' | 'suggest-edit'
  initial: { label: string; title: string | null; statement_markdown: string | null }
}

/**
 * Markdown + LaTeX editor with live preview. Adding a missing statement applies immediately (recorded and
 * revertible); changing existing content is sent to moderators unless the user is a moderator.
 */
export function StatementEditor({ open, onOpenChange, problemId, offeringId, mode, initial }: Props) {
  const toast = useToast()
  const qc = useQueryClient()
  const { isModerator } = useAuth()
  const [label, setLabel] = useState(initial.label)
  const [title, setTitle] = useState(initial.title ?? '')
  const [text, setText] = useState(initial.statement_markdown ?? '')
  const [note, setNote] = useState('')
  const [material, setMaterial] = useState(false)
  const [view, setView] = useState<'write' | 'preview'>('write')
  const [busy, setBusy] = useState(false)

  const changes: ProblemChanges = {}
  if (mode === 'suggest-edit') {
    if (label.trim() !== initial.label) changes.label = label.trim()
    if ((title.trim() || null) !== (initial.title ?? null)) changes.title = title.trim() || null
  }
  if ((text.trim() || null) !== (initial.statement_markdown ?? null)) changes.statement_markdown = text.trim() || null
  const hasChanges = Object.keys(changes).length > 0

  const save = async () => {
    setBusy(true)
    try {
      const res = await getApi().proposeEdit(problemId, changes, note.trim() || null, material)
      toast({ tone: 'success', message: res.applied ? 'Saved. Thanks for contributing!' : 'Sent to moderators for review. Thank you!' })
      qc.invalidateQueries({ queryKey: ['problem', problemId] })
      qc.invalidateQueries({ queryKey: ['history', problemId] })
      qc.invalidateQueries({ queryKey: ['overview', offeringId] })
      onOpenChange(false)
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl"
        title={mode === 'add-statement' ? `Add the statement for ${initial.label}` : `Suggest an edit to ${initial.label}`}
        description={
          mode === 'add-statement'
            ? 'Type or paste the problem exactly as assigned. Markdown and LaTeX ($…$, $$…$$) are supported. Only add text you have the right to share.'
            : isModerator
              ? 'You are a moderator, so this change applies immediately. It is recorded in the history and can be reverted.'
              : 'Your suggestion goes to a moderator before it appears. Ratings are kept unless the question materially changes.'
        }
      >
        {mode === 'suggest-edit' ? (
          <div className="mb-3 grid grid-cols-[120px_1fr] gap-3">
            <div>
              <Label htmlFor="ed-label">Label</Label>
              <Input id="ed-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
            </div>
            <div>
              <Label htmlFor="ed-title">Title (optional)</Label>
              <Input id="ed-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Sylow theorems" />
            </div>
          </div>
        ) : null}
        <div className="mb-2 flex items-center justify-between md:hidden">
          <Segmented label="Editor view" value={view} onChange={setView} options={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={view === 'preview' ? 'hidden md:block' : ''}>
            <Label htmlFor="ed-text" className="hidden md:block">Markdown + LaTeX</Label>
            <Textarea
              id="ed-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              maxLength={20000}
              className="font-mono text-[13px]"
              placeholder={'Let $G$ be a finite group. Prove that every subgroup of index $2$ is normal.'}
            />
            <p className="mt-1 text-[11px] text-faint">{text.length.toLocaleString()} / 20,000 · HTML is not rendered</p>
          </div>
          <div className={view === 'write' ? 'hidden md:block' : ''}>
            <Label className="hidden md:block">Preview</Label>
            <div className="min-h-[268px] rounded-md border border-border bg-bg p-3">
              {text.trim() ? <LazyMarkdown>{text}</LazyMarkdown> : <p className="text-sm text-faint">The rendered statement appears here.</p>}
            </div>
          </div>
        </div>
        {mode === 'suggest-edit' ? (
          <div className="mt-3 space-y-3">
            <div>
              <Label htmlFor="ed-note">What changed and why? (optional)</Label>
              <Input id="ed-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="e.g. Fixed a typo in the exponent" />
            </div>
            <label className="flex items-start gap-2 text-xs text-muted">
              <input type="checkbox" checked={material} onChange={(e) => setMaterial(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium text-text">This changes the question itself</span> (not just a typo or formatting). Existing ratings will be set aside and
                students asked to re-rate — moderators make the final call.
              </span>
            </label>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!hasChanges || busy} onClick={save}>
            {busy ? 'Saving…' : mode === 'add-statement' || isModerator ? 'Save' : 'Submit for review'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
