import { expect, test } from '@playwright/test'

const SHOTS = process.env.BOOMERANG_SHOTS // a directory: save screenshots of each step

// Boomerang, end to end in a real browser: the floating button is on screen with the others
// (five round buttons and the switch on one line of a phone), the picker sends the line out
// until tomorrow, and Later lists it under its own lines and brings it back.
test('a line goes out on a boomerang from the floating button, and Later lists it', async ({ page }, info) => {
  await page.goto('/#pads')
  await page.getByRole('button', { name: 'Select line' }).first().click()

  // Every floating button is inside the window and is the thing under its own centre.
  const view = page.viewportSize()!
  const floating = page.locator('.fab button')
  await expect(floating).toHaveCount(8) // hour, category, boomerang, move, three states, done editing
  for (const button of await floating.all()) {
    const box = (await button.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    const onTop = await button.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit === el || el.contains(hit)
    })
    expect(onTop).toBe(true)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-buttons-${info.project.name}.png` })

  await page.getByRole('button', { name: /^Boomerang/ }).click()
  const tomorrow = page.getByRole('button', { name: /^Tomorrow/ })
  await expect(tomorrow).toBeVisible()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-picker-${info.project.name}.png` })
  await tomorrow.click()
  await expect(page.getByRole('status')).toContainText('1 line is out until tomorrow')
  await expect(page.locator('.row .text').first()).not.toHaveText('Welcome to HissyPad')

  await page.getByRole('tab', { name: /^Later/ }).click()
  const section = page.getByRole('region', { name: 'Out on a boomerang' })
  await expect(section.getByRole('heading', { name: 'Tomorrow' })).toBeVisible()
  await expect(section.locator('.btext')).toContainText('Welcome to HissyPad')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-later-${info.project.name}.png` })

  await section.getByRole('button', { name: /^Bring Welcome to HissyPad back/ }).click()
  await expect(section).toHaveCount(0)
  await page.getByRole('tab', { name: /^Inbox/ }).click()
  await expect(page.locator('.row .text').first()).toHaveText('Welcome to HissyPad')
})

// The same button at the top right of a card: Sort's, where the card moves on, and the new
// item's, where the card stays up with the day on it.
test('Sort\'s card sends its line out on a boomerang and deals the next one', async ({ page }, info) => {
  await page.goto('/#sort')
  const text = page.getByRole('textbox', { name: 'Line text' })
  await expect(text).toHaveValue('Welcome to HissyPad')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-sort-card-${info.project.name}.png` })
  await page.locator('.sort-card').getByRole('button', { name: /^Boomerang/ }).click()
  await page.getByRole('button', { name: /^In 3 days/ }).click()
  await expect(page.getByRole('status')).toContainText('1 line is out until')
  await expect(text).toHaveValue('Today')
  await page.goto('/#pads')
  await page.getByRole('tab', { name: /^Later/ }).click()
  await expect(page.getByRole('region', { name: 'Out on a boomerang' }).locator('.btext')).toContainText('Welcome to HissyPad')
})

test('the new item\'s card sends the item out from the start, and can call it back', async ({ page }, info) => {
  await page.goto('/#pads')
  await page.getByRole('button', { name: 'New item' }).click()
  const card = page.locator('dialog.create')
  await card.locator('.sort-text').fill('renew the passport')
  await card.getByRole('button', { name: /^Boomerang/ }).click()
  await page.getByRole('button', { name: /^Tomorrow/ }).click()
  await expect(card.locator('.sort-top .slot')).toHaveText('Out until Tomorrow')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-create-card-${info.project.name}.png` })
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator('.row .text').first()).not.toHaveText('renew the passport')
  await page.getByRole('tab', { name: /^Later/ }).click()
  const section = page.getByRole('region', { name: 'Out on a boomerang' })
  await expect(section.locator('.btext')).toHaveText('renew the passport')

  // The picker for a line that is out offers Back now.
  await section.getByRole('button', { name: /^Another day for/ }).click()
  await page.getByRole('button', { name: 'Back now' }).last().click()
  await expect(section).toHaveCount(0)
  await page.getByRole('tab', { name: /^Inbox/ }).click()
  await expect(page.locator('.row .text').first()).toHaveText('renew the passport')
})
