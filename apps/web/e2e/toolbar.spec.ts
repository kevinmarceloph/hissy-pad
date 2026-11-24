import { expect, test } from '@playwright/test'

const SHOTS = process.env.TOOLBAR_SHOTS // a directory: save a screenshot of the open menu

// The toolbar scrolls sideways on a narrow screen, and a scrolling box clips anything
// positioned inside it. The Move to… menu once opened inside the bar and was cut off, so
// this checks what jsdom cannot: that each item is really the thing under its own centre.
test('the Move to… menu opens above the toolbar, fully on screen, and moves the line', async ({ page }, info) => {
  await page.goto('/#pads')
  for (const name of ['Work', 'Ideas', 'A pad with a much longer name than the others']) {
    await page.getByRole('button', { name: 'New pad' }).click()
    await page.getByLabel('Pad name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
  }
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: /^Inbox/ }).click()
  await page.getByRole('button', { name: 'Select line' }).first().click()
  const button = page.getByRole('button', { name: 'Move to…' })
  await button.scrollIntoViewIfNeeded()
  await button.click()

  // Every pad but the open one: the fixed Today and Later, and the three made above.
  const items = page.getByRole('menuitem')
  await expect(items).toHaveText(['Today', 'Later', 'Work', 'Ideas', 'A pad with a much longer name than the others'])
  const view = page.viewportSize()!
  const anchor = (await button.boundingBox())!
  for (const item of await items.all()) {
    const box = (await item.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(anchor.y) // above the button
    const onTop = await item.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit === el || el.contains(hit)
    })
    expect(onTop).toBe(true)
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/moveto-${info.project.name}.png` })

  await page.getByRole('menuitem', { name: 'Work' }).click()
  await expect(items).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('to “Work”')
  await page.getByRole('tab', { name: 'Work' }).click()
  await expect(page.locator('.row .text').first()).toHaveText('Welcome to HissyPad')
})

test('the Move to… menu closes on Escape and on a click elsewhere', async ({ page }) => {
  await page.goto('/#pads')
  await page.getByRole('button', { name: 'New pad' }).click()
  await page.getByLabel('Pad name').fill('Work')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: /^Inbox/ }).click()
  await page.getByRole('button', { name: 'Select line' }).first().click()
  const button = page.getByRole('button', { name: 'Move to…' })
  await button.scrollIntoViewIfNeeded()
  await button.click()
  await expect(page.getByRole('menuitem')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem')).toHaveCount(0)
  await button.click()
  await expect(page.getByRole('menuitem')).toHaveCount(3)
  await page.locator('h1').click()
  await expect(page.getByRole('menuitem')).toHaveCount(0)
})

// At phone width the bar is the phone app's: two rows that do not scroll, with the Done
// switch and "done editing" floating above it, and a + over the pad when nothing is open.
test('at phone width the toolbar does not scroll, and the floating buttons are there', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone width only')
  await page.goto('/#pads')
  const add = page.getByRole('button', { name: 'Add a line at the top' })
  await expect(add).toBeVisible()
  await page.getByRole('button', { name: 'Select line' }).first().click()
  await expect(add).toHaveCount(0)
  const bar = page.getByRole('toolbar', { name: 'Selected lines' })
  const view = page.viewportSize()!
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
  for (const name of ['Outdent', 'Move to top', 'Add a line below', 'Fold', 'Copy', 'Cut', 'Paste above', 'Paste below', 'More actions', 'Archive']) {
    const box = (await bar.getByRole('button', { name, exact: true }).boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    expect(box.width).toBeGreaterThanOrEqual(30)
  }
  // Done and × are the floating pair here, not buttons on the bar.
  await expect(bar.getByRole('button', { name: 'Done', exact: true })).toBeHidden()
  await page.getByRole('switch', { name: 'Crossed out' }).click()
  await expect(page.locator('.row.is-done')).toHaveCount(2)
  await page.getByRole('switch', { name: 'Crossed out' }).click()
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click()
  await expect(bar).toHaveCount(0)
  await expect(add).toBeVisible()
})

test('the floating + adds a line at the top on a tap, and where it is dropped on a drag', async ({ page }, info) => {
  test.skip(info.project.name !== 'phone', 'phone width only')
  await page.goto('/#pads')
  const add = page.getByRole('button', { name: 'Add a line at the top' })
  const before = await page.locator('.row').count()
  const from = (await add.boundingBox())!
  const row = (await page.locator('.row', { hasText: 'Oat milk' }).boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(row.x + 80, row.y + row.height + 2, { steps: 8 })
  await expect(page.locator('.new-row')).toHaveCount(1)
  await page.mouse.up()
  await expect(page.locator('.row')).toHaveCount(before + 1)
  await page.keyboard.type('Bread')
  const texts = await page.locator('.row').evaluateAll((els) => els.map((el) => (el.querySelector('textarea')?.value ?? el.querySelector('.text')?.textContent ?? '').trim()))
  expect(texts.indexOf('Bread')).toBe(texts.indexOf('Oat milk') + 1)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await add.click()
  await expect(page.locator('.row')).toHaveCount(before + 2)
  await expect(page.locator('.row').first().locator('textarea')).toBeFocused()
})
