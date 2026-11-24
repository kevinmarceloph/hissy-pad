import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import { DEFAULT_OPTIONS } from '@hissypad/core/hours';

import {
  categoryFromWire,
  categoryToWire,
  entryFromWire,
  entryToWire,
  flagFromWire,
  flagToWire,
  recurringFromWire,
  recurringToWire,
} from './remote';

describe('wire rows', () => {
  it('maps an entry to the table and back', () => {
    const entry = { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', planned: null, plannedNote: '', flags: [], state: 'open', updatedAt: 1795000000000 };
    expect(entryToWire(entry)).toEqual({
      day: '2026-11-19',
      hour: 9,
      note: 'proposals',
      category: 'deep',
      planned: null,
      planned_note: '',
      flags: [],
      state: 'open',
      updated_at: 1795000000000,
    });
    expect(entryFromWire({ ...entryToWire(entry), synced_at: '2026-11-19T13:00:00.123456+00:00' })).toEqual({
      row: entry,
      syncedAt: '2026-11-19T13:00:00.123Z',
    });
  });

  it('maps a category, reading a bigint sent as text and a color it does not know', () => {
    const category = { id: 'deep', label: 'Deep work', icon: '\u{1F4BB}', color: 'blue' as const, position: 0, archived: false, updatedAt: 5 };
    expect(categoryFromWire({ ...categoryToWire(category), synced_at: '2026-11-19T13:00:00Z' }).row).toEqual(category);
    const odd = { ...categoryToWire(category), color: 'neon', updated_at: '7' as unknown as number };
    expect(categoryFromWire(odd).row).toMatchObject({ color: 'stone', updatedAt: 7 });
    // A server from before categories had an icon sends none.
    const { icon: _icon, ...old } = categoryToWire(category);
    expect(categoryFromWire(old).row.icon).toBe('');
  });

  it('carries the plan and the flags, and reads a row from before they existed', () => {
    const entry = { day: '2026-11-20', hour: 9, note: 'scrolled', category: 'drift', planned: 'deep', plannedNote: 'proposals', flags: ['distracted', 'halts'], state: 'open', updatedAt: 5 };
    expect(entryToWire(entry)).toMatchObject({ planned: 'deep', planned_note: 'proposals', flags: ['distracted', 'halts'] });
    expect(entryFromWire(entryToWire(entry)).row).toEqual(entry);

    const old = { day: '2026-11-19', hour: 9, note: 'proposals', category: 'deep', updated_at: 5 };
    // And from before hours had a state: an hour that was logged counts as done.
    expect(entryFromWire(old).row).toMatchObject({ planned: null, plannedNote: '', flags: [], state: 'done' });
    expect(entryFromWire({ ...old, note: '', category: null }).row.state).toBe('open');
    expect(entryFromWire({ ...old, state: 'doing' }).row.state).toBe('doing');
  });

  it('maps a flag to the table and back', () => {
    const options = [
      { id: 'yes', label: 'Hungry', color: 'ochre' as const },
      { id: 'o1a2b3', label: 'Tired', color: 'night' as const, archived: true },
    ];
    const flag = { id: 'halts', label: 'HALTS', icon: '🛑', position: 2, archived: false, options, updatedAt: 5 };
    expect(flagToWire(flag)).toEqual({ id: 'halts', label: 'HALTS', icon: '🛑', position: 2, archived: false, options, updated_at: 5 });
    // A row from before icons or options existed reads as no icon, and Yes and No.
    const { icon: _icon, options: _options, ...old } = flagToWire(flag);
    expect(flagFromWire(old).row.icon).toBe('');
    expect(flagFromWire(old).row.options).toEqual(DEFAULT_OPTIONS);
    expect(flagFromWire({ ...flagToWire(flag), updated_at: '7' as unknown as number }).row).toEqual({ ...flag, updatedAt: 7 });
  });

  it('maps a recurring plan to the table and back', () => {
    const plan = { id: 'rsleep0001', note: 'sleep', category: 'sleep', from: 2, to: 10, days: [0, 6], since: '2026-11-21', position: 0, archived: false, updatedAt: 5 };
    expect(recurringToWire(plan)).toEqual({
      id: 'rsleep0001',
      note: 'sleep',
      category: 'sleep',
      from_hour: 2,
      to_hour: 10,
      days: [0, 6],
      since: '2026-11-21',
      position: 0,
      archived: false,
      updated_at: 5,
    });
    expect(recurringFromWire({ ...recurringToWire(plan), synced_at: '2026-11-21T02:00:00Z' })).toEqual({
      row: plan,
      syncedAt: '2026-11-21T02:00:00.000Z',
    });
    // Days that are not weekdays are dropped, and a bigint sent as text is read.
    const odd = { ...recurringToWire(plan), days: [6, 9, 0, 6], updated_at: '7' as unknown as number };
    expect(recurringFromWire(odd).row).toMatchObject({ days: [0, 6], updatedAt: 7 });
  });
});
