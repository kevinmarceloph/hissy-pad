import { describe, expect, it } from 'vitest';
import { createMemoryBackend, HoursStore } from '@hissypad/core/hours';

import { createChimeStore } from './chime-store';
import { createDayStore } from './day-store';
import { adoptDeviceSettings, followSettings } from './index';

// 2026-11-24 07:30 in the test's own zone.
const clock = () => new Date(2026, 10, 24, 7, 30);

function setup(store = new HoursStore()) {
  const resumed: number[][] = [];
  const applied: number[][] = [];
  const day = createDayStore(store, clock);
  const chimes = createChimeStore({
    apply: async (m) => {
      applied.push(m);
      return m.length ? 'on' : 'off';
    },
    resume: (m) => {
      resumed.push(m);
      return m.length ? 'on' : 'off';
    },
    save: async () => {},
  });
  return { store, day, chimes, resumed, applied };
}

describe('settings that follow the account', () => {
  it('a pulled day start moves the day; pulled chimes are taken up without a prompt', async () => {
    const s = setup();
    await s.day.getState().open(s.day.getState().day);
    expect(s.day.getState()).toMatchObject({ start: 0, day: '2026-11-24' });

    // What sync leaves behind after another device changed both.
    await s.store.sync.settings.applyRemote([
      { key: 'day.start', value: '8', updatedAt: 1000 },
      { key: 'chime.minutes', value: '55,30', updatedAt: 1000 },
    ]);
    followSettings(s);

    // 07:30 with a day that starts at 8 is the end of yesterday.
    expect(s.day.getState()).toMatchObject({ start: 8, day: '2026-11-23' });
    expect(s.chimes.getState().minutes).toEqual([30, 55]);
    expect(s.resumed).toEqual([[30, 55]]);
    expect(s.applied).toEqual([]);

    // Nothing new: nothing is taken up again.
    followSettings(s);
    expect(s.resumed).toHaveLength(1);
  });

  it('moves settings kept on the device into rows stamped 0, once', async () => {
    const backend = createMemoryBackend();
    await backend.setMeta('day.start', '6');
    await backend.setMeta('chime.minutes', '30');
    const store = new HoursStore(backend);
    await store.open();
    await adoptDeviceSettings(store);

    expect(store.getSetting('day.start')).toBe('6');
    expect(store.getSetting('chime.minutes')).toBe('30');
    expect((await store.sync.settings.dirty()).map((r) => r.updatedAt)).toEqual([0, 0]);
    expect(await backend.getMeta('day.start')).toBeNull();

    // The rows were written through: a fresh store over the same backend reads them back.
    const again = new HoursStore(backend);
    await again.open();
    await adoptDeviceSettings(again);
    expect(again.getSetting('day.start')).toBe('6');
  });

  it('keeps a setting this device already has over one left in meta', async () => {
    const backend = createMemoryBackend();
    const store = new HoursStore(backend);
    await store.putSetting('day.start', '5', 2000);
    await backend.setMeta('day.start', '6');
    await adoptDeviceSettings(store);
    expect(store.getSetting('day.start')).toBe('5');
  });
});
