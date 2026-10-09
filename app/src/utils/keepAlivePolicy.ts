/**
 * The location foreground service is the process keep-alive. Start it whenever
 * any consumer still needs JS to run with the screen off — not only GPS zones.
 */

import { bleService } from '../services/BLEService';
import { useAppStore } from '../stores/store';

export function shouldKeepProcessAlive(bleConnected = bleService.isConnected()): boolean {
  const s = useAppStore.getState();
  if (s.zonesEnabled || s.captureForcedLocationTracking) return true;
  const parkId = s.activePark?.id;
  if (parkId && s.showBindings.some((b) => b.parkId === parkId)) return true;
  if (bleConnected) return true;
  return false;
}
