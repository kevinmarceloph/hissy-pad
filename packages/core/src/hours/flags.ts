// Marks an hour can carry: distracted, mindful, HALTS. Like categories they are rows the
// user edits (rename, reorder, archive, add) and never deletes. Each flag has its own short
// list of options, Yes and No to start, and each option has a color. An hour starts with
// every flag unset: an entry stores one token per flag that was answered, "flag:option".
import { cleanLabel, COLORS, isColorKey, type ColorKey } from './categories';

// One answer a flag can take. Options live inside their flag's row and sync with it.
export type FlagOption = {
  id: string;
  label: string;
  // Drawn behind the flag's icon on an hour that carries this answer.
  color: ColorKey;
  // Taken out of the editor; hours that already carry it keep its label and color.
  archived?: boolean;
};

// The id an old token without an option stands for: a flag that was simply "on".
export const YES = 'yes';

// What every flag starts with. The column defaults on the device and on the server hold
// this same list, so flags from before options existed agree everywhere.
export const DEFAULT_OPTIONS: FlagOption[] = [
  { id: YES, label: 'Yes', color: 'blue' },
  { id: 'no', label: 'No', color: 'rose' },
];

export const MAX_OPTIONS = 8;

export type Flag = {
  id: string;
  label: string;
  // One emoji that stands for the flag on an hour's row, or '' for none.
  icon: string;
  // Order in the editor. Gaps and ties are fine; ties break on id.
  position: number;
  archived: boolean;
  // The answers this flag can take, in the order the editor shows them. Never empty.
  options: FlagOption[];
  updatedAt: number; // ms since epoch, client clock
};

export type FlagPatch = Partial<Pick<Flag, 'label' | 'icon' | 'position' | 'archived' | 'options'>>;

// A set of flags for tests and examples. Nothing is seeded: the list starts empty
// (Kevin, 2026-11-23).
export const SAMPLE_FLAGS: Flag[] = (
  [
    ['distracted', 'Distracted', '😵'],
    ['mindful', 'Mindful', '🧘'],
    ['halts', 'HALTS', '🛑'],
  ] as const
).map(([id, label, icon], position) => ({
  id,
  label,
  icon,
  position,
  archived: false,
  options: DEFAULT_OPTIONS.map((o) => ({ ...o })),
  updatedAt: 0,
}));

// Whatever came out of a JSON column or off the wire, as a usable list of options: ids
// and labels that hold up, a color from the palette, each id once. A list with nothing
// usable in it is the default one.
export function cleanOptions(raw: unknown): FlagOption[] {
  const seen = new Set<string>();
  const options: FlagOption[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, label, color, archived } = item as Record<string, unknown>;
    if (typeof id !== 'string' || !/^[a-z0-9]{1,16}$/.test(id) || seen.has(id)) continue;
    const name = typeof label === 'string' ? cleanLabel(label) : '';
    if (name === '') continue;
    seen.add(id);
    options.push({ id, label: name, color: isColorKey(color) ? color : 'stone', ...(archived === true ? { archived: true } : {}) });
    if (options.length === MAX_OPTIONS) break;
  }
  return options.length > 0 ? options : DEFAULT_OPTIONS.map((o) => ({ ...o }));
}

export function activeOptions(flag: Pick<Flag, 'options'>): FlagOption[] {
  return flag.options.filter((o) => !o.archived);
}

// An option by id, archived ones included, or null when this device does not know it.
export function flagOption(flag: Pick<Flag, 'options'>, id: string): FlagOption | null {
  return flag.options.find((o) => o.id === id) ?? null;
}

// Why an option's label cannot be used, or null when it can.
export function optionLabelProblem(options: FlagOption[], raw: string, exceptId?: string): string | null {
  const label = cleanLabel(raw);
  if (label === '') return 'An option needs a name.';
  const clash = options.find((o) => !o.archived && o.id !== exceptId && o.label.toLowerCase() === label.toLowerCase());
  return clash ? `This flag already has an option called ${clash.label}.` : null;
}

// 'o' plus five base-36 characters.
export function newOptionId(random: () => number = Math.random): string {
  let id = 'o';
  while (id.length < 6) id += Math.floor(random() * 36).toString(36);
  return id;
}

// The first palette color no option of the flag uses yet.
export function nextOptionColor(options: FlagOption[]): ColorKey {
  const used = new Set(options.filter((o) => !o.archived).map((o) => o.color));
  return (COLORS.find((c) => !used.has(c.key)) ?? COLORS[0]).key;
}

// An icon is one emoji: the first thing a reader would call a character, however many
// code points it is made of (a flag, a skin tone, a family). Anything after it is dropped.
export function cleanIcon(raw: string): string {
  const text = raw.trim();
  if (text === '') return '';
  const first =
    typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)][0]?.segment ?? ''
      : ([...text][0] ?? '');
  // The server takes 16 characters at most.
  return first.length <= 16 ? first : '';
}

// What stands for a flag where there is room for one mark: its icon, or failing that the
// first letter of its name.
export function flagMark(flag: Pick<Flag, 'icon' | 'label'>): string {
  return flag.icon || [...flag.label.trim()][0]?.toUpperCase() || '?';
}

export function sortFlags(list: Flag[]): Flag[] {
  return [...list].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function activeFlags(list: Flag[]): Flag[] {
  return sortFlags(list).filter((f) => !f.archived);
}

// Why a label cannot be used, in words the screen can show, or null when it can.
export function flagLabelProblem(list: Flag[], raw: string, exceptId?: string): string | null {
  const label = cleanLabel(raw);
  if (label === '') return 'A flag needs a name.';
  const clash = list.find(
    (f) => !f.archived && f.id !== exceptId && f.label.toLowerCase() === label.toLowerCase(),
  );
  return clash ? `You already have a flag called ${clash.label}.` : null;
}

export function newFlag(list: Flag[], id: string, label: string, icon: string, now: number): Flag {
  const last = list.reduce((max, f) => Math.max(max, f.position), -1);
  return {
    id,
    label: cleanLabel(label),
    icon: cleanIcon(icon),
    position: last + 1,
    archived: false,
    options: DEFAULT_OPTIONS.map((o) => ({ ...o })),
    updatedAt: now,
  };
}

export function patchFlag(base: Flag, patch: FlagPatch, now: number): Flag {
  return {
    ...base,
    ...patch,
    label: patch.label !== undefined ? cleanLabel(patch.label) : base.label,
    icon: patch.icon !== undefined ? cleanIcon(patch.icon) : base.icon,
    options: patch.options !== undefined ? cleanOptions(patch.options) : base.options,
    // Never go backwards: last write wins on the server.
    updatedAt: Math.max(now, base.updatedAt + 1),
  };
}

// 'f' plus nine base-36 characters, never one of the default ids.
export function newFlagId(random: () => number = Math.random): string {
  let id = 'f';
  while (id.length < 10) id += Math.floor(random() * 36).toString(36);
  return id;
}

// An entry's flag tokens, each once and in a stable order, so two devices that give the
// same answers write the same value.
export function cleanFlagIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

// A token is "flag:option". One with no option is from before options existed, when a
// flag was only ever on: it reads as Yes.
function readToken(token: string): { flag: string; option: string } {
  const at = token.indexOf(':');
  return at < 0 ? { flag: token, option: YES } : { flag: token.slice(0, at), option: token.slice(at + 1) };
}

// Every answer an entry carries, as flag id and option id.
export function flagChoices(tokens: readonly string[]): { flag: string; option: string }[] {
  return tokens.map(readToken);
}

// The option an entry carries for a flag, or null when the flag is unset there.
export function flagChoice(tokens: readonly string[], flagId: string): string | null {
  return flagChoices(tokens).find((c) => c.flag === flagId)?.option ?? null;
}

// Answers a flag (or, with null, sets it back to unset), leaving the other flags alone.
export function setFlagChoice(tokens: readonly string[], flagId: string, option: string | null): string[] {
  const others = tokens.filter((token) => readToken(token).flag !== flagId);
  return cleanFlagIds(option === null ? others : [...others, `${flagId}:${option}`]);
}
