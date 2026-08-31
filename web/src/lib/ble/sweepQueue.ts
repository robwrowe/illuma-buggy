import { useCallback, useEffect, useState } from 'react';
import { patchWandLabUiSlice } from './wandLabUiState';
import { generateId } from '../utils';

/**
 * @typedef {{
 *   id: string,
 *   hex_full: string,
 *   label: string,
 *   source: string,
 *   provenance: string,
 *   tail_index: number|null,
 *   color_count: number|null,
 *   expected_colors: object[]|null,
 * }} SweepQueueItem
 */

/** Shared across Tail Builder / Sequence / BitGrid / panel (one localStorage slice). */
let itemsState = null;
const listeners = new Set();

function hydrateItems() {
  if (itemsState != null) return itemsState;
  try {
    const raw = localStorage.getItem('illuma-wandlab-ui');
    const parsed = raw ? JSON.parse(raw) : {};
    itemsState = Array.isArray(parsed['sweepQueue.items']) ? parsed['sweepQueue.items'] : [];
  } catch {
    itemsState = [];
  }
  return itemsState;
}

function commitItems(next) {
  itemsState = next;
  patchWandLabUiSlice('sweepQueue.items', next);
  listeners.forEach((fn) => fn());
}

/** Per-tab "add current packet(s)" handlers. Last register for a tab wins. */
const currentAdders = {};

export function registerSweepQueueAdder(tab, fn) {
  if (!tab) return () => {};
  currentAdders[tab] = fn;
  return () => {
    if (currentAdders[tab] === fn) delete currentAdders[tab];
  };
}

export function runSweepQueueAdder(tab) {
  const fn = currentAdders[tab];
  if (typeof fn !== 'function') return 0;
  const n = fn();
  return typeof n === 'number' ? n : 0;
}

export function useRegisterSweepQueueAdder(tab, fn) {
  useEffect(() => registerSweepQueueAdder(tab, fn), [tab, fn]);
}

export function useSweepQueue() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    listeners.add(bump);
    return () => {
      listeners.delete(bump);
    };
  }, []);

  const items = hydrateItems();

  const add = useCallback((newItems) => {
    const arr = Array.isArray(newItems) ? newItems : [newItems];
    commitItems([
      ...hydrateItems(),
      ...arr.map((it) => ({
        id: generateId(),
        color_count: null,
        expected_colors: null,
        tail_index: null,
        label: '',
        source: 'manual',
        provenance: '',
        hex_full: '',
        ...it,
      })),
    ]);
    return arr.length;
  }, []);
  const remove = useCallback((id) => {
    commitItems(hydrateItems().filter((it) => it.id !== id));
  }, []);
  const clear = useCallback(() => {
    commitItems([]);
  }, []);
  const move = useCallback((id, dir) => {
    const prev = hydrateItems();
    const idx = prev.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const j = idx + dir;
    if (j < 0 || j >= prev.length) return;
    const next = [...prev];
    [next[idx], next[j]] = [next[j], next[idx]];
    commitItems(next);
  }, []);

  return { items, add, remove, clear, move };
}
