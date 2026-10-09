/**
 * In-memory diagnostics for "which layer died while backgrounded".
 * The Diagnostics screen polls this; location ticks and BLE writes update it.
 */

export interface BackgroundHealth {
  lastJsTickAt: number;
  lastShowsTickAt: number;
  lastBleWriteAt: number;
  lastBleWriteOk: boolean | null;
  lastBleWriteDetail: string;
}

const health: BackgroundHealth = {
  lastJsTickAt: 0,
  lastShowsTickAt: 0,
  lastBleWriteAt: 0,
  lastBleWriteOk: null,
  lastBleWriteDetail: '',
};

export function getBackgroundHealth(): BackgroundHealth {
  return health;
}

export function markJsTick(at = Date.now()): void {
  health.lastJsTickAt = at;
}

export function markShowsTick(at = Date.now()): void {
  health.lastShowsTickAt = at;
  health.lastJsTickAt = at;
}

export function markBleWrite(ok: boolean, detail: string, at = Date.now()): void {
  health.lastBleWriteAt = at;
  health.lastBleWriteOk = ok;
  health.lastBleWriteDetail = detail;
}
