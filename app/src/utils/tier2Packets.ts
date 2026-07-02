/** Aggregate Tier 2 E9 packets from BLE capture sessions for Wand Lab review */

import type { BleCapturePacket, BleCaptureSession } from './bleCapture';
import { disneyPayload, hexToBytes, parseE9Packet } from './e9Parser';

export interface Tier2PacketSummary {
  opcode: string;
  signature: string;
  hex: string;
  count: number;
  lastSeen: number;
  reason: string;
}

export function summarizeTier2FromSessions(sessions: BleCaptureSession[], limit = 40): Tier2PacketSummary[] {
  const map = new Map<string, Tier2PacketSummary>();

  const consider = (pkt: BleCapturePacket) => {
    const parsed = parseE9Packet(disneyPayload(hexToBytes(pkt.hex)));
    if (!parsed || parsed.tier !== 2) return;
    const key = parsed.signature;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = Math.max(existing.lastSeen, pkt.receivedAt);
    } else {
      map.set(key, {
        opcode: parsed.opcodeHex,
        signature: parsed.signature,
        hex: pkt.hex,
        count: 1,
        lastSeen: pkt.receivedAt,
        reason: parsed.kind === 'tier2' ? parsed.reason : 'Tier 2',
      });
    }
  };

  for (const session of sessions) {
    for (const pkt of session.packets) consider(pkt);
  }

  return [...map.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .slice(0, limit);
}
