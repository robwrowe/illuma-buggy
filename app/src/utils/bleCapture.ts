/** Disney BLE packet capture — types and decode helpers for parade/show analysis */

export interface BleCapturePacket {
  /** Board millis() when packet was received */
  boardTs: number;
  /** App wall-clock when notification arrived */
  receivedAt: number;
  tag: string;
  rssi: number;
  hex: string;
  len: number;
}

export interface BleCaptureSession {
  id: string;
  name: string;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  packets: BleCapturePacket[];
}

export type BleCaptureDuration = 0 | 300 | 900 | 1800 | 3600;

export const CAPTURE_DURATION_OPTIONS: { label: string; sec: BleCaptureDuration }[] = [
  { label: 'Manual stop', sec: 0 },
  { label: '5 min', sec: 300 },
  { label: '15 min', sec: 900 },
  { label: '30 min', sec: 1800 },
  { label: '60 min', sec: 3600 },
];

export const MAX_CAPTURE_SESSIONS = 20;
export const MAX_PACKETS_PER_SESSION = 3000;

function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) {
    out.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return out;
}

/** Payload after optional 8301 CID prefix */
function disneyPayload(bytes: number[]): number[] {
  if (bytes.length >= 2 && bytes[0] === 0x83 && bytes[1] === 0x01) return bytes.slice(2);
  return bytes;
}

/** Human-readable hint for parade analysis */
export function describeBlePacket(tag: string, hex: string): string {
  const bytes = disneyPayload(hexToBytes(hex));
  if (bytes.length === 0) return tag;

  if (bytes[0] === 0xcc && bytes[1] === 0x03) return 'CC03 wake ping';

  if (bytes.length >= 5 && (bytes[0] === 0xe1 || bytes[0] === 0xe2) && bytes[2] === 0xe9) {
    const func = (bytes[2] << 8) | bytes[3];
    const op = `E${func.toString(16).toUpperCase().padStart(4, '0')}`;
    switch (func) {
      case 0xe905:
        if (bytes.length >= 9) {
          const pal = bytes[7] & 0x1f;
          const mask = (bytes[7] >> 5) & 0x07;
          return `${op} single pal=${pal} mask=${mask}`;
        }
        return `${op} single color`;
      case 0xe906:
        if (bytes.length >= 10) {
          return `${op} dual inner=${bytes[7] & 0x1f} outer=${bytes[8] & 0x1f}`;
        }
        return `${op} dual color`;
      case 0xe908:
        return `${op} RGB`;
      case 0xe909:
        if (bytes.length >= 13) {
          const pat = (bytes[7] >> 5) & 0x07;
          return `${op} five-color pattern=${pat}`;
        }
        return `${op} five-color`;
      case 0xe90c: return `${op} show FX`;
      case 0xe90e: return `${op} flash`;
      default:
        if (func >= 0xe90f && func <= 0xe913) return `${op} animation`;
        return op;
    }
  }

  if (bytes[0] === 0xe9) {
    return `E9 show cmd 0x${bytes[1]?.toString(16).toUpperCase() ?? '??'}`;
  }

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

export function formatCaptureExport(session: BleCaptureSession): string {
  const lines = [
    `# Illuma Buggy BLE Capture`,
    `# ${session.name}`,
    `# Started: ${new Date(session.startedAt).toISOString()}`,
    `# Ended:   ${new Date(session.endedAt).toISOString()}`,
    `# Packets: ${session.packets.length}`,
    `#`,
    `# ts_ms\trssi\ttag\thint\thex`,
  ];
  for (const p of session.packets) {
    lines.push(
      `${p.boardTs}\t${p.rssi}\t${p.tag}\t${describeBlePacket(p.tag, p.hex)}\t${p.hex}`,
    );
  }
  return lines.join('\n');
}
