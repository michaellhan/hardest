import { useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, FlaskConical, LogOut, RotateCcw, UserRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/input'
import { Badge, EmptyState, Segmented, Skeleton, Toggle } from '@/components/ui/misc'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/hooks/useAuth'
import { useSavedCourses, useToggleSaved } from '@/hooks/queries'
import { getApi } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatCount, offeringLabel, relativeTime, sortOfferings } from '@/lib/format'
import type { AppRole, Profile } from '@/lib/types'

export default function MePage() {
  const { user, ready, profile, openSignIn } = useAuth()
  const isDemo = Boolean(getApi().demo)

  if (!ready) {
    return (
      <Page>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-6 h-40 w-full" />
        <Skeleton className="mt-4 h-28 w-full" />
      </Page>
    )
  }

  if (!user) {
    return (
      <Page>
        <h1 className="text-xl font-semibold tracking-tight">Your account</h1>
        <EmptyState
          className="mt-6"
          icon={<UserRound />}
          title="Sign in to see your courses"
          action={
            <Button variant="primary" onClick={() => openSignIn()}>
              Sign in
            </Button>
          }
        >
          Signing in lets you rate problems, save courses, and contribute assignments. Your ratings are always private.
        </EmptyState>
        {isDemo ? <DemoControls role={null} /> : null}
      </Page>
    )
  }

  return (
    <Page>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Your account</h1>
        <p className="min-w-0 truncate text-sm text-muted">{user.email ?? 'No email on file'}</p>
        {user.isDemo ? <Badge tone="demo">Demo account</Badge> : null}
        {profile && profile.role !== 'user' ? <Badge tone="outline">{profile.role === 'admin' ? 'Admin' : 'Moderator'}</Badge> : null}
      </div>

      <div className="mt-6 space-y-4">
        <Card title="Profile" description="Ratings are always private — your name is never attached to a rating, even if you choose to show it on contributions.">
          {profile ? <ProfileForm key={profile.id} profile={profile} /> : <ProfileSkeleton />}
        </Card>
        <SavedCourses />
        <RatedCourses userId={user.id} />
        {isDemo ? <DemoControls role={profile?.role ?? 'user'} /> : null}
        <SignOutCard />
      </div>
    </Page>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</div>
}

function Card({ title, description, action, children }: { title: string; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  const id = `me-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={id} className="text-sm font-semibold tracking-tight">
            {title}
          </h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

function ProfileSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-full max-w-sm" />
      <Skeleton className="h-4 w-56" />
    </div>
  )
}

function ProfileForm({ profile }: { profile: Profile }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(profile.display_name ?? '')
  const [showName, setShowName] = useState(profile.show_name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmed = name.trim()
  const dirty = (trimmed || null) !== (profile.display_name ?? null) || showName !== profile.show_name

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (trimmed.length > 60) {
      setError('Keep it under 60 characters.')
      return
    }
    if (showName && !trimmed) {
      setError('Add a display name to show it on your contributions.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await getApi().updateProfile({ display_name: trimmed || null, show_name: showName })
      await qc.invalidateQueries({ queryKey: ['me', 'profile'] })
      toast({ tone: 'success', message: 'Profile saved.' })
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3" noValidate>
      <Field label="Display name" htmlFor="me-display-name" error={error ?? undefined} hint="Optional. Shown only where you choose below." className="max-w-sm">
        <Input
          id="me-display-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          maxLength={80}
          autoComplete="nickname"
          placeholder="e.g. Alex K."
          aria-invalid={Boolean(error)}
        />
      </Field>
      <Toggle
        checked={showName}
        onChange={(v) => {
          setShowName(v)
          setError(null)
        }}
        label="Show my name on assignments and edits I contribute"
      />
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" variant="primary" disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        {dirty && !busy ? <span className="text-xs text-faint">Unsaved changes</span> : null}
      </div>
    </form>
  )
}

function SavedCourses() {
  const q = useSavedCourses()
  const toggle = useToggleSaved()
  const toast = useToast()

  const unsave = (courseId: string, code: string) =>
    toggle.mutate(
      { courseId, saved: false },
      {
        onSuccess: () =>
          toast({
            tone: 'success',
            message: `Removed ${code} from saved courses.`,
            action: { label: 'Undo', onClick: () => toggle.mutate({ courseId, saved: true }) },
          }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )

  return (
    <Card title="Saved courses">
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <p className="text-sm text-danger">{errorMessage(q.error)}</p>
      ) : !q.data?.length ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Bookmark className="size-4 shrink-0 text-faint" aria-hidden />
          Save a course from its page to keep it here.
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {q.data.map(({ course, university, offerings }) => {
            const sorted = sortOfferings(offerings)
            const latest = sorted[0]
            const href = latest ? `/${university.slug}/${course.slug}/${latest.slug}` : `/${university.slug}/${course.slug}`
            return (
              <li key={course.id} className="flex items-center gap-3 px-1 py-2.5">
                <div className="min-w-0 flex-1">
                  <Link to={href} className="block truncate text-sm hover:underline">
                    <span className="font-medium">{course.code}</span> <span className="text-muted">{course.name}</span>
                  </Link>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-faint">
                    <span>{university.short_name ?? university.name}</span>
                    {sorted.slice(0, 3).map((o) => (
                      <span key={o.id} className="contents">
                        <span aria-hidden>·</span>
                        <Link to={`/${university.slug}/${course.slug}/${o.slug}`} className="hover:text-text hover:underline">
                          {offeringLabel(o)}
                        </Link>
                      </span>
                    ))}
                    {sorted.length > 3 ? <span>· +{sorted.length - 3} more</span> : null}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${course.code} from saved courses`}
                  title="Remove from saved"
                  disabled={toggle.isPending && toggle.variables?.courseId === course.id}
                  onClick={() => unsave(course.id, course.code)}
                >
                  <X />
                </Button>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

function RatedCourses({ userId }: { userId: string }) {
  const q = useQuery({ queryKey: ['me', 'rated', userId], queryFn: () => getApi().myRatedOfferings() })
  const rows = q.data ? [...q.data].sort((a, b) => b.last_rated_at.localeCompare(a.last_rated_at)) : []

  return (
    <Card title="Courses you’ve rated" description="Only you can see this list.">
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <p className="text-sm text-danger">{errorMessage(q.error)}</p>
      ) : !rows.length ? (
        <p className="text-sm text-muted">
          You haven’t rated any problems yet.{' '}
          <Link to="/" className="text-text underline-offset-4 hover:underline">
            Find a course
          </Link>
        </p>
      ) : (
        <ul className="-mx-1 divide-y divide-border">
          {rows.map(({ offering, course, university, rated, last_rated_at }) => (
            <li key={offering.id} className="px-1 py-2.5">
              <Link to={`/${university.slug}/${course.slug}/${offering.slug}`} className="group flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm group-hover:underline">
                    <span className="font-medium">{course.code}</span> <span className="text-muted">{course.name}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-faint">
                    {offeringLabel(offering)} · {university.short_name ?? university.name}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs tabular">
                  <p className="text-text">{formatCount(rated, 'problem')}</p>
                  <p className="text-faint">
                    <time dateTime={last_rated_at} title={new Date(last_rated_at).toLocaleString()}>
                      {relativeTime(last_rated_at)}
                    </time>
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3 py-1">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  )
}

const ROLE_OPTIONS: Array<{ value: AppRole; label: string }> = [
  { value: 'user', label: 'User' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'admin', label: 'Admin' },
]

function DemoControls({ role }: { role: AppRole | null }) {
  const api = getApi()
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmReset, setConfirmReset] = useState(false)
  if (!api.demo) return null
  const demo = api.demo

  const setRole = (r: AppRole) => {
    demo.setRole(r)
    qc.invalidateQueries({ queryKey: ['me'] })
    qc.invalidateQueries({ queryKey: ['moderation'] })
    toast({ tone: 'info', message: `You’re now acting as ${r === 'user' ? 'a regular user' : `an ${r === 'admin' ? 'admin' : 'moderator'}`}.` })
  }

  return (
    <div className={role === null ? 'mt-4' : undefined}>
      <Card
        title="Demo controls"
        description="This sandbox runs entirely in your browser with synthetic data. Nothing here reaches a server."
        action={
          <Badge tone="demo">
            <FlaskConical className="size-3" aria-hidden /> Demo
          </Badge>
        }
      >
        <div className="space-y-4">
          {role !== null ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted">
                Act as
              </p>
              <Segmented label="Demo role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
              <p className="mt-1.5 text-xs text-faint">
                Moderators and admins see the{' '}
                <Link to="/moderation" className="text-muted underline-offset-4 hover:text-text hover:underline">
                  moderation queue
                </Link>{' '}
                and their edits apply immediately.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)}>
              <RotateCcw /> Reset demo data
            </Button>
            <span className="text-xs text-faint">Clears your ratings, uploads, and edits in this browser.</span>
          </div>
        </div>
      </Card>

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent title="Reset demo data?" description="Everything you’ve added or rated in this demo will be erased and the sample data restored. This can’t be undone.">
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                demo.reset()
                window.location.reload()
              }}
            >
              Reset
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SignOutCard() {
  const { signOut } = useAuth()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <div className="flex justify-end pt-2">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          try {
            await signOut()
            toast({ tone: 'success', message: 'Signed out.' })
          } catch (e) {
            toast({ tone: 'error', message: errorMessage(e) })
            setBusy(false)
          }
        }}
      >
        <LogOut /> {busy ? 'Signing out…' : 'Sign out'}
      </Button>
    </div>
  )
}
