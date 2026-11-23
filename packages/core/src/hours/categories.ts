// Where an hour can go. Categories are rows the user edits: rename, recolor, reorder,
// archive, add. The id is what an entry stores and what syncs, so a rename costs nothing.
// Like entries they are never deleted: archiving takes one out of the picker and the
// hours already tagged with it keep their label and color.

// The colors a category can take. A fixed set on purpose: each key has a light and a dark
// value in src/ui/theme.ts that holds 3:1 against the paper, which a free color picker
// could not promise. The key is what gets stored and synced.
export const COLORS = [
  { key: 'blue', label: 'Blue' },
  { key: 'sky', label: 'Sky' },
  { key: 'teal', label: 'Teal' },
  { key: 'moss', label: 'Moss' },
  { key: 'olive', label: 'Olive' },
  { key: 'ochre', label: 'Ochre' },
  { key: 'brown', label: 'Brown' },
  { key: 'rose', label: 'Rose' },
  { key: 'plum', label: 'Plum' },
  { key: 'indigo', label: 'Indigo' },
  { key: 'night', label: 'Night' },
  { key: 'stone', label: 'Stone' },
] as const;

export type ColorKey = (typeof COLORS)[number]['key'];

const COLOR_LABELS = new Map<string, string>(COLORS.map((c) => [c.key, c.label]));

export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === 'string' && COLOR_LABELS.has(value);
}

export function colorLabel(key: ColorKey): string {
  return COLOR_LABELS.get(key)!;
}

export type Category = {
  id: string;
  label: string;
  color: ColorKey;
  // Order in the picker and the legend. Gaps and ties are fine; ties break on id.
  position: number;
  archived: boolean;
  updatedAt: number; // ms since epoch, client clock
};

export type CategoryPatch = Partial<Pick<Category, 'label' | 'color' | 'position' | 'archived'>>;

// Room for a short name, an em dash and a description after it (see shortLabel).
export const LABEL_MAX = 48;

// A set of categories for tests and examples. Nothing is seeded: the list starts empty
// (Kevin, 2026-11-23).
export const SAMPLE_CATEGORIES: Category[] = (
  [
    ['deep', 'Deep work', 'blue'],
    ['admin', 'Admin', 'stone'],
    ['learn', 'Learning', 'plum'],
    ['people', 'People', 'ochre'],
    ['body', 'Body', 'moss'],
    ['rest', 'Rest', 'teal'],
    ['sleep', 'Sleep', 'night'],
    ['drift', 'Drift', 'rose'],
  ] as const
).map(([id, label, color], position) => ({ id, label, color, position, archived: false, updatedAt: 0 }));

export function sortCategories(list: Category[]): Category[] {
  return [...list].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function activeCategories(list: Category[]): Category[] {
  return sortCategories(list).filter((c) => !c.archived);
}

export function findCategory(list: Category[], id: string | null | undefined): Category | undefined {
  return id ? list.find((c) => c.id === id) : undefined;
}

// A category's name where room is short (an hour's row, the legend over the day): the part
// before an em dash. What follows the dash is a description, shown where the whole name is
// (the pickers, the categories screen), so an emoji can be the name and still carry a note.
// HissyPad's rule for sub-pads, the same way: a name that is all dash stays whole.
export function shortLabel(label: string): string {
  return (label.split('\u2014')[0] ?? '').trim() || label;
}

// Trims, collapses runs of whitespace and cuts to LABEL_MAX.
export function cleanLabel(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, LABEL_MAX).trim();
}

// Why a label cannot be used, in words the screen can show, or null when it can.
export function labelProblem(list: Category[], raw: string, exceptId?: string): string | null {
  const label = cleanLabel(raw);
  if (label === '') return 'A category needs a name.';
  const clash = list.find(
    (c) => !c.archived && c.id !== exceptId && c.label.toLowerCase() === label.toLowerCase(),
  );
  return clash ? `You already have a category called ${clash.label}.` : null;
}

// The first color no active category is using, so a new one is easy to tell apart.
export function nextColor(list: Category[]): ColorKey {
  const used = new Set(list.filter((c) => !c.archived).map((c) => c.color));
  return (COLORS.find((c) => !used.has(c.key)) ?? COLORS[0]).key;
}

export function newCategory(
  list: Category[],
  id: string,
  label: string,
  color: ColorKey,
  now: number,
): Category {
  const last = list.reduce((max, c) => Math.max(max, c.position), -1);
  return { id, label: cleanLabel(label), color, position: last + 1, archived: false, updatedAt: now };
}

export function patchCategory(base: Category, patch: CategoryPatch, now: number): Category {
  return {
    ...base,
    ...patch,
    label: patch.label !== undefined ? cleanLabel(patch.label) : base.label,
    // Never go backwards, for the same reason as entries: last write wins on the server.
    updatedAt: Math.max(now, base.updatedAt + 1),
  };
}

// 'c' plus nine base-36 characters. Short enough for the server's 32-character limit and
// never one of the default ids.
export function newCategoryId(random: () => number = Math.random): string {
  let id = 'c';
  while (id.length < 10) id += Math.floor(random() * 36).toString(36);
  return id;
}
