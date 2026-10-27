import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getApi } from '@/lib/api'
import { applyVoteToStats } from '@/lib/stats'
import type { MyRating, OfferingOverview, ProblemDetail, ProblemStats, RatingInput } from '@/lib/types'
import { useAuth } from './useAuth'

const api = () => getApi()

export function useResolvePath(uni?: string, course?: string, offering?: string, assignment?: string, problem?: string) {
  return useQuery({
    queryKey: ['path', uni, course, offering ?? null, assignment ?? null, problem ?? null],
    queryFn: () => api().resolvePath(uni!, course!, offering, assignment, problem),
    enabled: Boolean(uni && course),
    staleTime: 5 * 60_000,
    placeholderData: (prev) => (prev && prev.course?.slug === course ? prev : undefined),
  })
}

export function useOverview(offeringId?: string | null) {
  return useQuery({
    queryKey: ['overview', offeringId],
    queryFn: () => api().getOverview(offeringId!),
    enabled: Boolean(offeringId),
    staleTime: 30_000,
  })
}

export function useProblem(problemId?: string | null) {
  return useQuery({
    queryKey: ['problem', problemId],
    queryFn: () => api().getProblem(problemId!),
    enabled: Boolean(problemId),
    staleTime: 30_000,
  })
}

export function useHistory(problemId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['history', problemId],
    queryFn: () => api().getHistory(problemId!),
    enabled: Boolean(problemId) && enabled,
  })
}

export function useMyRatings(offeringId?: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['myRatings', offeringId, user?.id],
    queryFn: async () => {
      const list = await api().myRatings(offeringId!)
      return Object.fromEntries(list.map((r) => [r.problem_id, r])) as Record<string, MyRating>
    },
    enabled: Boolean(offeringId && user),
    staleTime: 60_000,
  })
}

function patchOverview(o: OfferingOverview | undefined, problemId: string, stats: ProblemStats | null): OfferingOverview | undefined {
  if (!o) return o
  return {
    assignments: o.assignments.map((a) =>
      a.problems.some((p) => p.id === problemId) ? { ...a, problems: a.problems.map((p) => (p.id === problemId ? { ...p, stats } : p)) } : a,
    ),
  }
}

/** Optimistic rating write with rollback; the aggregate updates instantly and is then replaced by the server's. */
export function useRateProblem(offeringId: string | null | undefined) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const myKey = ['myRatings', offeringId, user?.id]

  return useMutation({
    mutationFn: (input: RatingInput & { clear?: boolean }) => (input.clear ? api().clearRating(input.problemId) : api().rate(input)),
    onMutate: async (input) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: myKey }),
        qc.cancelQueries({ queryKey: ['overview', offeringId] }),
        qc.cancelQueries({ queryKey: ['problem', input.problemId] }),
      ])
      const prevMine = qc.getQueryData<Record<string, MyRating>>(myKey)
      const prevOverview = qc.getQueryData<OfferingOverview>(['overview', offeringId])
      const prevProblem = qc.getQueryData<ProblemDetail | null>(['problem', input.problemId])
      const old = prevMine?.[input.problemId]
      const oldValue = old && !old.stale ? old.difficulty : null
      const nextValue = input.clear ? null : input.difficulty

      const nextMine = { ...(prevMine ?? {}) }
      if (input.clear) delete nextMine[input.problemId]
      else
        nextMine[input.problemId] = {
          problem_id: input.problemId,
          difficulty: input.difficulty,
          time_minutes: input.timeMinutes,
          completion_status: input.completion,
          stale: false,
          updated_at: new Date().toISOString(),
        }
      qc.setQueryData(myKey, nextMine)

      const currentStats =
        prevProblem?.stats ?? prevOverview?.assignments.flatMap((a) => a.problems).find((p) => p.id === input.problemId)?.stats ?? null
      if (oldValue !== nextValue) {
        const optimistic = applyVoteToStats(currentStats, oldValue, nextValue)
        qc.setQueryData(['overview', offeringId], (o: OfferingOverview | undefined) => patchOverview(o, input.problemId, optimistic))
        qc.setQueryData(['problem', input.problemId], (p: ProblemDetail | null | undefined) => (p ? { ...p, stats: optimistic } : p))
      }
      return { prevMine, prevOverview, prevProblem }
    },
    onError: (_e, input, ctx) => {
      if (!ctx) return
      qc.setQueryData(myKey, ctx.prevMine)
      qc.setQueryData(['overview', offeringId], ctx.prevOverview)
      qc.setQueryData(['problem', input.problemId], ctx.prevProblem)
    },
    onSuccess: (stats, input) => {
      qc.setQueryData(['overview', offeringId], (o: OfferingOverview | undefined) => patchOverview(o, input.problemId, stats))
      qc.setQueryData(['problem', input.problemId], (p: ProblemDetail | null | undefined) => (p ? { ...p, stats } : p))
      qc.invalidateQueries({ queryKey: ['me', 'rated'] })
    },
  })
}

export function useSavedCourses() {
  const { user } = useAuth()
  return useQuery({ queryKey: ['me', 'saved', user?.id], queryFn: () => api().savedCourses(), enabled: Boolean(user) })
}

export function useToggleSaved() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ courseId, saved }: { courseId: string; saved: boolean }) => api().setSaved(courseId, saved),
    onSettled: () => qc.invalidateQueries({ queryKey: ['me', 'saved'] }),
  })
}
