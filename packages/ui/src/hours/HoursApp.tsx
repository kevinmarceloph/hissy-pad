import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { openHours, type HoursStores } from '@hissypad/state/hours';

import { CategoriesScreen } from './CategoriesScreen';
import { DayScreen } from './DayScreen';
import { FlagsScreen } from './FlagsScreen';
import { StoresProvider } from './provider';
import { RecurringScreen } from './RecurringScreen';
import { LINE, SchemeContext, serif, SIZE, useTheme } from './theme';

type Screen = 'day' | 'flags' | 'plans';

type Props = {
  // The host's own Light / Dark choice; null or absent follows the device.
  scheme?: 'light' | 'dark' | null;
};

// The Hours mode, whole: one row per hour with a plan and what happened, the pad's lines
// assigned to each hour, and the screens for the user's own lists. The web app and the
// phone both mount this; it opens the hours' local rows on first use.
export function HoursApp({ scheme = null }: Props) {
  const { ready: stores, failed } = useHoursStores();
  const [screen, setScreen] = useState<Screen>('day');

  const back = () => setScreen('day');

  return (
    <SchemeContext.Provider value={scheme}>
      {!stores ? (
        <Notice title={failed ? 'Hours could not open its rows.' : 'Opening your hours.'} detail={failed} />
      ) : (
        <StoresProvider
          day={stores.day}
          categories={stores.categories}
          flags={stores.flags}
          recurring={stores.recurring}
          sync={stores.sync}
          chimes={stores.chimes}>
          {screen === 'flags' ? (
            <FlagsScreen onBack={back} />
          ) : screen === 'plans' ? (
            <RecurringScreen onBack={back} />
          ) : (
            <DayScreen
              onEditFlags={() => setScreen('flags')}
              onEditPlans={() => setScreen('plans')}
            />
          )}
        </StoresProvider>
      )}
    </SchemeContext.Provider>
  );
}

type CategoriesProps = Props & { onClose(): void };

// The category list on its own, for the top menu of both apps: categories are given to
// hours and to lines of the pad alike, so they are edited outside Hours.
export function CategoriesApp({ scheme = null, onClose }: CategoriesProps) {
  const stores = useHoursStores();
  return (
    <SchemeContext.Provider value={scheme}>
      {!stores.ready ? (
        <Notice title={stores.failed ? 'Hours could not open its rows.' : 'Opening your categories.'} detail={stores.failed} />
      ) : (
        <StoresProvider day={stores.ready.day} categories={stores.ready.categories} flags={stores.ready.flags}>
          <CategoriesScreen onBack={onClose} backLabel="Close" />
        </StoresProvider>
      )}
    </SchemeContext.Provider>
  );
}

function useHoursStores(): { ready: HoursStores | null; failed: string | null } {
  const [ready, setReady] = useState<HoursStores | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    openHours().then(
      (opened) => live && setReady(opened),
      (cause: unknown) => live && setFailed(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
  }, []);
  return { ready, failed };
}

function Notice({ title, detail }: { title: string; detail: string | null }) {
  const theme = useTheme();
  return (
    <View role={detail ? 'alert' : undefined} style={[styles.notice, { backgroundColor: theme.paper }]}>
      <Text style={[styles.text, { color: theme.ink }]}>{title}</Text>
      {detail && <Text style={[styles.text, { color: theme.inkSoft }]}>{detail}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  text: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, textAlign: 'center', maxWidth: 480 },
});
