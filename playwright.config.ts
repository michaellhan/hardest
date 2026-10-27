import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against a production build in DEMO MODE: no Supabase, all data is the synthetic
 * in-browser dataset (src/lib/api/demo.ts). They exercise the real UI flows but NOT a real backend;
 * database behavior is covered by tests/db against Postgres.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173/hardest/', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } }, grepInvert: /@mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: {
    command: 'npx vite build --logLevel warn && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/hardest/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' },
  },
})
