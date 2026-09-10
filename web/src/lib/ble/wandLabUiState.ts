import { useEffect, useRef, useState } from 'react';

/** Scratch Wand Lab UI (not part of exported config / Sheets). */
export const WAND_LAB_UI_LS_KEY = 'illuma-wandlab-ui';

let cache = null;
const listeners: Set<() => void> = new Set();

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

function notifyListeners() {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore subscriber errors */
    }
  });
}

function writeAll(next) {
  cache = next;
  try {
    localStorage.setItem(WAND_LAB_UI_LS_KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  notifyListeners();
}

function sameUiValue(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return Object.is(a, b);
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

/**
 * Read a Wand Lab UI slice without writing it back. Subscribes to patches from
 * `useWandLabUiState` so a keep-mounted tab (e.g. Fuzz reading Tail Builder
 * assembly keys) stays in sync when the owner tab edits them.
 */
export function useWandLabUiRead(key, defaultValue) {
  const fallbackRef = useRef(undefined);
  if (fallbackRef.current === undefined) {
    fallbackRef.current = typeof defaultValue === 'function' ? defaultValue() : defaultValue;
  }
  const [state, setState] = useState(() => mergeStored(readAll()[key], fallbackRef.current));

  useEffect(() => {
    const sync = () => {
      const next = mergeStored(readAll()[key], fallbackRef.current);
      setState((prev) => (sameUiValue(prev, next) ? prev : next));
    };
    listeners.add(sync);
    return () => {
      listeners.delete(sync);
    };
  }, [key]);

  return state;
}
