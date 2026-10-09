/**
 * Append-only capture journal. Each flush is a new chunk file so a kill
 * loses at most the unflushed batch (~25 packets or 1s).
 */

import * as FileSystem from 'expo-file-system';
import type { BleCapturePacket, BleCaptureSession } from '../utils/bleCapture';

const ROOT = `${FileSystem.documentDirectory}captures/`;

interface Meta {
  id: string;
  name: string;
  startedAt: number;
  segment: number;
  draftName: string;
  endsAt: number | null;
  finalized?: boolean;
  packetCount?: number;
  nextSeq?: number;
}

const queues = new Map<string, BleCapturePacket[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

async function ensureDir(sessionId: string): Promise<string> {
  const dir = `${ROOT}${sessionId}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir;
}

async function readMeta(sessionId: string): Promise<Meta | null> {
  try {
    const raw = await FileSystem.readAsStringAsync(`${ROOT}${sessionId}/meta.json`);
    return JSON.parse(raw) as Meta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  await ensureDir(meta.id);
  await FileSystem.writeAsStringAsync(`${ROOT}${meta.id}/meta.json`, JSON.stringify(meta));
}

export async function startCaptureJournal(meta: Meta): Promise<void> {
  await writeMeta({ ...meta, finalized: false, packetCount: 0, nextSeq: 0 });
}

async function flush(sessionId: string): Promise<void> {
  const pending = queues.get(sessionId);
  queues.set(sessionId, []);
  const timer = timers.get(sessionId);
  if (timer) clearTimeout(timer);
  timers.delete(sessionId);
  if (!pending || pending.length === 0) return;
  const meta = await readMeta(sessionId);
  if (!meta) return;
  const seq = meta.nextSeq ?? 0;
  const dir = await ensureDir(sessionId);
  const body = pending.map((p) => JSON.stringify(p)).join('\n') + '\n';
  await FileSystem.writeAsStringAsync(`${dir}part-${seq}.ndjson`, body);
  meta.nextSeq = seq + 1;
  meta.packetCount = (meta.packetCount ?? 0) + pending.length;
  await writeMeta(meta);
}

export function enqueueCapturePackets(sessionId: string, packets: BleCapturePacket[]): void {
  if (!sessionId || packets.length === 0) return;
  const q = queues.get(sessionId) ?? [];
  q.push(...packets);
  queues.set(sessionId, q);
  if (q.length >= 25) {
    void flush(sessionId);
    return;
  }
  if (!timers.has(sessionId)) {
    timers.set(sessionId, setTimeout(() => { void flush(sessionId); }, 1000));
  }
}

export async function flushCaptureSession(sessionId: string): Promise<void> {
  await flush(sessionId);
}

export async function finalizeCaptureJournal(sessionId: string): Promise<number> {
  await flush(sessionId);
  const meta = await readMeta(sessionId);
  if (!meta) return 0;
  meta.finalized = true;
  meta.endsAt = Date.now();
  await writeMeta(meta);
  return meta.packetCount ?? 0;
}

export async function loadSessionPackets(sessionId: string): Promise<BleCapturePacket[]> {
  await flush(sessionId);
  const dir = `${ROOT}${sessionId}/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) return [];
  const names = await FileSystem.readDirectoryAsync(dir);
  const parts = names.filter((n) => n.startsWith('part-') && n.endsWith('.ndjson')).sort();
  const packets: BleCapturePacket[] = [];
  for (const name of parts) {
    const text = await FileSystem.readAsStringAsync(`${dir}${name}`);
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { packets.push(JSON.parse(line) as BleCapturePacket); } catch { /* skip torn line */ }
    }
  }
  return packets;
}

export async function writeSessionPackets(session: BleCaptureSession): Promise<void> {
  await startCaptureJournal({
    id: session.id,
    name: session.name,
    startedAt: session.startedAt,
    segment: 1,
    draftName: session.name,
    endsAt: session.endedAt,
  });
  enqueueCapturePackets(session.id, session.packets);
  await finalizeCaptureJournal(session.id);
}

export async function recoverOrphanCaptures(): Promise<BleCaptureSession[]> {
  const info = await FileSystem.getInfoAsync(ROOT);
  if (!info.exists) return [];
  const dirs = await FileSystem.readDirectoryAsync(ROOT);
  const recovered: BleCaptureSession[] = [];
  for (const id of dirs) {
    const meta = await readMeta(id);
    if (!meta || meta.finalized) continue;
    await flush(id);
    const packets = await loadSessionPackets(id);
    const endedAt = Date.now();
    const session: BleCaptureSession = {
      id: meta.id,
      name: `${meta.name || meta.draftName || 'Capture'} (recovered)`,
      startedAt: meta.startedAt,
      endedAt,
      durationSec: Math.max(0, Math.round((endedAt - meta.startedAt) / 1000)),
      packets,
      packetCount: packets.length,
    };
    meta.finalized = true;
    meta.name = session.name;
    meta.packetCount = packets.length;
    await writeMeta(meta);
    recovered.push(session);
  }
  return recovered;
}

export async function appendCrashLog(line: string): Promise<void> {
  const path = `${FileSystem.documentDirectory}capture-crash.log`;
  let prev = '';
  try { prev = await FileSystem.readAsStringAsync(path); } catch { /* new file */ }
  const next = (prev + line + '\n').split('\n').slice(-40).join('\n');
  await FileSystem.writeAsStringAsync(path, next);
}
