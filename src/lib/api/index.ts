import { config } from '../env'
import { createDemoApi } from './demo'
import { createSupabaseApi } from './supabase'
import type { Api } from './types'

export * from './types'

let instance: Api | null = null

/** The single data source for the app: Supabase when configured, otherwise the local demo sandbox. */
export function getApi(): Api {
  instance ??= config.demo ? createDemoApi() : createSupabaseApi()
  return instance
}
