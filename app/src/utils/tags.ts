import type { CustomPalette, PaletteSet, Preset } from '../stores/store';

export const TAG_SUGGESTIONS = [
  'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom',
  'Disneyland', 'California Adventure', 'Disney Springs',
  'Disney', 'Marvel', 'Star Wars', 'Pixar', 'Frozen', 'Princess',
  'Halloween', 'Christmas', 'Parade', 'Home',
];

export function normalizeTags(raw?: string[] | null): string[] {
  if (!raw?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const s = t.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function parseTagsInput(text: string): string[] {
  return normalizeTags(text.split(/[,;]+/));
}

export function tagsToInput(tags?: string[]): string {
  return (tags || []).join(', ');
}

export function collectAllTags(items: { tags?: string[] }[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const t of item.tags || []) {
      const s = t.trim();
      if (s) set.add(s);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function itemMatchesTagFilter(
  item: { name: string; tags?: string[] },
  search: string,
  activeTag: string | null,
): boolean {
  if (activeTag) {
    const want = activeTag.toLowerCase();
    if (!(item.tags || []).some(t => t.toLowerCase() === want)) return false;
  }
  const q = search.trim().toLowerCase();
  if (!q) return true;
  if (item.name.toLowerCase().includes(q)) return true;
  return (item.tags || []).some(t => t.toLowerCase().includes(q));
}

export function duplicateName(name: string): string {
  const base = name.trim() || 'Untitled';
  if (/\(copy(?: \d+)?\)$/i.test(base)) {
    return base.replace(/\(copy\)$/i, '(copy 2)').replace(/\(copy (\d+)\)$/i, (_, n) => `(copy ${parseInt(n, 10) + 1})`);
  }
  return `${base} (copy)`;
}

export function duplicatePreset(p: Preset, newId: string): Preset {
  return {
    ...p,
    id: newId,
    name: duplicateName(p.name),
    tags: [...(p.tags || [])],
    createdAt: Date.now(),
    wled: JSON.parse(JSON.stringify(p.wled)),
    memory: { ...p.memory },
  };
}

export function duplicateCustomPalette(p: CustomPalette, newId: string): CustomPalette {
  return {
    id: newId,
    name: duplicateName(p.name),
    colors: [...p.colors],
    tags: [...(p.tags || [])],
  };
}

export function duplicatePaletteSet(s: PaletteSet, newId: string): PaletteSet {
  return {
    id: newId,
    name: duplicateName(s.name),
    paletteIds: [...s.paletteIds],
    tags: [...(s.tags || [])],
  };
}

export interface SavedColorEntry {
  id: string;
  name: string;
  hex: string;
  tags?: string[];
}

export function duplicateSavedColor(c: SavedColorEntry, newId: string): SavedColorEntry {
  return {
    id: newId,
    name: duplicateName(c.name),
    hex: c.hex,
    tags: [...(c.tags || [])],
  };
}
