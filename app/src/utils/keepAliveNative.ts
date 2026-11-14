/**
 * Optional native helpers (partial wake lock, Wi-Fi lock, battery-optimization
 * query). Missing from the current binary until the next dev-client / release
 * build that compiles `illuma-keepalive`. Callers must tolerate that.
 */

import { requireNativeModule } from 'expo-modules-core';

type NativeKeepAlive = {
  isIgnoringBatteryOptimizations: () => boolean;
  requestIgnoreBatteryOptimizations: () => boolean;
  acquireRadioLocks: () => boolean;
  releaseRadioLocks: () => boolean;
};

let native: NativeKeepAlive | null | undefined;

function mod(): NativeKeepAlive | null {
  if (native !== undefined) return native;
  try {
    native = requireNativeModule<NativeKeepAlive>('IllumaKeepAlive');
  } catch {
    native = null;
  }
  return native;
}

export function isNativeKeepAliveAvailable(): boolean {
  return mod() != null;
}

export function isIgnoringBatteryOptimizations(): boolean | null {
  const m = mod();
  if (!m) return null;
  try {
    return !!m.isIgnoringBatteryOptimizations();
  } catch {
    return null;
  }
}

export function requestIgnoreBatteryOptimizations(): boolean {
  const m = mod();
  if (!m) return false;
  try {
    return !!m.requestIgnoreBatteryOptimizations();
  } catch (e) {
    console.warn('[KeepAlive] battery exemption request failed', e);
    return false;
  }
}

export function acquireRadioLocks(): void {
  const m = mod();
  if (!m) return;
  try {
    m.acquireRadioLocks();
  } catch (e) {
    console.warn('[KeepAlive] acquireRadioLocks failed', e);
  }
}

export function releaseRadioLocks(): void {
  const m = mod();
  if (!m) return;
  try {
    m.releaseRadioLocks();
  } catch (e) {
    console.warn('[KeepAlive] releaseRadioLocks failed', e);
  }
}
