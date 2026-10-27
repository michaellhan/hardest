import { ApiError } from './api/types'

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message
  return 'Something went wrong. Please try again.'
}

export function isAuthError(err: unknown) {
  return err instanceof ApiError && (err.hint === 'auth_required' || err.code === '28000' || err.code === '42501' && /sign in/i.test(err.message))
}
