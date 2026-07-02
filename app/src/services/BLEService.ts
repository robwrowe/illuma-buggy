/**
 * BLEService.ts
 * Core BLE layer for IllumaBuggy companion app.
 */

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import base64 from 'base64-js';
import { BLE_MAX_WRITE_BYTES, BLE_CHUNK_INTER_MS, splitCommandForBleChunks } from '../utils/bleChunking';
import { clearBoardPresetSyncCache } from '../utils/blePresetCache';
import type { MbSegmentLayout } from '../utils/configMigration';

export const BLE_DEVICE_NAME  = 'IllumaBuggy';
export const SERVICE_UUID     = '12345678-1234-1234-1234-123456789abc';
export const CMD_CHAR_UUID    = '12345678-1234-1234-1234-123456789abd';
export const NOTIFY_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

const GATT_BUSY_ERROR_CODE = 4; // BleErrorCode.OperationStartFailed

function isGattBusy(e: unknown): boolean {
  const code = (e as { errorCode?: number })?.errorCode;
  if (code === GATT_BUSY_ERROR_CODE) return true;
  const errMsg = String((e as Error)?.message ?? e);
  return /rejected|busy|133|gatt/i.test(errMsg);
}

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';
export type BLEMessage       = Record<string, unknown>;
export type MessageHandler   = (msg: BLEMessage) => void;
export type StateHandler     = (state: ConnectionState) => void;
export type SessionReadyHandler = () => void;

function strToBase64(str: string): string {
  return base64.fromByteArray(new TextEncoder().encode(str));
}
function base64ToStr(b64: string): string {
  return new TextDecoder().decode(base64.toByteArray(b64));
}

class BLEService {
  private manager:        BleManager | null   = null;
  private device:         Device | null       = null;
  private connState:      ConnectionState     = 'disconnected';
  private msgHandlers:    Set<MessageHandler> = new Set();
  private stateHandlers:  Set<StateHandler>   = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private notifyBuffer    = '';
  private chunkBuffer:    Record<string, string> = {};
  private sendQueue:      { msg: BLEMessage; resolve: (ok: boolean) => void }[] = [];
  private sendRunning     = false;
  private handlingDisconnect = false;
  private sessionReady    = false;
  private readyHandlers:  Set<SessionReadyHandler> = new Set();

  private static readonly CHUNKED_TYPES: Record<string, string> = {
    'preset_chunk':  'preset_list_raw',
    'wled_effects':  'wled_effects_done',
    'wled_palettes': 'wled_palettes_done',
    'wled_fxdata':   'wled_fxdata_done',
    'wled_state':    'wled_state_done',
  };

  private getManager(): BleManager {
    if (!this.manager) this.manager = new BleManager();
    return this.manager;
  }

  onMessage(handler: MessageHandler): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }
  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }
  getConnectionState(): ConnectionState { return this.connState; }
  isConnected(): boolean { return this.connState === 'connected'; }
  isSessionReady(): boolean { return this.connState === 'connected' && this.sessionReady; }

  onSessionReady(handler: SessionReadyHandler): () => void {
    this.readyHandlers.add(handler);
    if (this.isSessionReady()) handler();
    return () => this.readyHandlers.delete(handler);
  }

  markSessionReady(ready: boolean) {
    this.sessionReady = ready;
    if (ready) this.readyHandlers.forEach(h => h());
  }

  async connect(): Promise<void> {
    console.log('[BLE] connect() called');
    this.shouldReconnect = true;
    try {
      await this.requestPermissions();
      await this.waitForBLEReady();
      this.scan();
    } catch (e) {
      console.error('[BLE] connect() error:', e);
      this.setConnState('error');
      this.scheduleReconnect();
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.device) {
      try { await this.device.cancelConnection(); } catch {}
      this.device = null;
    }
    this.setConnState('disconnected');
  }

  async send(msg: BLEMessage): Promise<boolean> {
    if (!this.device || this.connState !== 'connected') {
      console.warn('[BLE] Not connected, cannot send');
      return false;
    }
    return new Promise((resolve) => {
      this.sendQueue.push({ msg, resolve });
      this.drainSendQueue();
    });
  }

  private async drainSendQueue() {
    if (this.sendRunning) return;
    this.sendRunning = true;
    while (this.sendQueue.length > 0) {
      if (!this.device || this.connState !== 'connected') {
        while (this.sendQueue.length > 0) this.sendQueue.shift()!.resolve(false);
        break;
      }
      const { msg, resolve } = this.sendQueue.shift()!;
      resolve(await this.sendImmediate(msg));
      if (this.sendQueue.length > 0) {
        await new Promise(r => setTimeout(r, 350));
      }
    }
    this.sendRunning = false;
  }

  private async sendImmediate(msg: BLEMessage, attempt = 0): Promise<boolean> {
    if (!this.device || this.connState !== 'connected') return false;
    try {
      await this.sendJsonCommand(msg);
      return true;
    } catch (e) {
      if (attempt < 5 && isGattBusy(e)) {
        await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
        return this.sendImmediate(msg, attempt + 1);
      }
      console.error('[BLE] Send error:', e);
      return false;
    }
  }

  private async sendJsonCommand(msg: BLEMessage): Promise<void> {
    if (!this.device) throw new Error('Not connected');
    const jsonStr = JSON.stringify(msg);
    const byteLen = new TextEncoder().encode(jsonStr).length;
    if (byteLen <= BLE_MAX_WRITE_BYTES) {
      await this.writeCmd(this.device, strToBase64(jsonStr));
      return;
    }
    const pieces = splitCommandForBleChunks(jsonStr);
    for (let seq = 0; seq < pieces.length; seq++) {
      const chunk: BLEMessage = {
        type: 'ble_cmd_chunk',
        seq,
        last: seq === pieces.length - 1,
        data: pieces[seq],
      };
      await this.writeCmd(this.device, strToBase64(JSON.stringify(chunk)));
      if (seq < pieces.length - 1) {
        await new Promise(r => setTimeout(r, BLE_CHUNK_INTER_MS));
      }
    }
  }

  /** Try with-response first; fall back to WRITE_NR if the stack rejects the queued op. */
  private async writeCmd(device: Device, b64: string): Promise<void> {
    try {
      await device.writeCharacteristicWithResponseForService(SERVICE_UUID, CMD_CHAR_UUID, b64);
      return;
    } catch (e) {
      if (!isGattBusy(e)) {
        try {
          await device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CMD_CHAR_UUID, b64);
          return;
        } catch (inner) {
          throw inner;
        }
      }
      throw e;
    }
  }

  /** Block until Android finishes CCCD enable and accepts a CMD write. */
  private async waitForGattReady(device: Device): Promise<boolean> {
    const probe = strToBase64(JSON.stringify({ type: 'status' }));
    // CCCD enable from monitorCharacteristicForService is async on Android.
    await new Promise(r => setTimeout(r, 600));
    for (let i = 0; i < 30; i++) {
      try {
        await device.writeCharacteristicWithoutResponseForService(SERVICE_UUID, CMD_CHAR_UUID, probe);
        console.log('[BLE] GATT ready');
        return true;
      } catch (e) {
        if (!isGattBusy(e)) {
          try {
            await device.writeCharacteristicWithResponseForService(SERVICE_UUID, CMD_CHAR_UUID, probe);
            console.log('[BLE] GATT ready (with response)');
            return true;
          } catch (inner) {
            console.warn('[BLE] GATT probe failed:', (inner as Error)?.message ?? inner);
            return false;
          }
        }
        await new Promise(r => setTimeout(r, 200));
      }
    }
    console.warn('[BLE] GATT not ready after probe timeout');
    return false;
  }

  sendPresetApply(id: string)                             { return this.send({ type: 'preset_apply', id }); }
  sendPresetSave(id: string, name: string, wled: object) { return this.send({ type: 'preset_save', id, name, wled }); }
  sendPresetDelete(id: string)                            { return this.send({ type: 'preset_delete', id }); }
  sendPresetList()                                        { return this.send({ type: 'preset_list' }); }
  sendZoneTrigger(presetId: string)                       { return this.send({ type: 'zone_trigger', preset_id: presetId }); }
  sendOverrideClear()                                     { return this.send({ type: 'override_clear' }); }
  sendFadeToBlack(presetId?: string, fadeMs = 800) {
    const msg: BLEMessage = { type: 'fade_to_black', fade_ms: fadeMs };
    if (presetId) msg.preset_id = presetId;
    return this.send(msg);
  }
  sendOverrideMode(killOnZone: boolean)                   { return this.send({ type: 'override_mode', kill_on_zone: killOnZone }); }
  sendBrightness(value: number)                           { return this.send({ type: 'brightness', value }); }
  sendWledRaw(wled: object, presetId?: string) {
    const msg: BLEMessage = { type: 'wled_raw', wled };
    if (presetId) msg.preset_id = presetId;
    return this.send(msg);
  }
  sendStatus()                                            { return this.send({ type: 'status' }); }
  sendGetEffects()                                        { return this.send({ type: 'wled_get_effects' }); }
  sendGetPalettes()                                       { return this.send({ type: 'wled_get_palettes' }); }
  sendGetFxData()                                         { return this.send({ type: 'wled_get_fxdata' }); }
  sendGetState()                                          { return this.send({ type: 'wled_get_state' }); }
  sendBleEffectConfig(transitionMs: number) {
    return this.send({ type: 'ble_effect_config', transition_ms: transitionMs });
  }
  sendMbConfig(enabled: boolean, fivePoint: boolean, timeoutMs?: number, deferToApp?: boolean) {
    const msg: BLEMessage = { type: 'mb_config', enabled, five_point: fivePoint };
    if (timeoutMs !== undefined) msg.timeout_ms = timeoutMs;
    if (deferToApp !== undefined) msg.defer_to_app = deferToApp;
    return this.send(msg);
  }
  sendSwConfig(enabled: boolean, timeoutMs?: number) {
    const msg: BLEMessage = { type: 'sw_config', enabled };
    if (timeoutMs !== undefined) msg.timeout_ms = timeoutMs;
    return this.send(msg);
  }
  sendMbMappingConfig(payload: object) {
    return this.send({ type: 'mb_mapping_config', mapping: payload });
  }
  sendMbLayoutSet(layouts: MbSegmentLayout[], activeIndex: number) {
    return this.send({
      type: 'mb_layout_set',
      layouts: layouts.map(l => ({ name: l.name, segments: l.segments })),
      active: activeIndex,
    });
  }
  sendMbLayoutSwitch(index: number) {
    return this.send({ type: 'mb_layout_switch', index });
  }
  sendShowModeConfig(config: { parade: { pre: string; live: string }; fireworks: { pre: string; live: string; post: string } }) {
    return this.send({ type: 'show_mode_config', ...config });
  }
  sendShowModeEnter(show: 'parade' | 'fireworks', phase: 'pre' | 'black' | 'live' | 'post') {
    return this.send({ type: 'show_mode_enter', show, phase });
  }
  sendShowModeExit() {
    return this.send({ type: 'show_mode_exit' });
  }
  sendBleCaptureConfig(active: boolean, durationMs = 0, label = '') {
    const msg: BLEMessage = { type: 'ble_capture_config', active };
    if (active && durationMs > 0) msg.duration_ms = durationMs;
    if (active && label) msg.label = label;
    return this.send(msg);
  }

  private async requestPermissions(): Promise<void> {
    if (Platform.OS !== 'android') return;
    const apiLevel = Platform.Version as number;
    if (apiLevel >= 31) {
      await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
    } else {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    }
  }

  private waitForBLEReady(): Promise<void> {
    return new Promise((resolve) => {
      const sub = this.getManager().onStateChange((state) => {
        if (state === State.PoweredOn) { sub.remove(); resolve(); }
      }, true);
    });
  }

  private scan() {
    this.setConnState('scanning');
    console.log('[BLE] Scanning for', BLE_DEVICE_NAME);
    this.getManager().startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
      if (err) {
        console.error('[BLE] Scan error:', err);
        this.setConnState('error');
        this.scheduleReconnect();
        return;
      }
      if (device?.name === BLE_DEVICE_NAME) {
        this.getManager().stopDeviceScan();
        this.connectToDevice(device);
      }
    });
  }

  private async connectToDevice(device: Device) {
    this.setConnState('connecting');
    console.log('[BLE] Connecting to', device.id);
    try {
      const connected = await device.connect({ autoConnect: false });
      await new Promise(r => setTimeout(r, 300));

      const discovered = await connected.discoverAllServicesAndCharacteristics();

      try { await discovered.requestMTU(247); console.log('[BLE] MTU negotiated'); }
      catch (e) { console.warn('[BLE] MTU skipped:', (e as any)?.message); }

      discovered.onDisconnected(() => {
        console.log('[BLE] Disconnected');
        this.handleDisconnect();
      });

      discovered.monitorCharacteristicForService(SERVICE_UUID, NOTIFY_CHAR_UUID, (err, char) => {
        if (err) {
          if ((err as any)?.errorCode === 205) return;
          const code = (err as { errorCode?: number })?.errorCode;
          // 201 = device disconnected — onDisconnected will run; avoid double teardown.
          if (code === 201) return;
          console.error('[BLE] Notify error:', err);
          return;
        }
        if (char?.value) this.handleNotification(char.value);
      });

      // Brief pause so the notify subscription can finish enabling CCCD.
      await new Promise(r => setTimeout(r, 300));

      const ready = await this.waitForGattReady(discovered);
      if (!ready) throw new Error('GATT not ready');

      this.device = discovered;
      this.markSessionReady(false);
      this.setConnState('connected');
      console.log('[BLE] Connected');
    } catch (e) {
      console.error('[BLE] Connection failed:', e);
      this.setConnState('error');
      this.scheduleReconnect();
    }
  }

  private handleDisconnect() {
    if (this.handlingDisconnect) return;
    this.handlingDisconnect = true;
    this.markSessionReady(false);
    clearBoardPresetSyncCache();
    this.device = null;
    this.notifyBuffer = '';
    this.chunkBuffer = {};
    while (this.sendQueue.length > 0) this.sendQueue.shift()!.resolve(false);
    this.sendRunning = false;
    this.setConnState('disconnected');
    if (this.shouldReconnect) this.scheduleReconnect();
    this.handlingDisconnect = false;
  }

  private scheduleReconnect(delayMs = 3000) {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => { if (this.shouldReconnect) this.scan(); }, delayMs);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  }

  private handleNotification(b64Value: string) {
    try {
      const incoming = base64ToStr(b64Value);

      // Always append to buffer first, then try to parse the combined result.
      // This handles both:
      //   1. MTU-fragmented messages (chunk spans multiple BLE packets)
      //   2. Complete single-packet messages (buffer was empty, combined = incoming)
      this.notifyBuffer += incoming;

      try {
        const msg = JSON.parse(this.notifyBuffer) as BLEMessage;
        this.notifyBuffer = '';
        this.dispatchMessage(msg);
      } catch {
        // Not complete yet — keep accumulating
        if (this.notifyBuffer.length > 65536) {
          console.warn('[BLE] Buffer overflow, resetting');
          this.notifyBuffer = '';
        }
      }
    } catch (e) {
      console.error('[BLE] Notification decode error:', e);
      this.notifyBuffer = '';
    }
  }

  private dispatchMessage(msg: BLEMessage) {
    const finalType = BLEService.CHUNKED_TYPES[msg.type as string];
    if (finalType) {
      const t       = msg.type as string;
      const dataStr = (msg.data as string) ?? '';
      this.chunkBuffer[t] = (this.chunkBuffer[t] ?? '') + dataStr;
      console.log(`[BLE] Chunk ${t} seq=${msg.seq} last=${msg.last} bufLen=${this.chunkBuffer[t].length}`);
      if (msg.last) {
        const raw = this.chunkBuffer[t];
        delete this.chunkBuffer[t];
        if (!raw || raw.length === 0) {
          console.warn(`[BLE] Empty assembled ${t}, skipping`);
          return;
        }
        console.log(`[BLE] Assembled ${t}: ${raw.length} bytes`);
        this.emit({ type: finalType, raw });
      }
      return;
    }
    this.emit(msg);
  }

  private emit(msg: BLEMessage) {
    this.msgHandlers.forEach(h => h(msg));
  }

  private setConnState(state: ConnectionState) {
    this.connState = state;
    this.stateHandlers.forEach(h => h(state));
  }

  destroy() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.manager?.destroy();
  }
}

export const bleService = new BLEService();
