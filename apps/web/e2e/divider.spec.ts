import { expect, test } from '@playwright/test'

const SHOTS = process.env.DIVIDER_SHOTS // a directory: save screenshots of each step

// A section divider in a real browser: the type switcher makes one, the lines that were
// under it come out beside it, its words sit in the middle of the rule, and the line right
// under it cannot be indented (button off, Tab does nothing).
test('a line becomes a section divider: centered, nothing under it, no indent below it', async ({ page }, info) => {
  await page.goto('/#pads')
  const row = (text: string) => page.locator('.row', { has: page.locator('.text', { hasText: new RegExp(`^${text}$`) }) })
  const level = (text: string) => row(text).getAttribute('aria-level')

  expect(await level('Oat milk')).toBe('2')
  await row('Groceries').getByRole('button', { name: 'Select line' }).click()
  await page.getByRole('button', { name: 'Divider', exact: true }).click()
  await expect(row('Groceries')).toHaveClass(/is-divider/)
  for (const kid of ['Oat milk', 'Eggs', 'Kitchen towels']) expect(await level(kid)).toBe('1')

  // The words are in the middle of the line's text column, a rule on each side.
  const text = (await row('Groceries').locator('.text').boundingBox())!
  const label = (await row('Groceries').locator('.divider-label').boundingBox())!
  expect(Math.abs(label.x + label.width / 2 - (text.x + text.width / 2))).toBeLessThan(2)
  expect(label.x - text.x).toBeGreaterThan(16)
  // One line tall, like the rows beside it.
  expect(Math.abs((await row('Groceries').boundingBox())!.height - (await row('Eggs').boundingBox())!.height)).toBeLessThan(0.6)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-divider-${info.project.name}.png` })

  // The line right under it: Indent is off, and Tab leaves it where it is.
  await row('Groceries').getByRole('button', { name: 'Deselect line' }).click()
  await row('Oat milk').getByRole('button', { name: 'Select line' }).click()
  await expect(page.getByRole('button', { name: 'Indent', exact: true })).toBeDisabled()
  await page.keyboard.press('Tab')
  expect(await level('Oat milk')).toBe('1')
  // The one after that still goes under the line above it.
  await row('Oat milk').getByRole('button', { name: 'Deselect line' }).click()
  await row('Eggs').getByRole('button', { name: 'Select line' }).click()
  await expect(page.getByRole('button', { name: 'Indent', exact: true })).toBeEnabled()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-below-${info.project.name}.png` })
})
