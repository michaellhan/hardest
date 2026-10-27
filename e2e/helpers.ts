import { expect, type Page } from '@playwright/test'

/** Fresh demo sandbox for each test (the demo API persists to localStorage). */
export async function freshDemo(page: Page) {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear()
      sessionStorage.setItem('e2e-init', '1')
    }
  })
}

export async function demoSignIn(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Continue in demo mode' })).toBeVisible()
  await dialog.getByLabel(/Email/).fill('e2e@college.harvard.edu')
  await dialog.getByRole('button', { name: 'Continue in demo mode' }).click()
  await expect(dialog).toBeHidden()
}

export function ratingCountIn(panel: ReturnType<Page['locator']>) {
  return panel.locator('dt', { hasText: /^Ratings$/ }).locator('xpath=following-sibling::dd[1]')
}
