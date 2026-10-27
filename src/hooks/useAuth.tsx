import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@/lib/api'
import type { AuthUser, Profile, RatingInput } from '@/lib/types'
import { useToast } from '@/components/ui/toast'
import { errorMessage } from '@/lib/errors'

/**
 * A rating chosen while signed out. It's kept in localStorage so it survives the magic-link round trip,
 * and submitted automatically as soon as the user is signed in.
 */
export interface PendingRating extends RatingInput {
  offeringId: string
  label: string
}

const PENDING_KEY = 'hardest:pending-rating'

function readPending(): PendingRating | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')
  } catch {
    return null
  }
}

function writePending(p: PendingRating | null) {
  try {
    if (p) localStorage.setItem(PENDING_KEY, JSON.stringify(p))
    else localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

interface AuthState {
  user: AuthUser | null
  ready: boolean
  profile: Profile | null
  isModerator: boolean
  signInOpen: boolean
  signInReason: string | null
  openSignIn: (reason?: string) => void
  closeSignIn: () => void
  pending: PendingRating | null
  setPending: (p: PendingRating | null) => void
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = getApi()
  const qc = useQueryClient()
  const toast = useToast()
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [signInReason, setSignInReason] = useState<string | null>(null)
  const [pending, setPendingState] = useState<PendingRating | null>(readPending)
  const submitting = useRef(false)

  useEffect(() => {
    let alive = true
    api.auth.getUser().then((u) => {
      if (!alive) return
      setUser(u)
      setReady(true)
    })
    const off = api.auth.onChange((u) => {
      setUser((prev) => (prev?.id === u?.id ? prev : u))
      setReady(true)
    })
    return () => {
      alive = false
      off()
    }
  }, [api])

  // Signing in (by code, magic link in another tab, or demo) finishes whatever asked for it.
  useEffect(() => {
    if (user) setSignInOpen(false)
  }, [user])

  // Any change of identity invalidates per-user data.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: ['me'] })
    qc.invalidateQueries({ queryKey: ['myRatings'] })
  }, [user?.id, qc])

  const profileQ = useQuery({
    queryKey: ['me', 'profile', user?.id],
    queryFn: () => api.getProfile(),
    enabled: Boolean(user),
    staleTime: 60_000,
  })

  const setPending = useCallback((p: PendingRating | null) => {
    writePending(p)
    setPendingState(p)
  }, [])

  // Submit a rating that was chosen before signing in.
  useEffect(() => {
    if (!user || !pending || submitting.current) return
    submitting.current = true
    setSignInOpen(false)
    api
      .rate(pending)
      .then(() => {
        toast({ tone: 'success', message: `Saved your rating of ${pending.difficulty}/10 for ${pending.label}.` })
        qc.invalidateQueries({ queryKey: ['overview', pending.offeringId] })
        qc.invalidateQueries({ queryKey: ['myRatings', pending.offeringId] })
        qc.invalidateQueries({ queryKey: ['problem', pending.problemId] })
      })
      .catch((e) => toast({ tone: 'error', message: `Couldn't save your rating: ${errorMessage(e)}` }))
      .finally(() => {
        setPending(null)
        submitting.current = false
      })
  }, [user, pending, api, qc, toast, setPending])

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      profile: profileQ.data ?? null,
      isModerator: profileQ.data?.role === 'moderator' || profileQ.data?.role === 'admin',
      signInOpen,
      signInReason,
      openSignIn: (reason) => {
        setSignInReason(reason ?? null)
        setSignInOpen(true)
      },
      closeSignIn: () => setSignInOpen(false),
      pending,
      setPending,
      signOut: async () => {
        await api.auth.signOut()
        setUser(null)
        qc.removeQueries({ queryKey: ['me'] })
        qc.removeQueries({ queryKey: ['myRatings'] })
      },
    }),
    [user, ready, profileQ.data, signInOpen, signInReason, pending, setPending, api, qc],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
