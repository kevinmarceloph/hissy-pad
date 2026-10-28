import { expect, test, type Page } from '@playwright/test'

// Fresh IndexedDB per test (each Playwright context is a clean profile). Lines are typed
// through the real editor, then dragged by their bullets with real pointer coordinates.
async function typeOutline(page: Page, lines: string[]) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Select line' }).first().click()
  await page.keyboard.press('Enter')
  let depth = 0
  for (const [i, line] of lines.entries()) {
    if (i > 0) await page.keyboard.press('Enter') // a new line keeps the previous depth
    const want = line.match(/^\t*/)![0].length
    for (; depth < want; depth++) await page.keyboard.press('Tab')
    for (; depth > want; depth--) await page.keyboard.press('Shift+Tab')
    await page.keyboard.type(line.replace(/^\t+/, ''))
  }
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
}

async function outline(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.row')]
      .map((r) => '  '.repeat(Number(r.style.getPropertyValue('--depth'))) + (r.querySelector('.text')?.textContent ?? '').replace(/​/g, ''))
      .join('\n'),
  )
}

function bullet(page: Page, text: string) {
  return page.locator('.row', { has: page.locator('.text', { hasText: new RegExp(`^${text}$`) }) }).locator('.bullet')
}

// Press, move in steps past the threshold (and past the touch hold), drop.
async function dragTo(page: Page, from: ReturnType<typeof bullet>, x: number, y: number, touch: boolean) {
  const box = (await from.boundingBox())!
  const sx = box.x + box.width / 2
  const sy = box.y + box.height / 2
  if (touch) {
    const cdp = await page.context().newCDPSession(page)
    const touchPoints = (px: number, py: number) => [{ x: px, y: py }]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPoints(sx, sy) })
    await page.waitForTimeout(400) // past the hold
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPoints(sx + ((x - sx) * i) / 8, sy + ((y - sy) * i) / 8) })
      await page.waitForTimeout(30)
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    return
  }
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(sx + ((x - sx) * i) / 8, sy + ((y - sy) * i) / 8)
  }
  await page.mouse.up()
}

test('drag a row above another', async ({ page }, info) => {
  await typeOutline(page, ['one', 'two', 'three'])
  expect(await outline(page)).toBe('one\ntwo\nthree')
  const oneBox = (await page.locator('.row').first().boundingBox())!
  await dragTo(page, bullet(page, 'three'), oneBox.x + 60, oneBox.y + 2, info.project.name === 'phone')
  expect(await outline(page)).toBe('three\none\ntwo')
})

test('drag to the right nests under the row above', async ({ page }, info) => {
  await typeOutline(page, ['parent', 'child-to-be'])
  const parent = (await page.locator('.row').first().boundingBox())!
  // Drop into the gap below "parent", with the pointer one indent to the right.
  await dragTo(page, bullet(page, 'child-to-be'), parent.x + 140, parent.y + parent.height + 2, info.project.name === 'phone')
  expect(await outline(page)).toBe('parent\n  child-to-be')
  const indicatorGone = await page.locator('.drop-line').count()
  expect(indicatorGone).toBe(0)
})

test('a selection drags as a block with its subtree', async ({ page }, info) => {
  test.skip(info.project.name === 'phone', 'multi-select drag is checked on desktop')
  await typeOutline(page, ['a', 'b', '\tb1', 'c', 'd'])
  expect(await outline(page)).toBe('a\nb\n  b1\nc\nd')
  await bullet(page, 'b').click()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown') // b, b1, c selected
  const dBox = (await page.locator('.row').last().boundingBox())!
  await dragTo(page, bullet(page, 'b'), dBox.x + 20, dBox.y + dBox.height + 4, false)
  expect(await outline(page)).toBe('a\nd\nb\n  b1\nc')
})

test('Escape cancels a drag', async ({ page }) => {
  await typeOutline(page, ['x', 'y'])
  const yb = bullet(page, 'y')
  const box = (await yb.boundingBox())!
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + 5, box.y - 40, { steps: 5 })
  await expect(page.locator('.drag-ghost')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect(await outline(page)).toBe('x\ny')
})
