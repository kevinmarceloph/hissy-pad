import { expect, test } from '@playwright/test'

const SHOTS = process.env.CATEGORY_SHOTS // a directory: save screenshots of the list and the picker

// Categories are edited from the top menu, and the pad's Category… picker can make one in
// place: the line gets it at once and the pad draws its icon before the text.
test('the top menu edits categories, and the picker makes one in place for the line', async ({ page }, info) => {
  await page.goto('/#pads')
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Categories' }).click()
  const list = page.getByRole('dialog', { name: 'Categories' })
  await expect(list.getByRole('heading', { name: 'Categories' })).toBeVisible()
  await list.getByRole('button', { name: 'Add a category' }).click()
  await list.getByLabel('Name').fill('Reading')
  await list.getByLabel('Icon').fill('📚')
  await list.getByText('Add', { exact: true }).click()
  await expect(list.getByLabel(/^Reading, /)).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/list-${info.project.name}.png` })
  await list.getByText('Close').click()
  await expect(list).toHaveCount(0)

  await page.getByRole('button', { name: 'Select line' }).first().click()
  const give = page.getByRole('button', { name: /categor/i }).first()
  await give.scrollIntoViewIfNeeded()
  await give.click()
  const picker = page.getByRole('dialog', { name: 'Pick a category' })
  await expect(picker.getByRole('radio', { name: 'Reading' })).toBeVisible()
  await picker.getByText('New category').click()
  await picker.getByLabel('Name').fill('Errands')
  await picker.getByLabel('Icon').fill('🛒')
  await picker.getByRole('radio', { name: 'Teal' }).click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-new-${info.project.name}.png` })
  await picker.getByText('Add', { exact: true }).click()
  await expect(picker).toHaveCount(0)
  await expect(page.getByText('Put 1 line in 🛒 Errands.')).toBeVisible()
  await expect(page.locator('main').getByText('🛒').first()).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pad-${info.project.name}.png` })
})
