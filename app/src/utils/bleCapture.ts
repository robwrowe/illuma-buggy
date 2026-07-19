/** Disney BLE packet capture — types and decode helpers for parade/show analysis */

import { disneyPayload as e9DisneyPayload, hexToBytes, parseE9Packet, describeParsedE9 } from './e9Parser';

export interface BleCapturePacket {
  /** Board millis() when packet was received */
  boardTs: number;
  /** App wall-clock when notification arrived */
  receivedAt: number;
  tag: string;
  rssi: number;
  hex: string;
  len: number;
  /** unknown_anim quality from firmware */
  quality?: string;
  func?: string;
  label?: string;
  note?: string;
  /** BLE device address/UUID — only populated for phone-direct captures */
  deviceId?: string;
  /** Phone GPS at packet receive time (phone-direct captures) */
  lat?: number;
  lng?: number;
  accuracyM?: number;
  /** Wall-clock time when the attached GPS fix was refreshed. */
  gpsUpdatedAt?: number;
}

export interface BleCaptureSession {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  packets: BleCapturePacket[];
}

export type BleCaptureDurationSec = number;

export const CAPTURE_DURATION_MANUAL = 0;

/** Preset auto-stop durations (seconds). */
export const CAPTURE_DURATION_PRESETS: { label: string; sec: number }[] = [
  { label: '5 min', sec: 300 },
  { label: '10 min', sec: 600 },
  { label: '15 min', sec: 900 },
  { label: '20 min', sec: 1200 },
  { label: '30 min', sec: 1800 },
];

export function isCaptureDurationPreset(sec: number): boolean {
  return CAPTURE_DURATION_PRESETS.some((p) => p.sec === sec);
}

export const MAX_CAPTURE_SESSIONS = 20;
export const MAX_PACKETS_PER_SESSION = 3000;

function hexToBytesLocal(hex: string): number[] {
  return hexToBytes(hex);
}

/** Payload after optional 8301 CID prefix */
function disneyPayload(bytes: number[]): number[] {
  return e9DisneyPayload(bytes);
}

/** Human-readable hint for parade analysis */
export function describeBlePacket(tag: string, hex: string): string {
  const bytes = disneyPayload(hexToBytesLocal(hex));
  if (bytes.length === 0) return tag;

  const parsed = parseE9Packet(bytes);
  if (parsed) return describeParsedE9(parsed);

  if (bytes[0] === 0xcc && bytes[1] === 0x03) return 'CC03 wake ping';

  if (bytes.length >= 6 && bytes[0] === 0xcf && bytes[1] === 0x0b) {
    const pal = bytes[12] !== undefined ? bytes[12] & 0x1f : -1;
    return pal >= 0 ? `Wand cast palette ${pal}` : 'Wand cast';
  }

  if (bytes.length >= 2 && bytes[0] === 0xcf && bytes[1] === 0x9b) {
    const pal = bytes[bytes.length - 1] & 0x1f;
    return `Legacy wand CF9B palette ${pal}`;
  }

  if (bytes.length >= 2 && bytes[0] === 0x0f && bytes[1] === 0x11) return 'Wand idle beacon';

  return tag;
}

function fmtCoord(n?: number): string {
  return n != null && Number.isFinite(n) ? n.toFixed(6) : '';
}

export function formatCaptureExport(session: BleCaptureSession): string {
  const lines = [
    `# Illuma Buggy BLE Capture`,
    `# ${session.name}`,
    `# Started: ${new Date(session.startedAt).toISOString()}`,
    `# Ended:   ${new Date(session.endedAt).toISOString()}`,
    `# Packets: ${session.packets.length}`,
    `#`,
    `# ts_ms\treceived_at\tgps_updated_at\tgps_age_ms\trssi\tdevice_id\tlat\tlng\taccuracy_m\ttag\thint\tquality\tfunc\thex\tnote`,
  ];
  for (const p of session.packets) {
    const gpsAgeMs = p.gpsUpdatedAt != null
      ? Math.max(0, p.receivedAt - p.gpsUpdatedAt)
      : '';
    lines.push(
      `${p.boardTs}\t${p.receivedAt}\t${p.gpsUpdatedAt ?? ''}\t${gpsAgeMs}\t${p.rssi}\t${p.deviceId ?? ''}\t${fmtCoord(p.lat)}\t${fmtCoord(p.lng)}\t${p.accuracyM != null && Number.isFinite(p.accuracyM) ? Math.round(p.accuracyM) : ''}\t${p.tag}\t${describeBlePacket(p.tag, p.hex)}\t${p.quality ?? ''}\t${p.func ?? ''}\t${p.hex}\t${p.note ?? ''}`,
    );
  }
  return lines.join('\n');
}
