import { expect, test } from '@playwright/test'
import { demoSignIn, freshDemo, ratingCountIn } from './helpers'

test.beforeEach(({ page }) => freshDemo(page))

test('demo mode is clearly labeled', async ({ page }) => {
  await page.goto('./')
  await expect(page.getByText(/demo/i).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: /How hard was that problem/i })).toBeVisible()
})

test('browse → semester → problem → sign in → rate → aggregate updates', async ({ page }) => {
  await page.goto('harvard/math-55a')
  // The course URL redirects to the latest semester.
  await expect(page).toHaveURL(/\/harvard\/math-55a\/fall-2026$/)
  const grid = page.getByRole('grid', { name: 'Problem difficulty heatmap' })
  await expect(grid).toBeVisible()

  // Switch semester and back.
  const semester = page.getByLabel('Semester', { exact: true })
  const slugs = await semester.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))
  const other = slugs.find((s) => s !== 'fall-2026')!
  expect(other).toBeTruthy()
  await semester.selectOption(other)
  await expect(page).toHaveURL(new RegExp(`/math-55a/${other}$`))
  await semester.selectOption('fall-2026')
  await expect(page).toHaveURL(/\/math-55a\/fall-2026$/)

  // Open Problem Set 4, problem 2 from the heatmap.
  await grid.getByRole('gridcell', { name: /^Problem Set 4, problem 2\b/ }).click()
  await expect(page).toHaveURL(/\/pset-4\/p2$/)
  const panel = page.locator('aside').filter({ has: page.getByRole('radiogroup', { name: /Difficulty of/ }) })
  const before = Number(await ratingCountIn(panel).textContent())

  // Rating while signed out asks to sign in and keeps the pick.
  await panel.getByRole('radio', { name: /^9 —/ }).click()
  await expect(page.getByRole('dialog')).toContainText('9/10')
  await demoSignIn(page)

  await expect(ratingCountIn(panel)).toHaveText(String(before + 1))
  await expect(grid.getByRole('gridcell', { name: /^Problem Set 4, problem 2\b.*your rating 9/ })).toBeVisible()

  // Changing the rating doesn't add a second one.
  await panel.getByRole('radio', { name: /^3 —/ }).click()
  await expect(grid.getByRole('gridcell', { name: /^Problem Set 4, problem 2\b.*your rating 3/ })).toBeVisible()
  await expect(ratingCountIn(panel)).toHaveText(String(before + 1))

  // Persists across reload (demo storage).
  await page.reload()
  await expect(page.getByRole('grid').getByRole('gridcell', { name: /^Problem Set 4, problem 2\b.*your rating 3/ })).toBeVisible()
})

test('heatmap URL state and keyboard navigation', async ({ page }) => {
  await page.goto('harvard/math-55a/fall-2026?metric=median&numbers=0')
  await expect(page.getByRole('radio', { name: 'Median', checked: true })).toBeVisible()
  const grid = page.getByRole('grid')
  await grid.getByRole('gridcell').first().focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/pset-\d+\/p[\w-]+\?metric=median&numbers=0$/)
  await expect(page.getByRole('button', { name: 'Close problem details' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/fall-2026\?metric=median&numbers=0$/)
})

test('unknown course shows a helpful empty state', async ({ page }) => {
  await page.goto('harvard/not-a-course')
  await expect(page.getByText(/couldn.t find|not found/i).first()).toBeVisible()
})

test('mobile: problem opens as a sheet @mobile', async ({ page }) => {
  await page.goto('harvard/math-55a/fall-2026')
  await page.getByRole('grid').getByRole('gridcell', { name: /^Problem Set 4, problem 2\b/ }).click()
  await expect(page.getByRole('dialog').getByRole('radiogroup', { name: /Difficulty of/ })).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
