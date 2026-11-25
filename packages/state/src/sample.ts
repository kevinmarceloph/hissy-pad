// What a first visit sees instead of one blank line: a small pad that shows the shape
// (a heading with children, a numbered list, a crossed-out line, a spacer) and teaches
// the handful of moves, in the app's own voice. It also serves as the Paste-in example.
import { insertOutline, parseOutline, setDone, settleFixedPads, type OpCtx, type Rows } from '@hissypad/core'

export const SAMPLE_OUTLINE = `Welcome to HissyPad
	This is one page. Put whatever matters next at the top.
	Enter starts a new line. Tab nests it under the line above, Shift+Tab brings it back out.
	Cross a line out from the toolbar, or with Cmd+Enter. Like this one.
	Drag a bullet to move a line. Drop it further right to nest it.
	Tap a bullet to select the line, then tap more bullets. The toolbar does the rest.
Today
	1. One small thing you can finish before lunch
	2. The thing you keep postponing
	3. Call someone back
Groceries
	Oat milk
	Eggs
	Kitchen towels

Ideas
	A tiny project for a rainy Sunday
When you are ready, select the top line and press Delete, or paste your own list in.`

export const SAMPLE_DONE_LINE = 'Cross a line out from the toolbar, or with Cmd+Enter. Like this one.'

// The sample goes in the Inbox (the root). Today and Later are made here too and are part of
// the seed, so a device that then signs in to an account drops them with the untouched lines
// instead of keeping a second Today and Later beside the account's.
export function seedSample(rows: Rows, ctx: OpCtx): { rows: Rows; ids: string[] } {
  const settled = settleFixedPads(rows, ctx)
  const pads = Object.keys(settled).filter((id) => !(id in rows))
  const res = insertOutline(settled, ctx, parseOutline(SAMPLE_OUTLINE), { parentId: null, afterId: null })
  const done = res.ids.find((id) => res.rows[id]!.text === SAMPLE_DONE_LINE)
  if (!done) return { rows: res.rows, ids: [...pads, ...res.ids] }
  // Crossed out, but not by anyone: no doneAt, so no hour lists it as done while it ran.
  const crossed = setDone(res.rows, ctx, [done], true)
  return { rows: { ...crossed, [done]: { ...crossed[done]!, doneAt: null } }, ids: [...pads, ...res.ids] }
}
