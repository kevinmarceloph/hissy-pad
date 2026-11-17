import { expect, test } from '@playwright/test'

const SHOTS = process.env.TOOLBAR_SHOTS // a directory: save a screenshot of the open menu

// The toolbar scrolls sideways on a narrow screen, and a scrolling box clips anything
// positioned inside it. The Move to… menu once opened inside the bar and was cut off, so
// this checks what jsdom cannot: that each item is really the thing under its own centre.
test('the Move to… menu opens above the toolbar, fully on screen, and moves the line', async ({ page }, info) => {
  await page.goto('/')
  for (const name of ['Work', 'Ideas', 'A pad with a much longer name than the others']) {
    await page.getByRole('button', { name: 'New pad' }).click()
    await page.getByLabel('Pad name').fill(name)
    await page.getByRole('button', { name: 'Create' }).click()
  }
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Main' }).click()
  await page.getByRole('button', { name: 'Select line' }).first().click()
  const button = page.getByRole('button', { name: 'Move to…' })
  await button.scrollIntoViewIfNeeded()
  await button.click()

  const items = page.getByRole('menuitem')
  await expect(items).toHaveCount(3)
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
  await page.goto('/')
  await page.getByRole('button', { name: 'New pad' }).click()
  await page.getByLabel('Pad name').fill('Work')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('tab', { name: 'Main' }).click()
  await page.getByRole('button', { name: 'Select line' }).first().click()
  const button = page.getByRole('button', { name: 'Move to…' })
  await button.scrollIntoViewIfNeeded()
  await button.click()
  await expect(page.getByRole('menuitem')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem')).toHaveCount(0)
  await button.click()
  await expect(page.getByRole('menuitem')).toHaveCount(1)
  await page.locator('h1').click()
  await expect(page.getByRole('menuitem')).toHaveCount(0)
})
