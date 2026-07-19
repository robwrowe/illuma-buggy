import { BleManager, Device } from 'react-native-ble-plx';
import base64 from 'base64-js';

/** Matches firmware Config.h SCANNER_MFR_MAGIC_* + 6-byte MAC */
export const SCANNER_MFR_MAGIC_0 = 0x49;
export const SCANNER_MFR_MAGIC_1 = 0x53;
export const SCANNER_UNPAIRED_NAME = 'IllumaScan';

export interface DiscoveredScanner {
  mac: string;
  rssi: number;
  name: string;
}

function decodeManufacturerData(b64: string | null): number[] {
  if (!b64) return [];
  return Array.from(base64.toByteArray(b64));
}

export function formatMacBytes(bytes: number[]): string {
  return bytes
    .slice(0, 6)
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/** Parse IllumaScanner unpaired advertisement manufacturer payload. */
export function parseScannerMacFromMfr(raw: number[]): string | null {
  if (raw.length < 8) return null;
  if (raw[0] !== SCANNER_MFR_MAGIC_0 || raw[1] !== SCANNER_MFR_MAGIC_1) return null;
  return formatMacBytes(raw.slice(2, 8));
}

export function normalizeScannerMacInput(input: string): string | null {
  const trimmed = input.trim().replace(/-/g, ':');
  if (/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }
  const hex = trimmed.replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) return null;
  const parts: string[] = [];
  for (let i = 0; i < 12; i += 2) {
    parts.push(hex.slice(i, i + 2).toUpperCase());
  }
  return parts.join(':');
}

export type ScannerDiscoveryHandler = (scanner: DiscoveredScanner) => void;

/**
 * Bounded BLE scan for unpaired IllumaScanner boards.
 * Uses a dedicated BleManager so it does not interfere with phoneBleScan listeners.
 */
export function scanForScanners(
  durationMs: number,
  onFound: ScannerDiscoveryHandler,
): { stop: () => void; done: Promise<void> } {
  const manager = new BleManager();
  const seen = new Set<string>();
  let stopped = false;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    manager.stopDeviceScan().catch(() => {});
    manager.destroy();
  };

  const done = new Promise<void>((resolve) => {
    manager.startDeviceScan(null, { allowDuplicates: true }, (error, device: Device | null) => {
      if (stopped) return;
      if (error) {
        console.warn('[ScannerDiscovery] Scan error:', error);
        return;
      }
      if (!device) return;

      const name = device.localName ?? device.name ?? '';
      const raw = decodeManufacturerData(device.manufacturerData);
      let mac = parseScannerMacFromMfr(raw);

      // Name-only fallback if manufacturer data is wrapped differently on some stacks.
      if (!mac && name === SCANNER_UNPAIRED_NAME && raw.length >= 6) {
        mac = formatMacBytes(raw.slice(0, 6));
      }

      if (!mac && name !== SCANNER_UNPAIRED_NAME) return;
      if (!mac) return;
      if (seen.has(mac)) return;
      seen.add(mac);

      onFound({
        mac,
        rssi: device.rssi ?? -999,
        name: name || SCANNER_UNPAIRED_NAME,
      });
    });

    setTimeout(() => {
      stop();
      resolve();
    }, durationMs);
  });

  return { stop, done };
}
