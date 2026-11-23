import { createStore, type StoreApi } from 'zustand/vanilla';

import { cleanChimes, type ChimeOutcome } from '@hissypad/core/hours';

export type ChimeState = {
  // False where nothing can chime (a test, a screen with no chime module behind it).
  supported: boolean;
  // Minutes past the hour, in order. Empty is off.
  minutes: number[];
  // What the last change came to, or null before anything was asked.
  outcome: ChimeOutcome | null;
  // Takes the saved setting at start: no permission prompt, nothing written.
  adopt(minutes: number[]): void;
  // Changes the setting from a press. May ask the device for permission.
  set(minutes: number[]): Promise<void>;
};

export type ChimeStore = StoreApi<ChimeState>;

type Options = {
  // Schedules (a phone) or starts ringing (a browser). Called inside the press that asked.
  apply(minutes: number[]): Promise<ChimeOutcome>;
  // The same without asking for anything: what a saved setting gets when the app opens.
  resume(minutes: number[]): ChimeOutcome;
  save(minutes: number[]): Promise<void>;
};

// The chime minutes in memory. The screen sees a change at once; if the device says no,
// the change is taken back and nothing is saved.
export function createChimeStore(options: Options): ChimeStore {
  // One change at a time: scheduling is "cancel everything, then add", and two of those
  // interleaved would leave doubles.
  let pending: Promise<unknown> | null = null;

  return createStore<ChimeState>((set, get) => ({
    supported: true,
    minutes: [],
    outcome: null,

    adopt(minutes) {
      const cleaned = cleanChimes(minutes);
      set({ minutes: cleaned, outcome: options.resume(cleaned) });
    },

    async set(minutes) {
      const cleaned = cleanChimes(minutes);
      const before = get().minutes;
      set({ minutes: cleaned });
      // The first call runs inside the press, which is what lets a browser ask for
      // permission and start its sound.
      const job: Promise<ChimeOutcome> = pending
        ? pending.then(() => options.apply(cleaned))
        : options.apply(cleaned);
      const mine = job.catch(() => undefined);
      pending = mine;
      let outcome: ChimeOutcome;
      try {
        outcome = await job;
      } catch {
        outcome = 'denied';
      } finally {
        if (pending === mine) pending = null;
      }
      if (outcome === 'denied') {
        // Only undo if no later change has replaced this one on the screen.
        if (get().minutes === cleaned) set({ minutes: before });
        set({ outcome });
        return;
      }
      set({ outcome });
      await options.save(cleaned).catch(() => undefined);
    },
  }));
}

// For a screen with nothing behind it: the control is left out.
export function createStaticChimeStore(): ChimeStore {
  return createStore<ChimeState>(() => ({
    supported: false,
    minutes: [],
    outcome: null,
    adopt() {},
    async set() {},
  }));
}
