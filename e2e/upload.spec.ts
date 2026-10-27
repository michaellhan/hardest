import { expect, test, type Page } from '@playwright/test'
import { demoSignIn, freshDemo } from './helpers'

test.beforeEach(({ page }) => freshDemo(page))

const TEX = String.raw`\documentclass{article}
\title{Math 55a Problem Set 12: Tensor products}
\begin{document}
\maketitle
\begin{enumerate}
\item Let $V$ and $W$ be finite-dimensional. Show $\dim(V \otimes W) = \dim V \cdot \dim W$.
\item Let $T : V \to V$ be linear.
  \begin{enumerate}
  \item Show that $\Lambda^n T$ is multiplication by $\det T$.
  \item Deduce that $\det(ST) = \det S \det T$.
  \end{enumerate}
\item Prove that $V^{**} \cong V$ naturally.
\end{enumerate}
\end{document}`

async function pasteAndReview(page: Page, title: string) {
  await page.goto('upload')
  await page.getByRole('button', { name: /Math 55a/i }).first().click()
  await page.getByRole('button', { name: 'Fall 2026' }).click()
  await page.getByLabel('Title').fill(title)
  await page.getByRole('button', { name: /^Next/ }).click()
  await page.getByRole('radio', { name: /Paste text/ }).click()
  await page.getByLabel('Format').selectOption('tex')
  await page.getByLabel('Assignment text').fill(TEX)
  await page.getByRole('button', { name: /Find problems/ }).click()
}

test('paste → review → publish → appears on the heatmap', async ({ page }) => {
  await pasteAndReview(page, 'Problem Set 12')
  // Review editor shows parsed problems and parts.
  const labels = page.getByLabel(/^Label/)
  await expect(labels).toHaveCount(5)
  await expect(page.getByText(/Λ|Lambda/).first()).toBeVisible()
  await page.getByRole('button', { name: /^(Continue|Next|Review & publish)/ }).last().click()

  await expect(page.getByText('No duplicates found.')).toBeVisible()
  const publish = page.getByRole('button', { name: /publish$/i })
  await expect(publish).toBeDisabled()
  await page.getByText(/I have the right to share this/).click()
  await publish.click()
  await demoSignIn(page)
  await page.getByRole('button', { name: /^Publish$/ }).click()

  await expect(page).toHaveURL(/\/harvard\/math-55a\/fall-2026\/pset-12$/)
  const grid = page.getByRole('grid')
  await expect(grid.getByRole('gridcell', { name: /^Problem Set 12, problem 1: not rated yet/ })).toBeVisible()
  await expect(grid.getByRole('gridcell', { name: /^Problem Set 12, problem 3: not rated yet/ })).toBeVisible()
})

test('publishing the same assignment twice is caught as a duplicate', async ({ page }) => {
  await pasteAndReview(page, 'Problem Set 12')
  await page.getByRole('button', { name: /^(Continue|Next|Review & publish)/ }).last().click()
  await page.getByText(/I have the right to share this/).click()
  await page.getByRole('button', { name: /publish$/i }).click()
  await demoSignIn(page)
  await page.getByRole('button', { name: /^Publish$/ }).click()
  await expect(page).toHaveURL(/pset-12$/)

  await pasteAndReview(page, 'Problem Set 12')
  await page.getByRole('button', { name: /^(Continue|Next|Review & publish)/ }).last().click()
  await expect(page.getByText('This may already be on the site')).toBeVisible()
  await expect(page.getByText(/Add to “Problem Set 12”/)).toBeVisible()
})

test('manual labels create rateable problems without statements', async ({ page }) => {
  await page.goto('upload')
  await page.getByRole('button', { name: /Math 55a/i }).first().click()
  await page.getByRole('button', { name: 'Fall 2026' }).click()
  await page.getByLabel('Title').fill('Midterm practice')
  await page.getByLabel('Type').selectOption({ label: 'Exam' }).catch(() => {})
  await page.getByRole('button', { name: /^Next/ }).click()
  await page.getByRole('radio', { name: /Problem numbers only/ }).click()
  await page.getByLabel('Problem labels').fill('1-3, 4a, 4b')
  await page.getByRole('button', { name: /^Continue/ }).click()
  await expect(page.getByLabel(/^Label/)).toHaveCount(6)
})
