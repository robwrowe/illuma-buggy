/**
 * In-memory capture packets. The Zustand store only hears a throttled count
 * and the last 15 packets, so a flood does not re-render the app per packet.
 */

import type { BleCapturePacket } from '../utils/bleCapture';
import { enqueueCapturePackets } from './captureJournal';
import { useAppStore } from '../stores/store';

let packets: BleCapturePacket[] = [];
let ignored = 0;
let sessionId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function publish(): void {
  if (!useAppStore.getState().bleCaptureActive) return;
  useAppStore.setState({
    bleCaptureLiveCount: packets.length,
    bleCaptureIgnoredCount: ignored,
    bleCaptureBuffer: packets.slice(-15),
  });
}

export function beginCaptureBuffer(id: string): void {
  packets = [];
  ignored = 0;
  sessionId = id;
  if (timer) clearInterval(timer);
  timer = setInterval(publish, 500);
}

export function captureSessionId(): string | null {
  return sessionId;
}

export function captureBufferLength(): number {
  return packets.length;
}

export function noteIgnoredCapture(): void {
  ignored += 1;
}

export function pushCapturePacket(pkt: BleCapturePacket): void {
  packets.push(pkt);
  if (sessionId) enqueueCapturePackets(sessionId, [pkt]);
}

export function takeCapturePackets(): BleCapturePacket[] {
  return packets;
}

export function endCaptureBuffer(): void {
  if (timer) clearInterval(timer);
  timer = null;
  packets = [];
  ignored = 0;
  sessionId = null;
}
