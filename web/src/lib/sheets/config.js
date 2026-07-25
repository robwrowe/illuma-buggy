const SHEETS_ENDPOINT_STORAGE = 'wandlab-sheets-endpoint';

/** Strip whitespace and wrapping quotes people often paste from docs. */
export function normalizeSheetsEndpoint(url) {
  let s = String(url || '').trim();
  // Common paste artifacts: "https://...", 'https://...', `https://...`
  if (
    (s.startsWith('"') && s.endsWith('"'))
    || (s.startsWith("'") && s.endsWith("'"))
    || (s.startsWith('`') && s.endsWith('`'))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Read endpoint. Mantine useLocalStorage JSON-encodes values, so we must
 * JSON.parse before use — otherwise fetch sees `"https://…"` (with quotes)
 * and treats it as a relative URL under the current page.
 */
export function getSheetsEndpoint() {
  const raw = localStorage.getItem(SHEETS_ENDPOINT_STORAGE);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return normalizeSheetsEndpoint(parsed);
  } catch {
    /* plain string from an older write */
  }
  return normalizeSheetsEndpoint(raw);
}

export function setSheetsEndpoint(url) {
  // Match Mantine useLocalStorage encoding so App.jsx Settings stay in sync.
  localStorage.setItem(SHEETS_ENDPOINT_STORAGE, JSON.stringify(normalizeSheetsEndpoint(url)));
}

export { SHEETS_ENDPOINT_STORAGE };
