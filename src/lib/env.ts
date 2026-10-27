const env = import.meta.env

const supabaseUrl = (env.VITE_SUPABASE_URL as string | undefined)?.trim() || null
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || null

function demoRequested() {
  if (typeof window === 'undefined') return false
  try {
    const p = new URLSearchParams(window.location.search)
    if (p.get('demo') === '1') localStorage.setItem('hardest:force-demo', '1')
    if (p.get('demo') === '0') localStorage.removeItem('hardest:force-demo')
    return localStorage.getItem('hardest:force-demo') === '1'
  } catch {
    return false
  }
}

export const config = {
  supabaseUrl,
  supabaseAnonKey,
  /** No backend configured, or the visitor opted into the sandbox with ?demo=1. */
  demo: !supabaseUrl || !supabaseAnonKey || demoRequested(),
  backendConfigured: Boolean(supabaseUrl && supabaseAnonKey),
  siteUrl: ((env.VITE_SITE_URL as string | undefined) || (typeof window !== 'undefined' ? window.location.origin + env.BASE_URL.replace(/\/$/, '') : '')).replace(/\/$/, ''),
  googleAuth: env.VITE_ENABLE_GOOGLE_AUTH === 'true',
  basePath: env.BASE_URL.replace(/\/$/, ''),
}

export function setDemoMode(on: boolean) {
  try {
    if (on) localStorage.setItem('hardest:force-demo', '1')
    else localStorage.removeItem('hardest:force-demo')
  } catch {
    /* storage unavailable */
  }
  window.location.href = `${config.basePath}/`
}
