import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { DropdownMenu } from 'radix-ui'
import { FlaskConical, LogOut, MessageSquare, Monitor, Moon, Search, Shield, Sun, Upload, User } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/misc'
import { Label, Textarea } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { getApi } from '@/lib/api'
import { config, setDemoMode } from '@/lib/env'
import { errorMessage } from '@/lib/errors'
import { SignInDialog } from './SignInDialog'
import { CourseSearch } from './CourseSearch'

export function Logo({ className }: { className?: string }) {
  // Four cells of the difficulty scale: the product in miniature.
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span className="grid grid-cols-2 gap-[2px]" aria-hidden>
        <span className="size-[7px] rounded-[2px] bg-[#9cc08f]" />
        <span className="size-[7px] rounded-[2px] bg-[#e5c07a]" />
        <span className="size-[7px] rounded-[2px] bg-[#e49a6c]" />
        <span className="size-[7px] rounded-[2px] bg-[#c8564a]" />
      </span>
      hardest
    </span>
  )
}

function DemoBanner() {
  if (!config.demo) return null
  return (
    <div className="border-b border-demo/30 bg-demo-bg px-4 py-1.5 text-center text-xs text-text" role="note">
      <FlaskConical className="mr-1.5 inline size-3.5 -translate-y-px text-demo" aria-hidden />
      <span className="font-semibold">Demo sandbox</span> — every assignment, problem statement and rating shown is <span className="font-semibold">synthetic</span>, and your changes stay in
      this browser.{' '}
      {config.backendConfigured ? (
        <button className="underline underline-offset-2" onClick={() => setDemoMode(false)}>
          Leave the demo
        </button>
      ) : (
        <Link to="/about#demo" className="underline underline-offset-2">
          Learn more
        </Link>
      )}
    </div>
  )
}

function ThemeMenuItems() {
  const { pref, setPref } = useTheme()
  const opts = [
    { v: 'light', label: 'Light', Icon: Sun },
    { v: 'dark', label: 'Dark', Icon: Moon },
    { v: 'system', label: 'System', Icon: Monitor },
  ] as const
  return (
    <DropdownMenu.RadioGroup value={pref} onValueChange={(v) => setPref(v as 'light' | 'dark' | 'system')}>
      {opts.map(({ v, label, Icon }) => (
        <DropdownMenu.RadioItem key={v} value={v} className={menuItem}>
          <Icon className="size-4 text-muted" /> {label}
          <DropdownMenu.ItemIndicator className="ml-auto text-xs text-muted">✓</DropdownMenu.ItemIndicator>
        </DropdownMenu.RadioItem>
      ))}
    </DropdownMenu.RadioGroup>
  )
}

const menuItem = 'flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-surface-2'
const menuContent = 'z-50 min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-lg shadow-black/5 animate-fade-in'

function AccountMenu() {
  const { user, isModerator, openSignIn, signOut, ready } = useAuth()
  const { theme, setPref } = useTheme()
  if (!user) {
    return (
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Toggle dark mode" onClick={() => setPref(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </Button>
        <Button size="sm" variant="outline" onClick={() => openSignIn()} disabled={!ready}>
          Sign in
        </Button>
      </div>
    )
  }
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex size-8 items-center justify-center rounded-full border border-border bg-surface-2 text-xs font-semibold uppercase hover:border-border-strong" aria-label="Account menu">
          {(user.email ?? '?').slice(0, 1)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={menuContent}>
          <div className="px-2 pt-1.5 pb-2 text-xs text-muted">
            Signed in as
            <div className="truncate font-medium text-text">{user.email ?? 'demo user'}</div>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild className={menuItem}>
            <Link to="/me">
              <User className="size-4 text-muted" /> My courses &amp; settings
            </Link>
          </DropdownMenu.Item>
          {isModerator ? (
            <DropdownMenu.Item asChild className={menuItem}>
              <Link to="/moderation">
                <Shield className="size-4 text-muted" /> Moderation
              </Link>
            </DropdownMenu.Item>
          ) : null}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <ThemeMenuItems />
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={menuItem} onSelect={() => void signOut()}>
            <LogOut className="size-4 text-muted" /> Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function Header({ onSearch }: { onSearch: () => void }) {
  const navCls = ({ isActive }: { isActive: boolean }) => cn('rounded-md px-2.5 py-1.5 text-sm text-muted hover:text-text', isActive && 'text-text')
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="mr-2 rounded-md text-[15px]" aria-label="hardest — home">
          <Logo />
        </Link>
        <nav className="hidden items-center md:flex" aria-label="Main">
          <NavLink to="/harvard" className={navCls}>
            Harvard courses
          </NavLink>
          <NavLink to="/about" className={navCls}>
            How it works
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={onSearch}
            className="flex h-8 items-center gap-2 rounded-md border border-border bg-surface px-2.5 text-sm text-faint hover:border-border-strong hover:text-muted sm:w-56"
            aria-label="Search courses (press /)"
          >
            <Search className="size-4" />
            <span className="hidden sm:inline">Search courses</span>
            <Kbd className="ml-auto hidden sm:inline-flex">/</Kbd>
          </button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/upload">
              <Upload /> Add assignment
            </Link>
          </Button>
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}

function FeedbackDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { user, openSignIn } = useAuth()
  const location = useLocation()
  const submit = async () => {
    setBusy(true)
    try {
      await getApi().submitFeedback(text.trim(), location.pathname)
      toast({ tone: 'success', message: 'Thanks — feedback received.' })
      setText('')
      onOpenChange(false)
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Send feedback" description="Bugs, missing courses, ideas. Messages go to the maintainers, not to other students.">
        <Label htmlFor="fb">Message</Label>
        <Textarea id="fb" rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {user ? (
            <Button variant="primary" disabled={busy || text.trim().length < 3} onClick={submit}>
              {busy ? 'Sending…' : 'Send'}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => openSignIn('Sign in to send feedback (it keeps out spam).')}>
              Sign in to send
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Footer({ onFeedback }: { onFeedback: () => void }) {
  return (
    <footer className="mt-16 border-t border-border">
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:px-6">
        <Logo className="text-sm text-text" />
        <span className="text-faint">Crowdsourced difficulty ratings. Not affiliated with Harvard University.</span>
        <nav className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto" aria-label="Footer">
          <Link to="/about" className="hover:text-text">
            Methodology
          </Link>
          <Link to="/about#privacy" className="hover:text-text">
            Privacy
          </Link>
          <Link to="/about#content" className="hover:text-text">
            Content policy
          </Link>
          <button onClick={onFeedback} className="inline-flex items-center gap-1 hover:text-text">
            <MessageSquare className="size-3.5" /> Feedback
          </button>
        </nav>
      </div>
    </footer>
  )
}

export function AppShell() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey)) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => setSearchOpen(false), [location.pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      <DemoBanner />
      <Header onSearch={() => setSearchOpen(true)} />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer onFeedback={() => setFeedbackOpen(true)} />
      <SignInDialog />
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent title="Search" hideTitle className="top-[12vh] max-w-xl translate-y-0 p-3">
          <CourseSearch autoFocus onDone={() => setSearchOpen(false)} />
          <p className="mt-2 px-1 text-[11px] text-faint">
            Try “math 55a”, “stat110 fall 2026”, or a phrase from a problem statement. <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move, <Kbd>↵</Kbd> to open.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
