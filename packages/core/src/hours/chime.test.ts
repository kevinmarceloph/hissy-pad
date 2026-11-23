import { describe, expect, it } from 'vitest';
import {
  chimeSlot,
  chimesSpoken,
  chimeTitle,
  cleanChimes,
  createChimer,
  formatChimes,
  nextChime,
  parseChimes,
  toggleChime,
} from './chime';

const at = (hour: number, minute: number, second = 0) => new Date(2026, 10, 20, hour, minute, second);

describe('chime minutes', () => {
  it('keeps whole minutes from 0 to 59, each once, in order', () => {
    expect(cleanChimes([55, 30, 30, 60, -1, 2.5, '7', 0])).toEqual([0, 30, 55]);
    expect(cleanChimes('30,55')).toEqual([]);
  });

  it('round-trips through the text the meta table holds', () => {
    expect(formatChimes([55, 30])).toBe('30,55');
    expect(parseChimes('30,55')).toEqual([30, 55]);
    expect(parseChimes(' 5, x, 99, 05 ')).toEqual([5]);
    expect(parseChimes('')).toEqual([]);
    expect(parseChimes(null)).toEqual([]);
  });

  it('toggles a minute on and off', () => {
    expect(toggleChime([30], 55)).toEqual([30, 55]);
    expect(toggleChime([30, 55], 30)).toEqual([55]);
  });

  it('says the setting in a sentence', () => {
    expect(chimesSpoken([])).toBe('Chimes are off');
    expect(chimesSpoken([0])).toBe('Chimes at :00');
    expect(chimesSpoken([0, 30, 55])).toBe('Chimes at :00, :30 and :55');
  });
});

describe('the next chime', () => {
  it('is the first chosen minute strictly after now', () => {
    expect(nextChime(at(14, 25), [30, 55])).toEqual(at(14, 30));
    expect(nextChime(at(14, 30), [30, 55])).toEqual(at(14, 55));
    expect(nextChime(at(14, 55, 1), [30, 55])).toEqual(at(15, 30));
    expect(nextChime(at(14, 0), [0])).toEqual(at(15, 0));
  });

  it('crosses midnight and is null when chimes are off', () => {
    expect(nextChime(at(23, 58), [30])).toEqual(new Date(2026, 10, 21, 0, 30));
    expect(nextChime(at(14, 25), [])).toBeNull();
  });
});

describe('what a chime asks about', () => {
  it('on the hour: the hour that just ended', () => {
    expect(chimeTitle(0)).toBe('Where did the hour go?');
    expect(chimeSlot(at(15, 0, 4), 0)).toEqual({ day: '2026-11-20', hour: 14 });
    expect(chimeSlot(at(0, 0, 4), 0)).toEqual({ day: '2026-11-19', hour: 23 });
  });

  it('at any other minute: the hour in progress', () => {
    expect(chimeTitle(55)).toBe('Where is this hour going?');
    expect(chimeSlot(at(14, 55, 4), 55)).toEqual({ day: '2026-11-20', hour: 14 });
  });
});

// A clock and a timer the test moves by hand.
function bench(start: Date) {
  let now = start.getTime();
  let timer: { run: () => void; due: number } | null = null;
  const fired: string[] = [];
  const chimer = createChimer({
    now: () => new Date(now),
    setTimer: (run, ms) => (timer = { run, due: now + ms }),
    clearTimer: () => (timer = null),
    fire: (target) => fired.push(`${target.getHours()}:${String(target.getMinutes()).padStart(2, '0')}`),
  });
  // Runs every timer that comes due on the way to `to`, as a foreground page would.
  const runUntil = (to: Date) => {
    while (timer && timer.due <= to.getTime()) {
      const { run, due } = timer;
      timer = null;
      now = due;
      run();
    }
    now = to.getTime();
  };
  // Jumps the clock with no timers in between (a sleeping laptop), then runs the late one.
  const sleepUntil = (to: Date) => {
    now = to.getTime();
    const late = timer;
    timer = null;
    late?.run();
  };
  return { chimer, fired, runUntil, sleepUntil, armed: () => timer !== null };
}

describe('the chimer', () => {
  it('rings at each chosen minute, hour after hour', () => {
    const { chimer, fired, runUntil } = bench(at(14, 25));
    chimer.set([30, 55]);
    runUntil(at(16, 0));
    expect(fired).toEqual(['14:30', '14:55', '15:30', '15:55']);
  });

  it('follows a change and stops when the list is empty', () => {
    const { chimer, fired, runUntil, armed } = bench(at(14, 25));
    chimer.set([30]);
    chimer.set([45]);
    runUntil(at(14, 50));
    expect(fired).toEqual(['14:45']);
    chimer.set([]);
    expect(armed()).toBe(false);
    runUntil(at(16, 0));
    expect(fired).toEqual(['14:45']);
  });

  it('rings a little late, but not for a chime it slept through', () => {
    const late = bench(at(14, 29, 50));
    late.chimer.set([30]);
    late.sleepUntil(at(14, 31));
    expect(late.fired).toEqual(['14:30']);

    const asleep = bench(at(14, 29, 50));
    asleep.chimer.set([30]);
    asleep.sleepUntil(at(14, 40));
    expect(asleep.fired).toEqual([]);
    // It is armed again for the next one.
    asleep.runUntil(at(15, 31));
    expect(asleep.fired).toEqual(['15:30']);
  });
});
