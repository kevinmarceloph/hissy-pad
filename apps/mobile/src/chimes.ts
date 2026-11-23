// Chimes on the phone (Hours): a local notification at each chosen minute of every hour,
// with a text reply, so an hour can be logged from the lock screen. Local, not push: it
// works offline and needs no server, and the operating system holds the schedule, so it
// rings with the app closed. The web rings from the page instead (apps/web/src/platform/chimes.ts).
//
// A build from before expo-notifications was added has no native module for it: there the
// chimes are simply not offered (see shake.ts for why the native side is asked first).
import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { chimeSlot, chimeTitle, cleanChimes, type ChimeOutcome, type DayKey } from '@hissypad/core/hours'
import type { ChimePlatform } from '@hissypad/state/hours'

type Notifications = typeof import('expo-notifications')

// Category identifiers may not contain ':' or '-'.
const CATEGORY = 'hissypad_hour'
const LOG_ACTION = 'log'

let loaded: Notifications | null | undefined
function notifications(): Notifications | null {
  if (loaded !== undefined) return loaded
  loaded = null
  if (!requireOptionalNativeModule('ExpoNotificationScheduler')) return null
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const N = require('expo-notifications') as Notifications
    N.setNotificationHandler({
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    })
    loaded = N
  } catch {
    loaded = null
  }
  return loaded
}

async function cancelAll(N: Notifications): Promise<void> {
  const all = await N.getAllScheduledNotificationsAsync();
  for (const n of all) {
    if (n.content.categoryIdentifier === CATEGORY) {
      await N.cancelScheduledNotificationAsync(n.identifier);
    }
  }
}

// Replaces the whole schedule with one chime per chosen minute. An empty list turns it off.
async function applyChimes(minutes: number[]): Promise<ChimeOutcome> {
  const N = notifications();
  if (!N) return 'denied';
  const chosen = cleanChimes(minutes);
  if (chosen.length === 0) {
    await cancelAll(N);
    return 'off';
  }

  const permission = await N.requestPermissionsAsync();
  if (!permission.granted) return 'denied';

  await N.setNotificationCategoryAsync(CATEGORY, [
    {
      identifier: LOG_ACTION,
      buttonTitle: 'Log it',
      textInput: { submitButtonTitle: 'Save', placeholder: 'proposals, lunch, scrolled' },
      options: { opensAppToForeground: false },
    },
  ]);

  await cancelAll(N);
  for (const minute of chosen) {
    const content = {
      title: chimeTitle(minute),
      body: 'Hold to reply and log it.',
      categoryIdentifier: CATEGORY,
      // A reply needs to know which chime it answers: see chimeSlot.
      data: { minute },
    };
    if (Platform.OS === 'ios') {
      // Every hour at this minute: a calendar match on the minute with no hour set.
      await N.scheduleNotificationAsync({
        content,
        trigger: { type: N.SchedulableTriggerInputTypes.CALENDAR, minute, repeats: true },
      });
    } else {
      // Android has no "every hour at this minute", so it gets one daily alarm per hour.
      for (let hour = 0; hour < 24; hour++) {
        await N.scheduleNotificationAsync({
          content,
          trigger: { type: N.SchedulableTriggerInputTypes.DAILY, hour, minute },
        });
      }
    }
  }
  return 'on';
}


// The schedule lives in the operating system and outlasts the app, so there is nothing to
// start again. Whether notifications are still allowed is not checked here.
function resumeChimes(minutes: number[]): ChimeOutcome {
  return cleanChimes(minutes).length > 0 ? 'on' : 'off'
}

// Calls back with the slot a reply belongs to.
function listenForReplies(onReply: (day: DayKey, hour: number, note: string) => void): () => void {
  const N = notifications();
  if (!N) return () => {};
  const subscription = N.addNotificationResponseReceivedListener((response) => {
    const note = response.userText?.trim();
    if (response.actionIdentifier !== LOG_ACTION || !note) return;
    const { date, request } = response.notification;
    const minute = Number((request.content.data as { minute?: unknown } | null)?.minute ?? 0);
    // `date` is seconds on iOS and milliseconds on Android.
    const slot = chimeSlot(new Date(date < 1e11 ? date * 1000 : date), Number.isInteger(minute) ? minute : 0);
    onReply(slot.day, slot.hour, note);
  });
  return () => subscription.remove();
}

// Null on a build without the native module: Hours then leaves the chimes out of Settings.
export function mobileChimes(): ChimePlatform | null {
  if (!notifications()) return null
  return { apply: applyChimes, resume: resumeChimes, needsPageOpen: false, sound: null, listenForReplies }
}
