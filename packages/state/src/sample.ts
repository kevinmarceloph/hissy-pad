// What a first visit sees instead of one blank line: a small pad that shows the shape
// (a heading with children, a numbered list, a crossed-out line, a spacer) and teaches
// the handful of moves, in the app's own voice. It also serves as the Paste-in example.
import { insertOutline, parseOutline, setDone, type OpCtx, type Rows } from '@hissypad/core'

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

export function seedSample(rows: Rows, ctx: OpCtx): { rows: Rows; ids: string[] } {
  const res = insertOutline(rows, ctx, parseOutline(SAMPLE_OUTLINE), { parentId: null, afterId: null })
  const done = res.ids.find((id) => res.rows[id]!.text === SAMPLE_DONE_LINE)
  return { rows: done ? setDone(res.rows, ctx, [done], true) : res.rows, ids: res.ids }
}
