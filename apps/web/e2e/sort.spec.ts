import { expect, test, type Page } from '@playwright/test'

const SHOTS = process.env.SORT_SHOTS // a directory: save screenshots of the walk-through

async function typeOutline(page: Page, lines: string[]) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Select line' }).first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  await page.keyboard.press('Enter')
  let depth = 0
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter')
    const want = line.match(/^\t*/)![0].length
    for (; depth < want; depth++) await page.keyboard.press('Tab')
    for (; depth > want; depth--) await page.keyboard.press('Shift+Tab')
    await page.keyboard.type(line.replace(/^\t+/, ''))
  }
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

// Swipe the card by (dx, dy) from the middle of its text, with a real mouse or finger.
async function swipe(page: Page, dx: number, dy: number, touch: boolean, hold?: () => Promise<void>) {
  const box = (await page.locator('.sort-card:not(.is-ghost) .sort-text').boundingBox())!
  const sx = box.x + box.width / 2
  const sy = box.y + box.height / 2
  const at = (i: number) => ({ x: sx + (dx * i) / 8, y: sy + (dy * i) / 8 })
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy }] })
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] })
      await page.waitForTimeout(20)
    }
    await hold?.()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return
  }
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(at(i).x, at(i).y)
  await hold?.()
  await page.mouse.up()
}

const tabs = (page: Page) => page.locator('[role=tab] .name').allTextContents()

async function padLines(page: Page, name: string): Promise<string> {
  await page.getByRole('tab', { name }).click()
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.row')]
      .map((r) => '  '.repeat(Number(r.style.getPropertyValue('--depth'))) + (r.classList.contains('is-done') ? '~' : '') + (r.querySelector('.text')?.textContent ?? '').replace(/​/g, ''))
      .join('\n'),
  )
}

test('swipe cards left, right and up; edit one first', async ({ page }, info) => {
  const touch = info.project.name === 'phone'
  const shot = async (name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` }) }
  await typeOutline(page, ['call the dentist', 'plan the trip', '\tbook flights', 'water the plants', 'read chapter 13'])
  await page.getByRole('button', { name: 'Sort…' }).click()
  const text = page.getByRole('textbox', { name: 'Line text' })
  await expect(text).toHaveValue('call the dentist')
  await shot('1-card')

  // A short drag springs back.
  await swipe(page, 40, 0, touch)
  await expect(text).toHaveValue('call the dentist')

  await swipe(page, -160, 10, touch, () => shot('2-leaning-left'))
  await expect(text).toHaveValue('plan the trip')

  // Fix the card up before it goes: a new sub item, typed into the live row.
  const add = page.getByRole('textbox', { name: 'Add a sub item' })
  await add.click()
  await add.fill('renew passport')
  await add.press('Enter')
  await expect(page.getByRole('textbox', { name: 'Sub item', exact: true })).toHaveCount(2)
  await page.keyboard.press('Escape')
  await shot('3-edited')
  await swipe(page, 170, -10, touch)
  await expect(text).toHaveValue('water the plants')

  await swipe(page, 10, -170, touch, () => shot('4-leaning-up'))
  await expect(text).toHaveValue('read chapter 13')
  await page.getByRole('button', { name: /^Skip/ }).click()
  await expect(page.getByText('All sorted.')).toBeVisible()
  await shot('5-all-sorted')
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  expect(await tabs(page)).toEqual(['Main', 'Later', 'Today'])
  expect(await padLines(page, 'Later')).toBe('call the dentist')
  expect(await padLines(page, 'Today')).toBe('plan the trip\n  book flights\n  renew passport\n~water the plants')
  expect(await padLines(page, 'Main')).toBe('read chapter 13')
})
