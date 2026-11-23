import { createContext, useContext, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { CategoriesStore, CategoryState } from '@hissypad/state/hours';
import { createStaticChimeStore, type ChimeState, type ChimeStore } from '@hissypad/state/hours';
import type { DayState, DayStore } from '@hissypad/state/hours';
import type { FlagState, FlagsStore } from '@hissypad/state/hours';
import { createStaticRecurringStore, type RecurringPlansStore, type RecurringState } from '@hissypad/state/hours';
import { hoursSyncLine, type HoursSyncStatus, type HoursSyncStore } from '@hissypad/state/hours';
import { refresh, usePad } from '@hissypad/state';
import { createStore } from 'zustand/vanilla';

type Stores = {
  day: DayStore;
  categories: CategoriesStore;
  flags: FlagsStore;
  recurring: RecurringPlansStore;
  sync: HoursSyncStore;
  chimes: ChimeStore;
};

const StoresContext = createContext<Stores | null>(null);

type Props = {
  day: DayStore;
  categories: CategoriesStore;
  flags: FlagsStore;
  recurring?: RecurringPlansStore;
  sync?: HoursSyncStore;
  chimes?: ChimeStore;
  children: ReactNode;
};

// `sync`, `chimes` and `recurring` are optional: without them the screens see a build with
// no sync server, nothing that can chime and no recurring plans.
export function StoresProvider({ day, categories, flags, recurring, sync, chimes, children }: Props) {
  const [localOnly] = useState<HoursSyncStore>(() => createStore(() => ({ status: null as HoursSyncStatus | null })));
  const [silent] = useState(() => createStaticChimeStore());
  const [noPlans] = useState(() => createStaticRecurringStore());
  return (
    <StoresContext.Provider
      value={{ day, categories, flags, recurring: recurring ?? noPlans, sync: sync ?? localOnly, chimes: chimes ?? silent }}>
      {children}
    </StoresContext.Provider>
  );
}

function useStores(): Stores {
  const stores = useContext(StoresContext);
  if (!stores) throw new Error('This screen needs a StoresProvider above it');
  return stores;
}

export function useDay<T>(selector: (state: DayState) => T): T {
  return useStore(useStores().day, selector);
}

export function useCategories<T>(selector: (state: CategoryState) => T): T {
  return useStore(useStores().categories, selector);
}

export function useFlags<T>(selector: (state: FlagState) => T): T {
  return useStore(useStores().flags, selector);
}

export function useRecurring<T>(selector: (state: RecurringState) => T): T {
  return useStore(useStores().recurring, selector);
}

export function useChimes<T>(selector: (state: ChimeState) => T): T {
  return useStore(useStores().chimes, selector);
}

// Where the hours stand with the server, as the screens read it. The account itself is the
// pad's: one sign-in covers both, and its screen is the host app's.
export type SyncView = {
  signedIn: boolean;
  status: HoursSyncStatus | null;
  // The line under the day: 'Saved on this device only.' or how the last sync went.
  line: string;
  // Pushes and pulls now, the pad's rows and the hours'. Resolves when both are done.
  syncNow(): Promise<void>;
};

export function useSync(): SyncView {
  const status = useStore(useStores().sync, (s) => s.status);
  const signedIn = usePad((s) => s.session !== null);
  return { signedIn, status, line: signedIn ? hoursSyncLine(status) : 'Saved on this device only.', syncNow: refresh };
}
