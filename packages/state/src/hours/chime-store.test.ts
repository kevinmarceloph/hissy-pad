import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest';
import { SAMPLE_CATEGORIES, SAMPLE_FLAGS } from '@hissypad/core/hours';
import type { ChimeOutcome } from '@hissypad/core/hours';

import { createChimeStore } from './chime-store';

function setup(answer: (minutes: number[]) => ChimeOutcome = (m) => (m.length ? 'on' : 'off')) {
  const applied: number[][] = [];
  const saved: number[][] = [];
  const chimes = createChimeStore({
    apply: async (minutes) => {
      applied.push(minutes);
      return answer(minutes);
    },
    resume: (minutes) => (minutes.length ? 'on' : 'off'),
    save: async (minutes) => {
      saved.push(minutes);
    },
  });
  return { chimes, applied, saved };
}

describe('chime store', () => {
  it('adopts the saved minutes without applying or saving', () => {
    const { chimes, applied, saved } = setup();
    chimes.getState().adopt([55, 30]);
    expect(chimes.getState()).toMatchObject({ minutes: [30, 55], outcome: 'on' });
    expect(applied).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('applies a change, then saves it', async () => {
    const { chimes, applied, saved } = setup();
    await chimes.getState().set([55, 30, 30]);
    expect(chimes.getState()).toMatchObject({ minutes: [30, 55], outcome: 'on' });
    expect(applied).toEqual([[30, 55]]);
    expect(saved).toEqual([[30, 55]]);

    await chimes.getState().set([]);
    expect(chimes.getState()).toMatchObject({ minutes: [], outcome: 'off' });
    expect(saved).toEqual([[30, 55], []]);
  });

  it('takes the change back when the device says no', async () => {
    const { chimes, saved } = setup(() => 'denied');
    await chimes.getState().set([30]);
    expect(chimes.getState()).toMatchObject({ minutes: [], outcome: 'denied' });
    expect(saved).toEqual([]);
  });

  it('applies quick changes one after another, and the last one stands', async () => {
    const { chimes, applied, saved } = setup();
    const first = chimes.getState().set([30]);
    const second = chimes.getState().set([30, 55]);
    expect(chimes.getState().minutes).toEqual([30, 55]);
    await Promise.all([first, second]);
    expect(applied).toEqual([[30], [30, 55]]);
    expect(saved.at(-1)).toEqual([30, 55]);
    expect(chimes.getState().minutes).toEqual([30, 55]);
  });
});
