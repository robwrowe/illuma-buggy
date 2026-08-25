import { useEffect, useRef, useState } from 'react';

/** Scratch Wand Lab UI (not part of exported config / Sheets). */
export const WAND_LAB_UI_LS_KEY = 'illuma-wandlab-ui';

let cache = null;

function readAll() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(WAND_LAB_UI_LS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    cache = {};
  }
  return cache;
}

function writeAll(next) {
  cache = next;
  try {
    localStorage.setItem(WAND_LAB_UI_LS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
}

export function patchWandLabUiSlice(key, value) {
  writeAll({ ...readAll(), [key]: value });
}

function mergeStored(stored, fallback) {
  if (stored === undefined) return fallback;
  if (Array.isArray(fallback)) return Array.isArray(stored) ? stored : fallback;
  if (fallback !== null && typeof fallback === 'object') {
    if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return fallback;
    return { ...fallback, ...stored };
  }
  return stored;
}

/**
 * useState that rehydrates from localStorage and writes back (debounced, flushed on unmount).
 * One JSON blob under WAND_LAB_UI_LS_KEY; `key` is a slice name inside it.
 */
export function useWandLabUiState(key, defaultValue) {
  const [state, setState] = useState(() => {
    const fallback = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
    return mergeStored(readAll()[key], fallback);
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const t = setTimeout(() => patchWandLabUiSlice(key, state), 200);
    return () => clearTimeout(t);
  }, [key, state]);

  useEffect(() => () => {
    patchWandLabUiSlice(key, stateRef.current);
  }, [key]);

  return [state, setState];
}
