import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { openHours, type HoursStores } from '@hissypad/state/hours';

import { CategoriesScreen } from './CategoriesScreen';
import { DayScreen } from './DayScreen';
import { FlagsScreen } from './FlagsScreen';
import { StoresProvider } from './provider';
import { RecurringScreen } from './RecurringScreen';
import { LINE, SchemeContext, serif, SIZE, useTheme } from './theme';

type Screen = 'day' | 'categories' | 'flags' | 'plans';

type Props = {
  // The host's own Light / Dark choice; null or absent follows the device.
  scheme?: 'light' | 'dark' | null;
};

// The Hours mode, whole: one row per hour with a plan and what happened, the pad's lines
// assigned to each hour, and the screens for the user's own lists. The web app and the
// phone both mount this; it opens the hours' local rows on first use.
export function HoursApp({ scheme = null }: Props) {
  const [stores, setStores] = useState<HoursStores | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>('day');

  useEffect(() => {
    let live = true;
    openHours().then(
      (opened) => live && setStores(opened),
      (cause: unknown) => live && setFailed(cause instanceof Error ? cause.message : String(cause)),
    );
    return () => {
      live = false;
    };
  }, []);

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
          {screen === 'categories' ? (
            <CategoriesScreen onBack={back} />
          ) : screen === 'flags' ? (
            <FlagsScreen onBack={back} />
          ) : screen === 'plans' ? (
            <RecurringScreen onBack={back} />
          ) : (
            <DayScreen
              onEditCategories={() => setScreen('categories')}
              onEditFlags={() => setScreen('flags')}
              onEditPlans={() => setScreen('plans')}
            />
          )}
        </StoresProvider>
      )}
    </SchemeContext.Provider>
  );
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
