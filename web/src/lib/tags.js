export const TAG_SUGGESTIONS = [
  'Magic Kingdom', 'EPCOT', 'Hollywood Studios', 'Animal Kingdom',
  'Disneyland', 'California Adventure', 'Disney Springs',
  'Disney', 'Marvel', 'Star Wars', 'Pixar', 'Frozen', 'Princess',
  'Halloween', 'Christmas', 'Parade', 'Home',
];

export function normalizeTags(raw) {
  if (!raw?.length) return [];
  const seen = new Set();
  const out = [];
  for (const t of raw) {
    const s = String(t).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function parseTagsInput(text) {
  return normalizeTags(String(text || '').split(/[,;]+/));
}

export function tagsToInput(tags) {
  return (tags || []).join(', ');
}

export function collectAllTags(items) {
  const set = new Set();
  (items || []).forEach(item => (item.tags || []).forEach(t => { const s = String(t).trim(); if (s) set.add(s); }));
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export function itemMatchesTagFilter(item, search, activeTag) {
  if (activeTag) {
    const want = activeTag.toLowerCase();
    if (!(item.tags || []).some(t => t.toLowerCase() === want)) return false;
  }
  const q = String(search || '').trim().toLowerCase();
  if (!q) return true;
  if ((item.name || '').toLowerCase().includes(q)) return true;
  return (item.tags || []).some(t => t.toLowerCase().includes(q));
}

export function duplicateTaggedName(name) {
  const base = (name || '').trim() || 'Untitled';
  if (/\(copy(?: \d+)?\)$/i.test(base)) {
    return base.replace(/\(copy\)$/i, '(copy 2)').replace(/\(copy (\d+)\)$/i, (_, n) => `(copy ${parseInt(n, 10) + 1})`);
  }
  return `${base} (copy)`;
}
