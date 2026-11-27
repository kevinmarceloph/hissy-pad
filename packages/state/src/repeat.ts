// Recurring items (core/repeat.ts): the commands the hour picker's Repeat section runs. A
// line made recurring gets a template under Later and is its first instance; the rule is
// the template's, so changing it from an instance changes it for every one to come.
import { makeRepeat, parseRepeat, repeatLink, repeatNote, setRepeat, stopRepeat, unlinkRepeat, type RepeatChoice, type RepeatLink, type Rows } from '@hissypad/core'
import { dayOf } from '@hissypad/core/hours'

import { applyAll, usePad } from './store'
import { armDelivery } from './boomerang'
import { cmdOpenHit } from './search'
import { hoursIfOpen } from './hours'

// The day this moment belongs to and the hour a day starts at, by Hours' setting.
function clock(now: Date = new Date()): { today: string; start: number } {
  const start = hoursIfOpen()?.day.getState().start ?? 0
  return { today: dayOf(now, start), start }
}

// How a line stands with recurring: a template, an instance of one, or neither (null).
export function repeatOf(id: string): RepeatLink | null {
  return repeatLink(usePad.getState().all, id)
}

// "Every 2 weeks, next Fri, Dec 11", for the picker and a template's row.
export function repeatWords(templateId: string, now: Date = new Date()): string {
  const { today, start } = clock(now)
  return repeatNote(usePad.getState().all, templateId, today, start)
}

// Make a line recurring. Returns its template's id, '' when it cannot be one (a pad, a template).
export function cmdMakeRepeat(id: string, choice: RepeatChoice, now: Date = new Date()): string {
  const { today, start } = clock(now)
  let templateId = ''
  applyAll((all, ctx) => {
    const made = makeRepeat(all, ctx, id, choice, today, start)
    templateId = made.templateId
    return made.rows
  }, { label: 'cmdMakeRepeat' })
  void armDelivery()
  return templateId
}

// Change the rule, from the template or from any of its instances.
export function cmdSetRepeat(id: string, choice: RepeatChoice, now: Date = new Date()) {
  const link = repeatOf(id)
  if (!link) return
  applyAll((all, ctx) => setRepeat(all, ctx, link.templateId, choice, clock(now).today), { label: 'cmdSetRepeat' })
  void armDelivery()
}

// No more instances: the template is an ordinary line of Later again.
export function cmdStopRepeat(id: string) {
  const link = repeatOf(id)
  if (link) applyAll((all, ctx) => stopRepeat(all, ctx, link.templateId), { label: 'cmdStopRepeat' })
}

// Cut an instance loose from its template: an ordinary line from here on.
export function cmdUnlinkRepeat(ids: readonly string[], now: Date = new Date()) {
  applyAll((all, ctx) => unlinkRepeat(all, ctx, ids, clock(now).today), { label: 'cmdUnlinkRepeat' })
  void armDelivery()
}

// Go to an instance's template in Later, to edit what the next ones are made from.
export function cmdOpenTemplate(id: string): boolean {
  const link = repeatOf(id)
  return link ? cmdOpenHit(link.templateId) : false
}

// What a row says about recurring after its text: a template its rule and when the next one
// comes ("↻ Every week, next Tue, Dec 8"), an instance the mark alone, any other line nothing.
// A string, so a row can select it from the store.
export const REPEAT_MARK = '↻'
export function repeatMark(all: Rows, id: string, now: Date = new Date()): string {
  const r = all[id]
  if (!r || (!r.repeat && !r.origin)) return ''
  if (r.repeat) {
    if (!parseRepeat(r.repeat)) return ''
    const { today, start } = clock(now)
    return `${REPEAT_MARK} ${repeatNote(all, id, today, start)}`
  }
  return repeatLink(all, id) ? REPEAT_MARK : ''
}
