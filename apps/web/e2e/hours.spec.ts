import { expect, test } from '@playwright/test'

// An open hour is drawn by the pad itself (the store shows that hour: openSlot), so this
// checks in a real browser what the shared screens' tests cannot: that the pad's rows,
// keys and toolbar work inside the React Native screens of Hours.
test('an open hour edits its lines with the pad\'s own rows, keys and toolbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Hours', exact: true }).click()

  // Hours opens on the hour in progress. An item typed there goes to Today, in the hour.
  const add = page.getByLabel('Add a line to this hour')
  await add.fill('Write the proposal')
  await add.press('Enter')
  const rows = page.locator('.hour-lines .row')
  await expect(rows).toHaveCount(1)
  // The line's chip for this very hour is left out of the hour's own list.
  await expect(rows.first().locator('.slot')).toBeHidden()

  // The pad's keys: Return opens the next line right under this one, Tab puts it inside.
  await rows.first().locator('.text').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('draft the intro')
  await expect(rows).toHaveCount(2)
  await page.keyboard.press('Tab')
  await expect(rows.nth(1)).toHaveCSS('--depth', '1')

  // Escape selects the line, and the pad's toolbar is there for it.
  await page.keyboard.press('Escape')
  await expect(rows.nth(1)).toHaveClass(/is-selected/)
  await expect(page.getByRole('button', { name: 'Put in an hour', exact: true })).toBeVisible()
  await page.getByRole('radiogroup', { name: 'Line state' }).getByRole('radio', { name: 'Done', exact: true }).click()
  await expect(rows.nth(1)).toHaveClass(/is-done/)
  // The pad's undo, from the keyboard.
  await page.keyboard.press('ControlOrMeta+z')
  await expect(rows.nth(1)).not.toHaveClass(/is-done/)

  // The hour's row counts its own line only, and the lines live in Today.
  await expect(page.getByText('0/1')).toBeVisible()
  await page.getByRole('button', { name: 'Pad', exact: true }).click()
  await page.getByRole('tab', { name: /^Today/ }).click()
  await expect(page.locator('.pad .row')).toHaveCount(2)
  await expect(page.locator('.pad .row').first()).toContainText('Write the proposal')
  await expect(page.locator('.pad .row').nth(1)).toContainText('draft the intro')
})

// The toolbar is the pad's, with what an hour needs and without what it cannot do.
test('in an open hour the toolbar offers Out of this hour, not Make pad, and no reorder for the hour\'s own lines', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Hours', exact: true }).click()
  const add = page.getByLabel('Add a line to this hour')
  for (const text of ['Call the bank', 'Send invoice']) {
    await add.fill(text)
    await add.press('Enter')
  }
  const rows = page.locator('.hour-lines .row')
  await expect(rows).toHaveCount(2)

  await rows.first().getByRole('button', { name: 'Select line' }).click()
  // An hour keeps no order for its lines: the arrows that would change it are off.
  for (const name of ['Move up', 'Move down', 'Move to top']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()

  const more = page.getByRole('button', { name: 'More actions', exact: true })
  await more.scrollIntoViewIfNeeded()
  await more.click()
  await expect(page.getByRole('menuitem', { name: 'Make pad' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Out of this hour' }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.getByText('Took 1 line out of the hour.')).toBeVisible()

  // Archiving the hour's last line leaves the hour empty: no blank line is made for it.
  await rows.first().getByRole('button', { name: 'Select line' }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(rows).toHaveCount(0)
  // It is listed under Archived, drawn like a line, and comes back from there.
  await expect(page.getByRole('heading', { name: 'Archived' })).toBeVisible()
  await page.getByRole('button', { name: /^Unarchive/ }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Archived' })).toHaveCount(0)
})
