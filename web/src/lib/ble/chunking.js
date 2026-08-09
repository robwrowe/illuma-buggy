import { buildRecallPayload } from '../utils';
import { postWledState } from '../wled/capture';

export const WLED_MAX_SEG = 16;

export const TEST_PRESET_RECALL = { effect: 'always', palette: 'always', parameters: 'always', color: 'always', segments: 'always' };

export const TEST_PRESET_MEMORY = { effect: true, palette: true, parameters: true, color: true, segments: true };

export function finalizeWledSegmentPayload(payload) {
  const segs = payload?.seg;
  if (!Array.isArray(segs) || !segs.length) return payload;
  const active = segs.filter(s => Number(s.stop ?? 0) > Number(s.start ?? 0));
  if (!active.length) return payload;
  const activeIds = new Set(active.map(s => Number(s.id ?? 0)));
  const merged = active.map(s => ({ ...s }));
  if (!activeIds.has(0)) merged.push({ id: 0, stop: 0 });
  for (let id = 1; id < WLED_MAX_SEG; id++) {
    if (!activeIds.has(id)) merged.push({ id, stop: 0 });
  }
  return { ...payload, on: true, seg: merged };
}

export function buildTestPresetPayload(preset, segmentMaps) {
  const p = { ...preset, memory: { ...TEST_PRESET_MEMORY } };
  return finalizeWledSegmentPayload(buildRecallPayload(p, TEST_PRESET_RECALL, segmentMaps));
}

export async function testPresetOnWled(ip, preset, data) {
  const host = ip.trim();
  if (!host) throw new Error('Enter a WLED IP');
  const payload = buildTestPresetPayload(preset, data.mbMapping?.segmentMaps);
  await postWledState(host, payload);
}

export const BLE_DEVICE_NAME = 'IllumaBuggy';

export const BLE_SERVICE_UUID = '12345678-1234-1234-1234-123456789abc';

export const BLE_CMD_CHAR_UUID = '12345678-1234-1234-1234-123456789abd';

export const BLE_NOTIFY_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

export const BLE_SEND_DELAY_MS = 120;

// Conservative write size: safe under a negotiated 247-byte MTU (JSON envelope
// overhead included), and far less likely to fragment into a supervision-timeout
// disconnect when Chrome leaves ATT MTU at the 23-byte default.
export const BLE_MAX_WRITE_BYTES = 180;

export const BLE_CHUNK_INTER_MS = 60;

export const BLE_CHUNK_WRITE_MAX_RETRIES = 3;

export const BLE_CHUNK_WRITE_RETRY_BASE_MS = 60;

export function isGattDisconnectedError(err) {
  const msg = String(err?.message || err || '');
  return /GATT Server is disconnected|Device is disconnected|gattserverdisconnected|reconnect first|disconnected mid-push/i.test(msg);
}

/**
 * Retry a single GATT write with exponential backoff.
 * Prefer write-without-response for bulk chunk floods: write-with-response waits for an
 * ATT ACK that is delayed until the peripheral's onWrite callback returns, and a heavy
 * JSON parse there (plus WiFi coexistence) commonly ends with the central dropping the
 * link — which then surfaces as "GATT Server is disconnected" on the next write.
 * Disconnect errors are not retried (reconnect first).
 */
async function writeWithRetry(
  characteristic,
  bytes,
  {
    maxRetries = BLE_CHUNK_WRITE_MAX_RETRIES,
    withoutResponse = false,
  } = {},
) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (!characteristic?.service?.device?.gatt?.connected) {
        throw new Error(
          'GATT Server is disconnected. Cannot perform GATT operations. (Re)connect first with `device.gatt.connect`.',
        );
      }
      if (withoutResponse && typeof characteristic.writeValueWithoutResponse === 'function') {
        await characteristic.writeValueWithoutResponse(bytes);
      } else {
        await characteristic.writeValueWithResponse(bytes);
      }
      return;
    } catch (e) {
      lastErr = e;
      if (isGattDisconnectedError(e)) break;
      if (attempt === maxRetries) break;
      const backoff = BLE_CHUNK_WRITE_RETRY_BASE_MS * Math.pow(2, attempt);
      console.warn(
        `[BLE] chunk write failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${backoff}ms:`,
        lastErr?.message || lastErr,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

export function splitCommandForBleChunks(jsonStr) {
  const pieces = [];
  let offset = 0;
  while (offset < jsonStr.length) {
    let lo = 1;
    let hi = jsonStr.length - offset;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const data = jsonStr.slice(offset, offset + mid);
      const isLast = offset + mid >= jsonStr.length;
      const envelope = JSON.stringify({ type: 'ble_cmd_chunk', seq: pieces.length, last: isLast, data });
      if (new TextEncoder().encode(envelope).length <= BLE_MAX_WRITE_BYTES) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 1) {
      throw new Error(
        `BLE command too large to chunk (single fragment exceeds ${BLE_MAX_WRITE_BYTES} bytes)`,
      );
    }
    pieces.push(jsonStr.slice(offset, offset + best));
    offset += best;
  }
  return pieces;
}

export class WebBleBoard {
  constructor() {
    this.device = null;
    this.cmdChar = null;
    this.notifyChar = null;
    this.connected = false;
    this.notifyBuffer = '';
    this.sendRunning = false;
    this.sendQueue = [];
    this.connListeners = new Set();
    this.msgListeners = new Set();
    this._chunkFailListeners = new Set();
    this.chunkBuffer = {};
    this.chunkNextSeq = {};
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
  }

  static CHUNKED_TYPES = {
    rule_log: 'rule_log_done',
  };

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  onConnectionChange(fn) {
    this.connListeners.add(fn);
    fn(this.connected);
    return () => this.connListeners.delete(fn);
  }

  onMessage(fn) {
    this.msgListeners.add(fn);
    return () => this.msgListeners.delete(fn);
  }

  _emit(msg) {
    this.msgListeners.forEach((fn) => {
      try { fn(msg); } catch (e) { console.error('[BLE] message handler', e); }
    });
  }

  _setConnected(v) {
    this.connected = v;
    this.connListeners.forEach(fn => fn(v));
  }

  async connect() {
    if (!this.supported) {
      throw new Error('Web Bluetooth is not available. Use Chrome or Edge on desktop/Android over http://localhost or HTTPS.');
    }
    if (this.connected && this.device?.gatt?.connected) return this.device;
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: BLE_DEVICE_NAME }],
      optionalServices: [BLE_SERVICE_UUID],
    });
    device.addEventListener('gattserverdisconnected', this._onDisconnect);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    this.cmdChar = await service.getCharacteristic(BLE_CMD_CHAR_UUID);
    this.notifyChar = await service.getCharacteristic(BLE_NOTIFY_CHAR_UUID);
    this.notifyChar.addEventListener('characteristicvaluechanged', this._onNotify);
    await this.notifyChar.startNotifications();
    this.device = device;
    this._setConnected(true);
    return device;
  }

  _onDisconnect() {
    this.device = null;
    this.cmdChar = null;
    this.notifyChar = null;
    this.notifyBuffer = '';
    this.chunkBuffer = {};
    this.chunkNextSeq = {};
    this._setConnected(false);
  }

  _handleParsed(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg?.type === 'chunk_sync_failed') {
      console.error('[BLE] chunk_sync_failed', msg);
      this._chunkFailListeners.forEach((fn) => fn(msg));
      this._emit(msg);
      return;
    }
    const doneType = WebBleBoard.CHUNKED_TYPES[msg.type];
    if (doneType && typeof msg.seq === 'number' && typeof msg.data === 'string') {
      if (msg.seq === 0) {
        this.chunkBuffer[msg.type] = msg.data;
        this.chunkNextSeq[msg.type] = 1;
      } else if (this.chunkNextSeq[msg.type] === msg.seq) {
        this.chunkBuffer[msg.type] = (this.chunkBuffer[msg.type] || '') + msg.data;
        this.chunkNextSeq[msg.type] = msg.seq + 1;
      } else {
        console.warn('[BLE] chunk seq gap', msg.type, msg.seq, this.chunkNextSeq[msg.type]);
        delete this.chunkBuffer[msg.type];
        delete this.chunkNextSeq[msg.type];
        return;
      }
      if (msg.last) {
        const data = this.chunkBuffer[msg.type] || '';
        delete this.chunkBuffer[msg.type];
        delete this.chunkNextSeq[msg.type];
        this._emit({ type: doneType, data });
      }
      return;
    }
    this._emit(msg);
  }

  _onNotify(event) {
    const incoming = new TextDecoder().decode(event.target.value);
    try {
      const msg = JSON.parse(incoming);
      this.notifyBuffer = '';
      this._handleParsed(msg);
      return;
    } catch {
      /* MTU-fragmented — accumulate */
    }
    this.notifyBuffer += incoming;
    try {
      const msg = JSON.parse(this.notifyBuffer);
      this.notifyBuffer = '';
      this._handleParsed(msg);
    } catch {
      if (this.notifyBuffer.length > 131072) this.notifyBuffer = '';
    }
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this._onDisconnect();
  }

  /**
   * Pull recent rule-engine log lines from the board (RAM ring ± SD mirror).
   * @param {{ limit?: number, events?: string|string[], timeoutMs?: number }} opts
   * @returns {Promise<{ meta: object|null, lines: object[] }>}
   */
  async requestRuleLog({ limit = 50, events = null, timeoutMs = 20000 } = {}) {
    if (!this.cmdChar) throw new Error('Not connected to IllumaBuggy');
    const payload = { type: 'get_rule_log', limit };
    if (Array.isArray(events) && events.length) payload.events = events;
    else if (typeof events === 'string' && events.trim()) payload.events = events.trim();

    return new Promise((resolve, reject) => {
      let meta = null;
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        fn(arg);
      };
      const unsub = this.onMessage((msg) => {
        if (msg.type === 'rule_log_meta') meta = msg;
        if (msg.type === 'rule_log_done') {
          try {
            const lines = JSON.parse(msg.data || '[]');
            finish(resolve, { meta, lines: Array.isArray(lines) ? lines : [] });
          } catch (e) {
            finish(reject, e);
          }
        }
      });
      const timer = setTimeout(() => finish(reject, new Error('get_rule_log timed out')), timeoutMs);
      this.send(payload).catch((e) => finish(reject, e));
    });
  }

  async send(msg) {
    if (!this.cmdChar) throw new Error('Not connected to IllumaBuggy');
    return new Promise((resolve, reject) => {
      this.sendQueue.push({ msg, resolve, reject });
      this._drainSendQueue();
    });
  }

  async _writeJson(jsonStr) {
    const fullBytes = new TextEncoder().encode(jsonStr);
    if (fullBytes.length <= BLE_MAX_WRITE_BYTES) {
      await writeWithRetry(this.cmdChar, fullBytes);
      return 1;
    }
    const pieces = splitCommandForBleChunks(jsonStr);
    let syncFailed = null;
    const onFail = (msg) => { syncFailed = msg; };
    this._chunkFailListeners.add(onFail);
    try {
      for (let seq = 0; seq < pieces.length; seq++) {
        if (!this.device?.gatt?.connected || !this.cmdChar) {
          throw new Error(
            'GATT Server is disconnected mid-push (likely MTU/radio contention). Reconnect and retry the full push.',
          );
        }
        if (syncFailed) {
          const reason = syncFailed.reason
            || `expected ${syncFailed.expectedSeq}, got ${syncFailed.gotSeq}`;
          throw new Error(
            `Chunk sync failed at seq ${seq}/${pieces.length}: ${reason}`,
          );
        }
        const chunk = {
          type: 'ble_cmd_chunk',
          seq,
          last: seq === pieces.length - 1,
          data: pieces[seq],
        };
        const chunkBytes = new TextEncoder().encode(JSON.stringify(chunk));
        // Bulk fragments: WRITE_NR so the browser doesn't sit on ATT Write
        // Responses while the peripheral's onWrite is still parsing JSON.
        try {
          await writeWithRetry(this.cmdChar, chunkBytes, { withoutResponse: true });
        } catch (e) {
          if (isGattDisconnectedError(e)) {
            throw new Error(
              `GATT Server is disconnected mid-push at chunk ${seq + 1}/${pieces.length} ` +
              '(likely MTU/radio contention). Reconnect and retry the full push.',
            );
          }
          throw e;
        }
        if (seq < pieces.length - 1) {
          await new Promise(r => setTimeout(r, BLE_CHUNK_INTER_MS));
        } else {
          // Let a trailing chunk_sync_failed notify arrive before we declare success.
          await new Promise(r => setTimeout(r, BLE_CHUNK_INTER_MS));
        }
        if (syncFailed) {
          const reason = syncFailed.reason
            || `expected ${syncFailed.expectedSeq}, got ${syncFailed.gotSeq}`;
          throw new Error(
            `Chunk sync failed at seq ${seq}/${pieces.length}: ${reason}`,
          );
        }
      }
    } finally {
      this._chunkFailListeners.delete(onFail);
    }
    return pieces.length;
  }

  async _drainSendQueue() {
    if (this.sendRunning) return;
    this.sendRunning = true;
    while (this.sendQueue.length > 0) {
      if (!this.cmdChar) {
        while (this.sendQueue.length > 0) this.sendQueue.shift().reject(new Error('Disconnected'));
        break;
      }
      const { msg, resolve, reject } = this.sendQueue.shift();
      try {
        await this._writeJson(JSON.stringify(msg));
        resolve(true);
      } catch (e) {
        reject(e);
      }
      if (this.sendQueue.length > 0) {
        await new Promise(r => setTimeout(r, BLE_SEND_DELAY_MS));
      }
    }
    this.sendRunning = false;
  }
}

export const webBleBoard = new WebBleBoard();
