import { BleManager, Device } from 'react-native-ble-plx';
import base64 from 'base64-js';
import { disneyPayload } from './e9Parser';

// Mirrors StrollerController.ino WAND_CAST_SIG / WAND_CAST_LEN exactly
const WAND_CAST_SIG = [0xCF, 0x0B, 0x00, 0xC4, 0x20, 0x22];
const WAND_CAST_LEN = 13;

function isWandCast(p: number[]): boolean {
  if (p.length !== WAND_CAST_LEN) return false;
  for (let i = 0; i < 6; i++) if (p[i] !== WAND_CAST_SIG[i]) return false;
  return true;
}

function isLegacyCf9bCast(p: number[]): boolean {
  return p.length >= 8 && p[0] === 0xCF && p[1] === 0x9B;
}

function isWandIdleBeacon(p: number[]): boolean {
  return p.length >= 4 && p[0] === 0x0F && p[1] === 0x11;
}

/** Mirrors StrollerController.ino isDisneyMfr() exactly */
export function isDisneyMfr(raw: number[]): boolean {
  if (raw.length >= 2 && raw[0] === 0x83 && raw[1] === 0x01) return true;
  const p = disneyPayload(raw);
  if (isWandCast(p) || isLegacyCf9bCast(p) || isWandIdleBeacon(p)) return true;
  return p.length >= 1 && (p[0] === 0xCC || p[0] === 0xE1 || p[0] === 0xE2 || p[0] === 0xE9);
}

/** Mirrors StrollerController.ino classifyScanPacket() exactly */
export function classifyScanPacket(raw: number[]): string {
  const p = disneyPayload(raw);
  if (isWandCast(p)) return 'WAND-CAST';
  if (isLegacyCf9bCast(p)) return 'WAND-CF9B';
  if (isWandIdleBeacon(p)) return 'WAND-IDLE';
  if (p.length >= 2 && p[0] === 0xCC && p[1] === 0x03) return 'PING';
  if (p.length >= 5 && (p[0] === 0xE1 || p[0] === 0xE2) && p[2] === 0xE9) return 'MB+';
  if (p.length >= 2 && p[0] === 0xE9) return 'SHOW';
  return 'DISNEY';
}

/** react-native-ble-plx exposes manufacturerData as base64; decode to bytes */
function decodeManufacturerData(b64: string | null): number[] {
  if (!b64) return [];
  return Array.from(base64.toByteArray(b64));
}

export type PhoneScanPacketHandler = (pkt: {
  tag: string;
  rssi: number;
  hex: string;
  len: number;
  /** BLE device address (Android) / session-scoped UUID (iOS) */
  deviceId: string;
}) => void;

let scanManager: BleManager | null = null;
let scanActive = false;
let lastPacketAt: number | null = null;
const listeners = new Set<PhoneScanPacketHandler>();

/**
 * Starts a phone-native passive scan for Disney BLE manufacturer data.
 * Independent of any IllumaBuggy board connection — raw OS-level BLE scan.
 * Returns an unsubscribe function — call it to stop receiving packets without
 * stopping other listeners' scans.
 */
export function startPhoneBleScan(onPacket: PhoneScanPacketHandler): () => void {
  listeners.add(onPacket);

  if (!scanActive) {
    if (!scanManager) scanManager = new BleManager();
    scanActive = true;
    lastPacketAt = null;

    scanManager.startDeviceScan(null, { allowDuplicates: true }, (error, device: Device | null) => {
      if (error) {
        console.warn('[PhoneBleScan] Scan error:', error);
        scanActive = false;
        return;
      }
      if (!device?.manufacturerData) return;
      const raw = decodeManufacturerData(device.manufacturerData);
      if (raw.length === 0 || !isDisneyMfr(raw)) return;

      const tag = classifyScanPacket(raw);
      const hex = raw.map(b => b.toString(16).padStart(2, '0')).join('');
      const pkt = { tag, rssi: device.rssi ?? 0, hex, len: raw.length, deviceId: device.id };
      lastPacketAt = Date.now();
      for (const handler of listeners) handler(pkt);
    });
  }

  return () => {
    listeners.delete(onPacket);
    if (listeners.size === 0) stopPhoneBleScan();
  };
}

/** Force-stops the scan immediately regardless of remaining listeners. */
export function stopPhoneBleScan(): void {
  if (scanActive) scanManager?.stopDeviceScan();
  scanActive = false;
  listeners.clear();
}

export function isPhoneBleScanActive(): boolean {
  return scanActive;
}

export function getPhoneBleScanStatus(): { active: boolean; lastPacketAt: number | null } {
  return { active: scanActive, lastPacketAt };
}
