// Chimes in a browser: the minutes past every hour to ask where the hour is going (Hours).
// There is no schedule the browser will keep for a closed page, so the page rings for
// itself: a timer, a short sound, and a notification where the browser shows them. All of
// it stops when the page goes away, and a phone's browser also stops it when the page is
// in the background. The phone app has local notifications instead (apps/mobile/src/chimes.ts).
import { chimeTitle, cleanChimes, createChimer, type ChimeOutcome } from '@hissypad/core/hours'
import type { ChimePlatform } from '@hissypad/state/hours'
import { macAsk, macShell } from './os'

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

// Tests load this module in Node, where there may be no window.
const inBrowser = typeof window !== 'undefined';

let audio: AudioContext | null = null;

// A browser only lets sound start from a press or a key. The first one on the page makes
// the audio context, so a chime that comes later has something to play through.
function unlockSound(): void {
  if (!inBrowser) return;
  try {
    const Context = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    if (audio.state !== 'running') void audio.resume().catch(() => undefined);
  } catch {
    // No sound on this browser: the notification, if there is one, still shows.
  }
}

if (inBrowser) {
  const options = { capture: true, passive: true } as const;
  window.addEventListener('pointerdown', unlockSound, options);
  window.addEventListener('keydown', unlockSound, options);
}

// Two soft notes, the second a fifth above the first, about half a second in all.
function ring(context: AudioContext): void {
  const start = context.currentTime + 0.02;
  [
    [880, 0],
    [1318.5, 0.16],
  ].forEach(([pitch = 880, delay = 0]) => {
    const tone = context.createOscillator();
    const level = context.createGain();
    tone.type = 'sine';
    tone.frequency.value = pitch;
    level.gain.setValueAtTime(0.0001, start + delay);
    level.gain.exponentialRampToValueAtTime(0.25, start + delay + 0.02);
    level.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.4);
    tone.connect(level).connect(context.destination);
    tone.start(start + delay);
    tone.stop(start + delay + 0.45);
  });
}

function play(): void {
  if (!audio) return;
  const context = audio;
  if (context.state === 'running') ring(context);
  else void context.resume().then(() => ring(context)).catch(() => undefined);
}

const soundChime = () => {
  unlockSound();
  play();
};

// The Mac app has no Notification of the page's: the app shows them, and says whether it
// may ('default' until asked). Read when the page opens and after each ask.
const viaMac = () => macShell()?.notifications === true;
let macState: NotificationPermission = 'default';
const readMacState = async (type: 'notifyState' | 'notifyAsk') => {
  const said = await macAsk({ type });
  if (said === 'granted' || said === 'denied' || said === 'default') macState = said;
};
if (viaMac()) void readMacState('notifyState');

const canNotify = () => viaMac() || (inBrowser && 'Notification' in window);
const permission = (): NotificationPermission => (viaMac() ? macState : Notification.permission);

function notify(at: Date): void {
  if (viaMac()) {
    if (macState === 'granted') void macAsk({ type: 'notify', title: chimeTitle(at.getMinutes()), body: 'Click to open your hours.', tag: 'hissypad-chime' });
    return;
  }
  if (!canNotify() || Notification.permission !== 'granted') return;
  try {
    const note = new Notification(chimeTitle(at.getMinutes()), {
      body: 'Click to open your hours.',
      // One chime replaces the last instead of stacking up.
      tag: 'hissypad-chime',
    });
    note.onclick = () => {
      window.focus();
      note.close();
    };
  } catch {
    // Some browsers only allow notifications from a service worker. The sound still played.
  }
}

const chimer = createChimer({
  now: () => new Date(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  fire: (at) => {
    play();
    notify(at);
  },
});

const outcome = (minutes: number[]): ChimeOutcome =>
  minutes.length === 0 ? 'off' : canNotify() && permission() === 'granted' ? 'on' : 'sound';

// From a press: starts the timer and asks, once, whether notifications may show.
async function applyChimes(minutes: number[]): Promise<ChimeOutcome> {
  const chosen = cleanChimes(minutes);
  chimer.set(chosen);
  if (chosen.length > 0) {
    unlockSound();
    if (canNotify() && permission() === 'default') {
      try {
        if (viaMac()) await readMacState('notifyAsk');
        else await Notification.requestPermission();
      } catch {
        // Asked outside a press, or not allowed here: the sound is what there is.
      }
    }
  }
  return outcome(chosen);
}

// When the page opens: starts the timer from the saved minutes without asking for anything.
function resumeChimes(minutes: number[]): ChimeOutcome {
  const chosen = cleanChimes(minutes);
  chimer.set(chosen);
  return outcome(chosen);
}

export const webChimes: ChimePlatform = {
  apply: applyChimes,
  resume: resumeChimes,
  needsPageOpen: true,
  sound: soundChime,
}
