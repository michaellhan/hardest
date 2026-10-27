import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { Mail } from 'lucide-react'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { useAuth } from '@/hooks/useAuth'
import { getApi } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Passwordless sign-in: one email with both a magic link and a 6-digit code (the code helps when the link
 * opens in a different browser, e.g. a mail app on another device).
 */
export function SignInDialog() {
  const { signInOpen, closeSignIn, signInReason, pending, setPending } = useAuth()
  const location = useLocation()
  const api = getApi()
  const demo = api.mode === 'demo'
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!signInOpen) {
      setStep('email')
      setCode('')
      setError(null)
    }
  }, [signInOpen])

  const next = location.pathname + location.search

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const addr = email.trim()
    if (!demo && !EMAIL_RE.test(addr)) return setError('Enter a valid email address.')
    setBusy(true)
    setError(null)
    try {
      await api.auth.sendEmailLink(addr, next)
      if (!demo) setStep('code')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!/^\d{6,10}$/.test(code.trim())) return setError('Enter the code from the email.')
    setBusy(true)
    setError(null)
    try {
      await api.auth.verifyCode(email.trim(), code.trim())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const close = (open: boolean) => {
    if (open) return
    closeSignIn()
  }

  return (
    <Dialog open={signInOpen} onOpenChange={close}>
      <DialogContent
        title={step === 'code' ? 'Check your email' : 'Sign in to hardest'}
        description={
          step === 'code' ? (
            <>
              We sent a sign-in link and a code to <span className="font-medium text-text">{email.trim()}</span>. Click the link, or enter the code here.
            </>
          ) : (
            (signInReason ?? 'No password needed — we’ll email you a link.')
          )
        }
      >
        {pending && step === 'email' ? (
          <p className="mb-3 rounded-md bg-surface-2 px-3 py-2 text-xs text-muted">
            Your rating of <span className="font-semibold text-text">{pending.difficulty}/10</span> for {pending.label} will be saved as soon as you’re signed in.{' '}
            <button className="underline underline-offset-2 hover:text-text" onClick={() => setPending(null)}>
              Discard it
            </button>
          </p>
        ) : null}

        {demo ? (
          <form onSubmit={send} className="space-y-3">
            <p className="rounded-md border border-demo/40 bg-demo/10 px-3 py-2 text-xs text-text">
              <span className="font-semibold">Demo sandbox.</span> No email is sent. Signing in creates a temporary identity stored only in this browser, so you can
              try rating, uploading and moderating.
            </p>
            <div>
              <Label htmlFor="si-email">Email (optional in the demo)</Label>
              <Input id="si-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@college.harvard.edu" />
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              Continue in demo mode
            </Button>
          </form>
        ) : step === 'email' ? (
          <form onSubmit={send} className="space-y-3">
            <div>
              <Label htmlFor="si-email">Email</Label>
              <Input
                id="si-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@college.harvard.edu"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'si-error' : undefined}
              />
            </div>
            {error ? (
              <p id="si-error" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              <Mail /> {busy ? 'Sending…' : 'Email me a sign-in link'}
            </Button>
            {api.auth.googleEnabled ? (
              <>
                <div className="flex items-center gap-3 text-[11px] text-faint">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => api.auth.signInWithGoogle(next).catch((err) => setError(errorMessage(err)))}
                >
                  Continue with Google
                </Button>
              </>
            ) : null}
            <p className="text-[11px] leading-relaxed text-faint">
              Your individual ratings are private. Only aggregates are shown, and your email is never displayed.
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <div>
              <Label htmlFor="si-code">6-digit code</Label>
              <Input
                id="si-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="text-center font-mono text-lg tracking-[0.4em]"
                placeholder="••••••"
              />
            </div>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? 'Verifying…' : 'Sign in'}
            </Button>
            <div className="flex justify-between text-xs text-muted">
              <button type="button" className="hover:text-text" onClick={() => setStep('email')}>
                Use a different email
              </button>
              <button type="button" className="hover:text-text" disabled={busy} onClick={() => send()}>
                Resend
              </button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
