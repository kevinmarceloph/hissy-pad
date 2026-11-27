import { expect, test } from '@playwright/test'

// An open hour is drawn by the pad itself (the store shows that hour: openSlot), so this
// checks in a real browser what the shared screens' tests cannot: that the pad's rows,
// keys and toolbar work inside the React Native screens of Hours.
test('an open hour edits its lines with the pad\'s own rows, keys and toolbar', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Hours', exact: true }).click()

  // Hours opens on the hour in progress. The empty space under its lines takes a tap for a
  // new line, which goes to Today, in the hour. There is no field for it.
  await expect(page.locator('.hours input, .hours textarea')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add a line to this hour' }).click()
  await page.keyboard.type('Write the proposal')
  const rows = page.locator('.hour-lines .row')
  await expect(rows).toHaveCount(1)
  // The hour's row says its first line.
  await expect(page.getByRole('button', { name: /, now: Write the proposal$/ })).toBeVisible()
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

  // The hour's row shows no done-out-of-all count, and nothing crossed out (undone above).
  // The lines live in Today.
  await expect(page.getByText(/^\d+\/\d+$/)).toHaveCount(0)
  await expect(page.getByText(/^✕\d+$/)).toHaveCount(0)
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
  await page.getByRole('button', { name: 'Add a line to this hour' }).click()
  await page.keyboard.type('Call the bank')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Send invoice')
  await page.keyboard.press('Escape')
  const rows = page.locator('.hour-lines .row')
  await expect(rows).toHaveCount(2)
  // The first line, and its lines done out of all.
  await expect(page.getByRole('button', { name: /, now: Call the bank, 0 of 2 done$/ })).toBeVisible()
  await rows.nth(1).getByRole('button', { name: 'Deselect line' }).click()

  await rows.first().getByRole('button', { name: 'Select line' }).click()
  // The hour's lines reorder: both are Today's, so the first can go down and not up.
  await expect(page.getByRole('button', { name: 'Move up', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Move down', exact: true }).click()
  await expect(rows.first()).toContainText('Send invoice')
  await expect(rows.nth(1)).toContainText('Call the bank')
  await expect(page.getByRole('button', { name: /, now: Send invoice, 0 of 2 done$/ })).toBeVisible()
  await page.getByRole('button', { name: 'Move up', exact: true }).click()
  await expect(rows.first()).toContainText('Call the bank')

  const more = page.getByRole('button', { name: 'More actions', exact: true })
  await more.scrollIntoViewIfNeeded()
  await more.click()
  await expect(page.getByRole('menuitem', { name: 'Make pad' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Out of this hour' }).click()
  await expect(rows).toHaveCount(1)
  await expect(page.getByText('Took 1 line out of the hour.')).toBeVisible()

  // An archived line stays among the hour's lines, with a mark at its right that brings it
  // back. No blank line is made for the hour.
  await rows.first().getByRole('button', { name: 'Select line' }).click()
  await page.getByRole('button', { name: 'Archive', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toHaveClass(/is-archived/)
  await rows.first().getByRole('button', { name: 'Archived. Press to unarchive.' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).not.toHaveClass(/is-archived/)

  // Fresh start takes the lines that are not done out of the hour.
  await page.getByRole('button', { name: /^Fresh start/ }).click()
  await expect(rows).toHaveCount(0)
  await expect(page.getByText('Nothing in this hour. Tap here to add a line.')).toBeVisible()

  // The search button opens Search for this hour: the line picked is put in it, and the
  // view stays in Hours. A hit says how many lines are under it.
  await page.getByRole('button', { name: 'Find a line in a pad for this hour' }).click()
  const search = page.getByRole('dialog', { name: /^Find a line for Today/ })
  await search.getByRole('combobox').fill('bank')
  await expect(search.getByRole('option')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expect(search).toBeHidden()
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Call the bank')
})

// The hour picker in a real browser: hours that are apart with a tap on each, and on a
// touch screen a swipe that goes down from one row of hours to the next.
test('the hour picker takes hours that are apart, and a swipe across its rows', async ({ page, hasTouch }) => {
  await page.goto('/#pads')
  const row = page.locator('.pad .row').filter({ hasText: 'Kitchen towels' })
  await row.locator('.text').click()
  await page.keyboard.press('Escape')
  const open = page.getByRole('button', { name: 'Put in an hour', exact: true })
  await open.click()
  const picker = page.getByRole('dialog', { name: 'Pick an hour' })
  const hour = (name: string) => picker.getByRole('checkbox', { name: new RegExp(`^${name}(, now)?$`) })
  await hour('9am').click()
  await hour('2pm').click()
  await hour('3pm').click()
  await hour('3pm').click()
  await picker.getByRole('button', { name: /^Put in Today 9am, 2pm$/ }).click()
  await expect(row.locator('.slot')).toHaveText('Today 9am, 2pm')

  test.skip(!hasTouch, 'the swipe below is a finger\'s')
  await open.click()
  // 10am is in the second row of six and 1pm in the third.
  const from = (await hour('10am').boundingBox())!
  const to = (await hour('1pm').boundingBox())!
  expect(to.y).toBeGreaterThan(from.y)
  const cdp = await page.context().newCDPSession(page)
  const at = (k: number) => ({ x: from.x + from.width / 2 + (to.x - from.x) * k, y: from.y + from.height / 2 + (to.y - from.y) * k })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] })
  for (const k of [0.25, 0.5, 0.75, 1]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(k)] })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await picker.getByRole('button', { name: /^Put in Today 10am-2pm$/ }).click()
  await expect(row.locator('.slot')).toHaveText('Today 10am-2pm')
})
