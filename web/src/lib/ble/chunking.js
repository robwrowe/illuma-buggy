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

export const BLE_MAX_WRITE_BYTES = 512;

export const BLE_CHUNK_INTER_MS = 25;

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
    if (best < 1) throw new Error('BLE command too large to chunk (single fragment exceeds 512 bytes)');
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
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
  }

  get supported() {
    return typeof navigator !== 'undefined' && !!navigator.bluetooth;
  }

  onConnectionChange(fn) {
    this.connListeners.add(fn);
    fn(this.connected);
    return () => this.connListeners.delete(fn);
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
    this._setConnected(false);
  }

  _onNotify(event) {
    this.notifyBuffer += new TextDecoder().decode(event.target.value);
    try {
      const msg = JSON.parse(this.notifyBuffer);
      this.notifyBuffer = '';
      if (msg?.type === 'chunk_sync_failed') {
        console.error('[BLE] chunk_sync_failed', msg);
      }
    } catch {
      if (this.notifyBuffer.length > 65536) this.notifyBuffer = '';
    }
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    else this._onDisconnect();
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
      await this.cmdChar.writeValueWithResponse(fullBytes);
      return 1;
    }
    const pieces = splitCommandForBleChunks(jsonStr);
    for (let seq = 0; seq < pieces.length; seq++) {
      const chunk = {
        type: 'ble_cmd_chunk',
        seq,
        last: seq === pieces.length - 1,
        data: pieces[seq],
      };
      const chunkBytes = new TextEncoder().encode(JSON.stringify(chunk));
      await this.cmdChar.writeValueWithResponse(chunkBytes);
      if (seq < pieces.length - 1) {
        await new Promise(r => setTimeout(r, BLE_CHUNK_INTER_MS));
      }
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
