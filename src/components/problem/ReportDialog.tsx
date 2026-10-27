import { useState } from 'react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { getApi } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { displayLabel } from '@/lib/stats'
import type { OfferingOverview, ReportKind } from '@/lib/types'

const KINDS: Array<{ value: ReportKind; label: string }> = [
  { value: 'incorrect_statement', label: 'The statement is wrong or incomplete' },
  { value: 'incorrect_parsing', label: 'Problems were split or numbered incorrectly' },
  { value: 'duplicate', label: 'This duplicates another problem' },
  { value: 'content_concern', label: 'Copyright, privacy, or inappropriate content' },
  { value: 'other', label: 'Something else' },
]

export function ReportDialog({ open, onOpenChange, problemId, assignmentId, overview, label }: { open: boolean; onOpenChange: (v: boolean) => void; problemId: string; assignmentId: string; overview?: OfferingOverview; label: string }) {
  const toast = useToast()
  const [kind, setKind] = useState<ReportKind>('incorrect_statement')
  const [details, setDetails] = useState('')
  const [dup, setDup] = useState('')
  const [busy, setBusy] = useState(false)

  const options =
    overview?.assignments.flatMap((a) => {
      const byId = new Map(a.problems.map((p) => [p.id, p]))
      return a.problems.filter((p) => p.id !== problemId).map((p) => ({ id: p.id, text: `${a.title} · ${displayLabel(p, p.parent_problem_id ? byId.get(p.parent_problem_id)?.label : null)}` }))
    }) ?? []

  const submit = async () => {
    setBusy(true)
    try {
      await getApi().report({ problemId, assignmentId, kind, details: details.trim(), duplicateOfProblemId: kind === 'duplicate' && dup ? dup : null })
      toast({ tone: 'success', message: 'Report sent. A moderator will take a look.' })
      onOpenChange(false)
      setDetails('')
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Report a problem with ${label}`} description="Reports go to moderators. Your identity isn’t shown to other students.">
        <fieldset className="space-y-1.5">
          {KINDS.map((k) => (
            <label key={k.value} className="flex items-center gap-2 text-sm">
              <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} />
              {k.label}
            </label>
          ))}
        </fieldset>
        {kind === 'duplicate' ? (
          <div className="mt-3">
            <Label htmlFor="dup-of">Duplicate of</Label>
            <Select id="dup-of" value={dup} onChange={(e) => setDup(e.target.value)}>
              <option value="">Choose a problem in this semester…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.text}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="mt-3">
          <Label htmlFor="rep-details">Details</Label>
          <Textarea id="rep-details" rows={4} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} placeholder="What’s wrong, and what should it be?" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || (kind === 'duplicate' && !dup && !details.trim())} onClick={submit}>
            {busy ? 'Sending…' : 'Send report'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
