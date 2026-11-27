import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { openHours, type HoursStores } from '@hissypad/state/hours';

import { CategoriesScreen } from './CategoriesScreen';
import type { TodayPart } from '@hissypad/core';
import { dayKey, type Slot } from '@hissypad/core/hours';

import { DayScreen, Settings } from './DayScreen';
import { BrandContext } from './host';
import { FocusScreen, PartScreen } from './FocusScreen';
import { LinesContext, type RenderLines } from './HostedLines';
import { StoresProvider, useDay } from './provider';
import { RecurringScreen } from './RecurringScreen';
import { LINE, SchemeContext, serif, SIZE, useTheme } from './theme';

// Flags are hidden since 2026-11-27 (Kevin: kept for a later version): FlagsScreen and the
// flag store are still here, with no way in.
// 'focus' is home (Kevin, 2026-11-27, round 4): one hour. 'day' is the list of a day's
// hours, 'own' and 'scheduled' are Today's two sections.
type Screen = 'focus' | 'day' | 'plans' | TodayPart;

type Props = {
  // The host's own Light / Dark choice; null or absent follows the device.
  scheme?: 'light' | 'dark' | null;
  // The host's own pad editor for the lines of an open hour. Both apps hand one in;
  // without it (a screen under test) an open hour draws no lines.
  renderLines?: RenderLines;
  // The app's name, for the left of each screen's first row (host.tsx). The phone hands it
  // in; with it, the day's own menu is left out.
  brand?: ReactNode;
};

// The Hours mode, whole. It opens on one hour, the one the clock is in, as a pad of the
// lines put in it (FocusScreen): somewhere to stay while getting things done. From there:
// the list of the day's hours (a tap on one comes back on that hour), Today's lines with
// no hour and its schedule, and the screen for recurring plans. The web app and the phone
// both mount this; it opens the hours' local rows on first use.
export function HoursApp({ scheme = null, renderLines, brand = null }: Props) {
  const { ready: stores, failed } = useHoursStores();
  const [screen, setScreen] = useState<Screen>('focus');
  // The hour the focus screen is on; null follows the clock.
  const [at, setAt] = useState<Slot | null>(null);

  const back = () => setScreen('day');
  const home = () => setScreen('focus');

  return (
    <SchemeContext.Provider value={scheme}>
    <BrandContext.Provider value={brand}>
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
          {screen === 'plans' ? (
            <RecurringScreen onBack={back} />
          ) : (
            <LinesContext.Provider value={renderLines ?? null}>
              {screen === 'day' ? (
                <DayScreen
                  onEditPlans={() => setScreen('plans')}
                  onPick={(slot) => {
                    const now = new Date();
                    setAt(slot.day === dayKey(now) && slot.hour === now.getHours() ? null : slot);
                    home();
                  }}
                />
              ) : screen === 'focus' ? (
                <FocusScreen at={at} onList={back} onGo={setAt} onPart={setScreen} />
              ) : (
                <PartScreen part={screen} onBack={home} />
              )}
            </LinesContext.Provider>
          )}
        </StoresProvider>
      )}
    </BrandContext.Provider>
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

// The recurring plans and Hours' settings on their own, for a host that has them in its own
// menu (the phone, whose Hours has no menu of its own).
export function RecurringApp({ scheme = null, onClose }: CategoriesProps) {
  const stores = useHoursStores();
  return (
    <SchemeContext.Provider value={scheme}>
      {!stores.ready ? (
        <Notice title={stores.failed ? 'Hours could not open its rows.' : 'Opening your plans.'} detail={stores.failed} />
      ) : (
        <StoresProvider day={stores.ready.day} categories={stores.ready.categories} flags={stores.ready.flags} recurring={stores.ready.recurring}>
          <RecurringScreen onBack={onClose} backLabel="Close" />
        </StoresProvider>
      )}
    </SchemeContext.Provider>
  );
}

export function HoursSettingsApp({ scheme = null }: Pick<Props, 'scheme'>) {
  const stores = useHoursStores();
  return (
    <SchemeContext.Provider value={scheme}>
      {!stores.ready ? (
        <Notice title={stores.failed ? 'Hours could not open its rows.' : 'Opening your settings.'} detail={stores.failed} />
      ) : (
        <StoresProvider day={stores.ready.day} categories={stores.ready.categories} flags={stores.ready.flags} chimes={stores.ready.chimes}>
          <SettingsBody />
        </StoresProvider>
      )}
    </SchemeContext.Provider>
  );
}

function SettingsBody() {
  const start = useDay((s) => s.start);
  const setStart = useDay((s) => s.setStart);
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.settings}>
      <Settings start={start} onStart={(hour) => void setStart(hour)} />
    </ScrollView>
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
  settings: { gap: 20, padding: 20 },
  notice: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  text: { fontFamily: serif, fontSize: SIZE, lineHeight: LINE, textAlign: 'center', maxWidth: 480 },
});
