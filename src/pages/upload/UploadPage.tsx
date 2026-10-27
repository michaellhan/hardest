import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, ArrowRight, FileText, FileUp, ListOrdered, ScanLine, Type } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Badge, Segmented, Spinner } from '@/components/ui/misc'
import { Input, Label, Select, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/hooks/useAuth'
import { useOverview } from '@/hooks/queries'
import { useTitle } from '@/hooks/useMisc'
import { getApi, ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { ASSIGNMENT_TYPE_LABELS } from '@/lib/format'
import { extractFile, parseLabelList, type Extracted } from '@/lib/extract'
import { flattenDrafts, parseDocument, sha256Hex, validateDrafts, type DraftProblem, type ParseResult } from '@/lib/parser'
import type { AssignmentType, DuplicateCandidate, PublishProblemNode, StatementSource } from '@/lib/types'
import { ContextPicker, type OfferingContext } from './ContextStep'
import { PdfPreview, ReviewEditor } from './ReviewEditor'

type Step = 'context' | 'source' | 'review' | 'publish'
type SourceMode = 'file' | 'paste' | 'manual'
const STEPS: Array<{ id: Step; label: string }> = [
  { id: 'context', label: 'Course & assignment' },
  { id: 'source', label: 'Source' },
  { id: 'review', label: 'Review problems' },
  { id: 'publish', label: 'Publish' },
]

interface Meta {
  title: string
  type: AssignmentType
  number: string
  due: string
}

function draftsFromLabels(list: Array<{ label: string; children: string[] }>): DraftProblem[] {
  let n = 0
  const mk = (label: string, children: DraftProblem[] = []): DraftProblem => ({
    id: `m${++n}`, label, title: null, statementMarkdown: '', children, pageStart: null, pageEnd: null, confidence: 'high', warnings: [],
  })
  return list.map((p) => mk(p.label, p.children.map((c) => mk(c))))
}

function sourceOf(mode: SourceMode, kind: string | undefined): StatementSource {
  if (mode === 'manual') return 'none'
  if (mode === 'paste') return kind === 'tex' ? 'latex' : kind === 'markdown' ? 'markdown' : 'text'
  return ({ pdf: 'pdf', tex: 'latex', markdown: 'markdown', text: 'text', docx: 'docx' } as Record<string, StatementSource>)[kind ?? 'text'] ?? 'text'
}

export default function UploadPage() {
  useTitle('Add an assignment')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const { user, openSignIn } = useAuth()

  const [step, setStep] = useState<Step>('context')
  const [ctx, setCtx] = useState<OfferingContext | null>(null)
  const overview = useOverview(ctx?.offeringId)
  const [existingId, setExistingId] = useState<string | null>(params.get('assignment'))
  const [meta, setMeta] = useState<Meta>({ title: '', type: 'problem_set', number: '', due: '' })

  const [mode, setMode] = useState<SourceMode>(params.get('mode') === 'manual' ? 'manual' : 'file')
  const [file, setFile] = useState<File | null>(null)
  const [extracted, setExtracted] = useState<Extracted | null>(null)
  const [checksum, setChecksum] = useState<string | null>(null)
  const [pasteKind, setPasteKind] = useState<'text' | 'markdown' | 'tex'>('text')
  const [pasteText, setPasteText] = useState('')
  const [manualText, setManualText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [sourceError, setSourceError] = useState<string | null>(null)
  const [parse, setParse] = useState<ParseResult | null>(null)
  const [drafts, setDrafts] = useState<DraftProblem[]>([])

  const [dups, setDups] = useState<DuplicateCandidate[] | null>(null)
  const [dupChoice, setDupChoice] = useState<string | 'distinct' | null>(null)
  const [publishStatements, setPublishStatements] = useState(true)
  const [storeFile, setStoreFile] = useState(true)
  const [publicFile, setPublicFile] = useState(false)
  const [attest, setAttest] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const published = useRef(false)

  const existing = overview.data?.assignments.find((a) => a.id === existingId) ?? null

  // Warn before losing a reviewed parse.
  useEffect(() => {
    if (!drafts.length) return
    const h = (e: BeforeUnloadEvent) => {
      if (!published.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [drafts.length])

  useEffect(() => () => extracted?.pdf?.destroy(), [extracted])

  const hasStatements = drafts.some((d) => flattenDrafts([d]).some((f) => f.problem.statementMarkdown.trim()))
  const errors = useMemo(() => {
    const e = validateDrafts(drafts)
    if (!drafts.length) e.unshift('Add at least one problem.')
    return e
  }, [drafts])
  const counts = useMemo(() => {
    const flat = flattenDrafts(drafts)
    return { top: drafts.length, parts: flat.filter((f) => f.depth === 1).length, withText: flat.filter((f) => f.problem.statementMarkdown.trim()).length }
  }, [drafts])

  const contextValid = Boolean(ctx) && (existingId ? Boolean(existing) : meta.title.trim().length > 0)

  // ── source handling
  const applyParse = (res: ParseResult) => {
    setParse(res)
    setDrafts(res.problems)
    setPublishStatements(res.quality.status !== 'likely_scanned')
    setMeta((m) => ({
      ...m,
      title: m.title || res.guessedTitle || '',
      number: m.number || (res.guessedNumber != null ? String(res.guessedNumber) : ''),
      due: m.due || res.guessedDueDate || '',
    }))
    setStep('review')
  }

  const onFile = async (f: File | null) => {
    if (!f) return
    setSourceError(null)
    setBusy('Reading file…')
    try {
      extracted?.pdf?.destroy()
      const ex = await extractFile(f, setBusy)
      setBusy('Finding problems…')
      const [sum] = await Promise.all([sha256Hex(await f.arrayBuffer())])
      setFile(f)
      setExtracted(ex)
      setChecksum(sum)
      applyParse(parseDocument(ex.kind === 'pdf' ? { kind: 'pdf', pages: ex.pages, texMath: ex.mathMarkup } : { kind: ex.kind, text: ex.text }))
    } catch (e) {
      setSourceError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const onPaste = async () => {
    setSourceError(null)
    if (pasteText.trim().length < 3) return setSourceError('Paste the assignment text first.')
    setFile(null)
    setExtracted(null)
    setChecksum(await sha256Hex(pasteText))
    applyParse(parseDocument({ kind: pasteKind, text: pasteText }))
  }

  const onManual = () => {
    setSourceError(null)
    const list = parseLabelList(manualText)
    if (!list.length) return setSourceError('Enter at least one problem label, e.g. “1, 2, 3a, 3b, 4” or “1-6”.')
    setFile(null)
    setExtracted(null)
    setChecksum(null)
    setParse(null)
    setDrafts(draftsFromLabels(list))
    setPublishStatements(false)
    setStep('review')
  }

  // ── duplicate check on entering the publish step
  const goPublish = async () => {
    setStep('publish')
    setDups(null)
    setDupChoice(null)
    if (existingId || !ctx) return setDups([])
    try {
      const flat = flattenDrafts(drafts)
      const res = await getApi().findDuplicates({
        offeringId: ctx.offeringId,
        title: meta.title.trim(),
        type: meta.type,
        number: meta.number ? Number(meta.number) : null,
        checksum,
        labels: drafts.map((d) => d.label.trim()),
        textSample: flat.map((f) => f.problem.statementMarkdown).join('\n').slice(0, 4000) || null,
      })
      setDups(res)
    } catch {
      setDups([])
    }
  }

  const toNode = (d: DraftProblem): PublishProblemNode => ({
    label: d.label.trim(),
    title: d.title?.trim() || null,
    statement_markdown: d.statementMarkdown.trim() || null,
    statement_source: sourceOf(mode, mode === 'paste' ? pasteKind : extracted?.kind),
    source_page_start: d.pageStart,
    source_page_end: d.pageEnd,
    children: d.children.map(toNode),
  })

  const publish = async () => {
    if (!ctx) return
    if (!user) return openSignIn('Sign in to publish. Your draft stays here while you sign in.')
    setPublishing(true)
    try {
      const api = getApi()
      const intoId = existingId ?? (dupChoice && dupChoice !== 'distinct' ? dupChoice : null)
      let docId: string | null = null
      if (file && extracted) {
        const doc = await api.registerDocument({
          offeringId: ctx.offeringId,
          filename: file.name,
          fileType: extracted.fileKind,
          sizeBytes: file.size,
          checksum,
          pageCount: extracted.pageCount,
          visibility: publicFile ? 'public' : 'private',
          storeFile,
        })
        docId = doc.id
        if (storeFile && doc.storage_path) await api.uploadDocument(doc.storage_path, file)
      }
      const res = await api.publishAssignment({
        offering_id: ctx.offeringId,
        assignment_id: intoId,
        assignment: intoId
          ? undefined
          : { title: meta.title.trim(), assignment_type: meta.type, assignment_number: meta.number ? Number(meta.number) : null, due_date: meta.due || null, description: null },
        source_document_id: docId,
        publish_statements: publishStatements,
        force_distinct: dupChoice === 'distinct',
        problems: drafts.map(toNode),
      })
      published.current = true
      qc.invalidateQueries({ queryKey: ['overview', ctx.offeringId] })
      qc.invalidateQueries({ queryKey: ['featured'] })
      toast({
        tone: 'success',
        // res.created counts parts too.
        message: `Published ${res.created} new ${counts.parts ? 'problems and parts' : res.created === 1 ? 'problem' : 'problems'}${res.skipped.length ? ` (already there: ${res.skipped.join(', ')})` : ''}.`,
      })
      navigate(`/${ctx.universitySlug}/${ctx.courseSlug}/${ctx.offeringSlug}/${res.assignment_slug}`)
    } catch (e) {
      if (e instanceof ApiError && e.hint === 'duplicate_assignment') {
        toast({ tone: 'info', message: 'This looks like an assignment that already exists. Choose how to proceed.' })
        await goPublish()
      } else toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setPublishing(false)
    }
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  return (
    <div className={cn('mx-auto px-4 py-8 sm:px-6', step === 'review' ? 'max-w-[1440px]' : 'max-w-3xl')}>
      <h1 className="text-2xl font-semibold tracking-tight">Add an assignment</h1>
      <p className="mt-1 text-sm text-muted">Files are read in your browser. Nothing is published until you review it and press Publish.</p>

      <ol className="mt-6 flex gap-1 text-xs" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex-1">
            <div className={cn('h-1 rounded-full', i <= stepIndex ? 'bg-text' : 'bg-surface-3')} />
            <span className={cn('mt-1.5 block truncate', i === stepIndex ? 'font-medium text-text' : 'text-faint')} aria-current={i === stepIndex ? 'step' : undefined}>
              {i + 1}. {s.label}
            </span>
          </li>
        ))}
      </ol>

      {step === 'context' ? (
        <section className="mt-8 space-y-8">
          <ContextPicker initialOfferingId={params.get('offering')} value={ctx} onChange={setCtx} />
          {ctx ? (
            <div>
              <Label>Assignment</Label>
              <Segmented
                label="New or existing assignment"
                value={existingId ? 'existing' : 'new'}
                onChange={(v) => setExistingId(v === 'existing' ? overview.data?.assignments[0]?.id ?? null : null)}
                options={[
                  { value: 'new', label: 'New assignment' },
                  { value: 'existing', label: 'Add to an existing one', title: overview.data?.assignments.length ? undefined : 'No assignments yet' },
                ]}
              />
              {existingId !== null ? (
                <div className="mt-3">
                  <Select aria-label="Existing assignment" value={existingId} onChange={(e) => setExistingId(e.target.value)}>
                    {(overview.data?.assignments ?? []).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.title} ({a.problems.filter((p) => !p.parent_problem_id).length} problems)
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1.5 text-xs text-muted">Problems that already exist are kept as they are (with their ratings); only missing problems and parts are added.</p>
                </div>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_180px]">
                  <div>
                    <Label htmlFor="m-title">Title</Label>
                    <Input id="m-title" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="Problem Set 4" maxLength={200} />
                    <p className="mt-1 text-[11px] text-faint">You can leave this blank for now; we’ll suggest one from the file.</p>
                  </div>
                  <div>
                    <Label htmlFor="m-type">Type</Label>
                    <Select id="m-type" value={meta.type} onChange={(e) => setMeta({ ...meta, type: e.target.value as AssignmentType })}>
                      {Object.entries(ASSIGNMENT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="m-num">Number (optional)</Label>
                    <Input id="m-num" inputMode="decimal" value={meta.number} onChange={(e) => setMeta({ ...meta, number: e.target.value.replace(/[^\d.]/g, '') })} placeholder="4" />
                  </div>
                  <div>
                    <Label htmlFor="m-due">Due date (optional)</Label>
                    <Input id="m-due" type="date" value={meta.due} onChange={(e) => setMeta({ ...meta, due: e.target.value })} />
                  </div>
                </div>
              )}
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button variant="primary" disabled={!ctx || (existingId !== null && !existing)} onClick={() => setStep('source')}>
              Next <ArrowRight />
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'source' ? (
        <section className="mt-8">
          <Segmented
            label="Source"
            value={mode}
            onChange={(m) => {
              setMode(m)
              setSourceError(null)
            }}
            options={[
              { value: 'file', label: <span className="inline-flex items-center gap-1.5"><FileUp className="size-3.5" />Upload a file</span> },
              { value: 'paste', label: <span className="inline-flex items-center gap-1.5"><Type className="size-3.5" />Paste text</span> },
              { value: 'manual', label: <span className="inline-flex items-center gap-1.5"><ListOrdered className="size-3.5" />Problem numbers only</span> },
            ]}
          />
          <div className="mt-5">
            {mode === 'file' ? (
              <DropZone onFile={onFile} busy={busy} />
            ) : mode === 'paste' ? (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Label htmlFor="paste" className="mb-0">Assignment text</Label>
                  <Select aria-label="Format" value={pasteKind} onChange={(e) => setPasteKind(e.target.value as typeof pasteKind)} className="ml-auto h-8 w-40 text-xs">
                    <option value="text">Plain text</option>
                    <option value="markdown">Markdown</option>
                    <option value="tex">LaTeX</option>
                  </Select>
                </div>
                <Textarea id="paste" rows={14} value={pasteText} onChange={(e) => setPasteText(e.target.value)} className="font-mono text-[12.5px]" placeholder={'Problem 1. Let $G$ be a group…\n\nProblem 2. …'} maxLength={400000} />
                <div className="mt-3 flex justify-end">
                  <Button variant="primary" onClick={onPaste}>
                    Find problems <ArrowRight />
                  </Button>
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor="manual">Problem labels</Label>
                <Textarea id="manual" rows={4} value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="1, 2, 3a, 3b, 4, 5   — or —   1-6" />
                <p className="mt-1.5 text-xs text-muted">Creates rateable problems without statements. Anyone can add the statements later.</p>
                <div className="mt-3 flex justify-end">
                  <Button variant="primary" onClick={onManual}>
                    Continue <ArrowRight />
                  </Button>
                </div>
              </div>
            )}
            {sourceError ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-danger" role="alert">
                <AlertTriangle className="size-4" /> {sourceError}
              </p>
            ) : null}
          </div>
          <div className="mt-8">
            <Button variant="ghost" onClick={() => setStep('context')}>
              <ArrowLeft /> Back
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'review' ? (
        <section className="mt-8">
          <QualityBanner parse={parse} onManual={() => { setMode('manual'); setStep('source') }} />
          <div className={cn('mt-4 grid gap-6', (extracted?.pdf || parse) && 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]')}>
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{counts.top} problems{counts.parts ? `, ${counts.parts} parts` : ''}</span>
                <span className="text-muted">· {counts.withText} with statements</span>
                {file ? <Badge tone="outline"><FileText className="mr-1 size-3" />{file.name}</Badge> : null}
              </div>
              <ReviewEditor drafts={drafts} onChange={setDrafts} showStatements={mode !== 'manual' || hasStatements} />
              {drafts.length === 0 ? (
                <Button className="mt-2" variant="outline" size="sm" onClick={() => setDrafts(draftsFromLabels([{ label: '1', children: [] }]))}>
                  Add a problem
                </Button>
              ) : null}
            </div>
            {extracted?.pdf ? (
              <aside className="min-w-0 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto" aria-label="Original PDF">
                <p className="mb-2 text-xs text-muted">Original — check that every problem was split correctly.</p>
                <PdfPreview pdf={extracted.pdf} />
              </aside>
            ) : parse ? (
              <aside className="min-w-0 lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto" aria-label="Source text">
                <p className="mb-2 text-xs text-muted">Source text</p>
                <pre className="rounded-md border border-border bg-surface p-3 font-mono text-[11.5px] whitespace-pre-wrap text-muted">{(extracted?.text ?? pasteText).slice(0, 60000)}</pre>
              </aside>
            ) : null}
          </div>
          <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-bg/95 py-3 backdrop-blur">
            <Button variant="ghost" onClick={() => setStep('source')}>
              <ArrowLeft /> Back
            </Button>
            {errors.length ? <p className="min-w-0 flex-1 truncate text-xs text-danger" role="alert">{errors[0]}{errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}</p> : <span className="flex-1" />}
            {!existingId && !meta.title.trim() ? <Input aria-label="Assignment title" placeholder="Assignment title" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} className="h-9 w-56" /> : null}
            <Button variant="primary" disabled={errors.length > 0 || !contextValid} onClick={goPublish}>
              Continue <ArrowRight />
            </Button>
          </div>
        </section>
      ) : null}

      {step === 'publish' && ctx ? (
        <section className="mt-8 space-y-6">
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <p>
              <span className="font-semibold">{existing ? existing.title : meta.title}</span>
              <span className="text-muted">
                {' '}
                · {ctx.courseCode} · {ctx.offeringLabel}
              </span>
            </p>
            <p className="mt-1 text-muted">
              {counts.top} problems{counts.parts ? ` and ${counts.parts} parts` : ''}
              {existing ? ' — existing problems are skipped, missing ones added' : ''}
            </p>
          </div>

          {dups === null ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Checking for duplicates…
            </p>
          ) : dups.length ? (
            <fieldset className="rounded-xl border border-warn/40 bg-warn/5 p-4">
              <legend className="px-1 text-sm font-semibold">This may already be on the site</legend>
              <div className="space-y-2">
                {dups.map((d) => (
                  <label key={d.assignment_id} className={cn('flex gap-3 rounded-md p-2', !d.same_offering && 'opacity-80')}>
                    <input type="radio" name="dup" className="mt-1" disabled={!d.same_offering} checked={dupChoice === d.assignment_id} onChange={() => setDupChoice(d.assignment_id)} />
                    <span className="text-sm">
                      <span className="font-medium">{d.same_offering ? 'Add to' : 'Similar to'} “{d.title}”</span>{' '}
                      <span className="text-muted">
                        · {d.offering_label} · {d.problem_count} problems · {Math.round(d.score * 100)}% match
                      </span>
                      <span className="block text-xs text-faint">{d.reasons.join(' · ')}</span>
                    </span>
                  </label>
                ))}
                <label className="flex gap-3 rounded-md p-2">
                  <input type="radio" name="dup" className="mt-1" checked={dupChoice === 'distinct'} onChange={() => setDupChoice('distinct')} />
                  <span className="text-sm font-medium">It’s a different assignment — publish it separately</span>
                </label>
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-muted">No duplicates found.</p>
          )}

          <fieldset className="space-y-3">
            <legend className="mb-2 text-sm font-semibold">What to publish</legend>
            <label className={cn('flex gap-3 text-sm', !hasStatements && 'opacity-50')}>
              <input type="checkbox" className="mt-0.5" checked={publishStatements && hasStatements} disabled={!hasStatements} onChange={(e) => setPublishStatements(e.target.checked)} />
              <span>
                Publish problem statements <span className="block text-xs text-muted">Uncheck to publish only labels and titles (metadata-only); statements can be added later.</span>
              </span>
            </label>
            {file ? (
              <>
                <label className="flex gap-3 text-sm">
                  <input type="checkbox" className="mt-0.5" checked={storeFile} onChange={(e) => setStoreFile(e.target.checked)} />
                  <span>
                    Keep the original file <span className="block text-xs text-muted">Stored privately (only you and moderators can open it) unless you choose otherwise below. Used to verify the parse and spot duplicates.</span>
                  </span>
                </label>
                {storeFile ? (
                  <label className="ml-7 flex gap-3 text-sm">
                    <input type="checkbox" className="mt-0.5" checked={publicFile} onChange={(e) => setPublicFile(e.target.checked)} />
                    <span>
                      Let other students open the original file <span className="block text-xs text-muted">Only if the course made it publicly available.</span>
                    </span>
                  </label>
                ) : null}
              </>
            ) : null}
          </fieldset>

          <label className="flex gap-3 rounded-xl border border-border p-4 text-sm">
            <input type="checkbox" className="mt-0.5" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>
              I have the right to share this. It contains <span className="font-medium">questions only — no solutions</span>, and nothing the course marked confidential.{' '}
              <Link to="/about#content" className="text-muted underline underline-offset-2" target="_blank">
                Content policy
              </Link>
            </span>
          </label>

          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => setStep('review')}>
              <ArrowLeft /> Back to review
            </Button>
            <Button
              variant="primary"
              className="ml-auto"
              disabled={!attest || publishing || dups === null || (dups.length > 0 && !dupChoice)}
              onClick={publish}
            >
              {publishing ? 'Publishing…' : user ? 'Publish' : 'Sign in & publish'}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  )
}

function DropZone({ onFile, busy }: { onFile: (f: File | null) => void; busy: string | null }) {
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFile(e.dataTransfer.files[0] ?? null)
      }}
      className={cn('flex flex-col items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors', over ? 'border-text bg-surface-2' : 'border-border-strong')}
    >
      {busy ? (
        <>
          <Spinner className="size-5 text-muted" />
          <p className="mt-3 text-sm text-muted" aria-live="polite">{busy}</p>
        </>
      ) : (
        <>
          <FileUp className="size-6 text-faint" />
          <p className="mt-3 text-sm font-medium">Drop a file here, or</p>
          <Button className="mt-3" variant="outline" onClick={() => input.current?.click()}>
            Choose a file
          </Button>
          <p className="mt-3 text-xs text-faint">PDF, LaTeX (.tex), Markdown, plain text, or Word (.docx) · up to 20 MB</p>
          <input ref={input} type="file" className="sr-only" accept=".pdf,.tex,.ltx,.md,.markdown,.txt,.docx,application/pdf,text/plain" onChange={(e) => onFile(e.target.files?.[0] ?? null)} aria-label="Choose a file" />
        </>
      )}
    </div>
  )
}

function QualityBanner({ parse, onManual }: { parse: ParseResult | null; onManual: () => void }) {
  if (!parse) return null
  const q = parse.quality
  const tone =
    q.status === 'ok'
      ? null
      : q.status === 'likely_scanned' || q.status === 'empty'
        ? { icon: <ScanLine className="size-4" />, title: 'This looks like a scanned PDF', body: 'We couldn’t read text from it. You can still publish problem numbers and add statements by hand.' }
        : q.status === 'no_problems_found'
          ? { icon: <AlertTriangle className="size-4" />, title: 'No problem headings found', body: 'Everything was put into one problem. Split it below, or enter problem numbers only.' }
          : { icon: <AlertTriangle className="size-4" />, title: 'Please check the split carefully', body: 'Some parts were ambiguous (see warnings). Math extracted from PDFs can be garbled; fix it or leave the statement out.' }
  return (
    <div className="space-y-2">
      {tone ? (
        <div className="flex gap-3 rounded-lg border border-warn/40 bg-warn/5 px-4 py-3 text-sm" role="status">
          <span className="mt-0.5 text-warn">{tone.icon}</span>
          <div className="flex-1">
            <p className="font-medium">{tone.title}</p>
            <p className="text-muted">{tone.body}</p>
          </div>
          {q.status !== 'needs_review' ? (
            <Button size="sm" variant="outline" onClick={onManual}>
              Enter numbers only
            </Button>
          ) : null}
        </div>
      ) : null}
      {parse.warnings.length ? (
        <ul className="text-xs text-warn">
          {parse.warnings.map((w, i) => (
            <li key={i}>· {w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
