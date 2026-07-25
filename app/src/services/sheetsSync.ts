/**
 * Opportunistic drain of the BLE-capture → Sheets outbox.
 * Never called from the packet-ingestion hot path.
 *
 * Per session: two POSTs — aggregated raw_captures + unaggregated observations.
 * Both must succeed before dequeue (raw_captures re-upsert is idempotent;
 * observations may duplicate on retry — prefer that over losing GPS/RSSI).
 */

import NetInfo from '@react-native-community/netinfo';
import { useAppStore, type SheetsUploadItem } from '../stores/store';
import type { BleCaptureSession } from '../utils/bleCapture';
import { disneyPayload, extractE9Opcode, hexToBytes } from '../utils/e9Parser';
import { generateId } from '../utils/utils';

const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_CAP_MS = 15 * 60_000;

function deriveOpcode(hex: string): string {
  const op = extractE9Opcode(disneyPayload(hexToBytes(hex)));
  if (op == null) return '';
  return op.toString(16).toUpperCase().padStart(4, '0');
}

async function postToSheets(
  endpoint: string,
  body: { sheet: string; rows: Record<string, unknown>[] },
) {
  if (body.rows.length === 0) return;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: { ok?: boolean; wrote?: string; error?: string } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    throw new Error(`Sheets write failed (${body.sheet}): ${res.status}`);
  }
  if (!data?.ok || !data.wrote) {
    throw new Error(
      data?.error
        || `Sheets write failed (${body.sheet}): response missing wrote — check doPost deployment`,
    );
  }
}

async function postSessionToSheets(session: BleCaptureSession, endpoint: string) {
  if (session.packets.length === 0) return;

  // Aggregated-by-hex worklist → raw_captures
  const byHex = new Map<string, {
    count: number;
    first: number;
    last: number;
    bestRssi: number;
  }>();
  for (const p of session.packets) {
    const hex = (p.hex || '').toLowerCase();
    if (!hex) continue;
    const existing = byHex.get(hex);
    if (!existing) {
      byHex.set(hex, {
        count: 1,
        first: p.receivedAt,
        last: p.receivedAt,
        bestRssi: p.rssi,
      });
    } else {
      existing.count += 1;
      if (p.receivedAt < existing.first) existing.first = p.receivedAt;
      if (p.receivedAt > existing.last) existing.last = p.receivedAt;
      if (p.rssi > existing.bestRssi) existing.bestRssi = p.rssi;
    }
  }

  await postToSheets(endpoint, {
    sheet: 'raw_captures',
    rows: [...byHex.entries()].map(([hex, agg]) => ({
      hex,
      opcode: deriveOpcode(hex),
      first_seen_show: session.name,
      first_seen_ts: new Date(agg.first).toISOString(),
      last_seen_ts: new Date(agg.last).toISOString(),
      times_seen: agg.count,
      best_rssi: agg.bestRssi,
    })),
  });

  // Every packet receipt → observations (no dedup)
  await postToSheets(endpoint, {
    sheet: 'observations',
    rows: session.packets.map((p) => ({
      observation_id: generateId(),
      session_id: session.id,
      session_name: session.name,
      hex: p.hex,
      opcode: deriveOpcode(p.hex),
      tag: p.tag,
      board_ts: p.boardTs,
      received_at: p.receivedAt,
      rssi: p.rssi,
      len: p.len,
      quality: p.quality ?? '',
      func: p.func ?? '',
      label: p.label ?? '',
      note: p.note ?? '',
      device_id: p.deviceId ?? '',
      lat: p.lat ?? '',
      lng: p.lng ?? '',
      accuracy_m: p.accuracyM ?? '',
      gps_updated_at: p.gpsUpdatedAt ?? '',
    })),
  });
}

function bumpAttempt(sessionId: string, lastError: string) {
  useAppStore.setState((s) => ({
    sheetsUploadQueue: s.sheetsUploadQueue.map((item: SheetsUploadItem) =>
      item.sessionId === sessionId
        ? {
          ...item,
          attempts: item.attempts + 1,
          lastAttemptAt: Date.now(),
          lastError,
        }
        : item,
    ),
  }));
  void useAppStore.getState().saveToStorage();
}

export async function drainSheetsQueue() {
  const s = useAppStore.getState();
  if (s.sheetsUploadInFlight) return;
  if (!s.sheetsEndpoint) return;
  const net = await NetInfo.fetch();
  if (!net.isConnected) return;
  const queue = s.sheetsUploadQueue;
  if (queue.length === 0) return;

  useAppStore.setState({ sheetsUploadInFlight: true });
  try {
    for (const item of queue) {
      const dueAt = item.lastAttemptAt
        ? item.lastAttemptAt + Math.min(BACKOFF_BASE_MS * 2 ** item.attempts, BACKOFF_CAP_MS)
        : 0;
      if (Date.now() < dueAt) continue;
      if (item.attempts >= MAX_ATTEMPTS) continue;

      const session = useAppStore.getState().bleCaptureSessions.find((x) => x.id === item.sessionId);
      if (!session) {
        useAppStore.getState().dequeueSheetsUpload(item.sessionId);
        continue;
      }

      try {
        await postSessionToSheets(session, useAppStore.getState().sheetsEndpoint);
        useAppStore.getState().dequeueSheetsUpload(item.sessionId);
      } catch (err) {
        bumpAttempt(item.sessionId, String(err));
      }
    }
  } finally {
    useAppStore.setState({ sheetsUploadInFlight: false });
  }
}

/** Reset attempts so drain will retry immediately. */
export function retrySheetsUploadNow(sessionId: string) {
  useAppStore.setState((s) => ({
    sheetsUploadQueue: s.sheetsUploadQueue.map((item) =>
      item.sessionId === sessionId
        ? { ...item, attempts: 0, lastAttemptAt: null, lastError: null }
        : item,
    ),
  }));
  void useAppStore.getState().saveToStorage();
  void drainSheetsQueue();
}
