/**
 * Foreground + interval drain for the Sheets upload outbox.
 */

import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { drainSheetsQueue } from '../services/sheetsSync';

const DRAIN_INTERVAL_MS = 60_000;

export function useSheetsQueueDrain() {
  useEffect(() => {
    const run = () => { void drainSheetsQueue(); };
    run();
    const interval = setInterval(run, DRAIN_INTERVAL_MS);
    const onAppState = (next: AppStateStatus) => {
      if (next === 'active') run();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);
}
