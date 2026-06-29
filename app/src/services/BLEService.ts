/**
 * BLEService.ts
 * Core BLE layer for IllumaBuggy companion app.
 */

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import base64 from 'base64-js';

export const BLE_DEVICE_NAME  = 'IllumaBuggy';
export const SERVICE_UUID     = '12345678-1234-1234-1234-123456789abc';
export const CMD_CHAR_UUID    = '12345678-1234-1234-1234-123456789abd';
export const NOTIFY_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

export type ConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected' | 'error';
export type BLEMessage       = Record<string, unknown>;
export type MessageHandler   = (msg: BLEMessage) => void;
export type StateHandler     = (state: ConnectionState) => void;

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
    try {
      const b64 = strToBase64(JSON.stringify(msg));
      await this.device.writeCharacteristicWithResponseForService(SERVICE_UUID, CMD_CHAR_UUID, b64);
      return true;
    } catch (e) {
      console.error('[BLE] Send error:', e);
      return false;
    }
  }

  sendPresetApply(id: string)                             { return this.send({ type: 'preset_apply', id }); }
  sendPresetSave(id: string, name: string, wled: object) { return this.send({ type: 'preset_save', id, name, wled }); }
  sendPresetDelete(id: string)                            { return this.send({ type: 'preset_delete', id }); }
  sendPresetList()                                        { return this.send({ type: 'preset_list' }); }
  sendZoneTrigger(presetId: string)                       { return this.send({ type: 'zone_trigger', preset_id: presetId }); }
  sendOverrideClear()                                     { return this.send({ type: 'override_clear' }); }
  sendOverrideMode(killOnZone: boolean)                   { return this.send({ type: 'override_mode', kill_on_zone: killOnZone }); }
  sendBrightness(value: number)                           { return this.send({ type: 'brightness', value }); }
  sendWledRaw(wled: object)                               { return this.send({ type: 'wled_raw', wled }); }
  sendStatus()                                            { return this.send({ type: 'status' }); }
  sendGetEffects()                                        { return this.send({ type: 'wled_get_effects' }); }
  sendGetPalettes()                                       { return this.send({ type: 'wled_get_palettes' }); }
  sendGetFxData()                                         { return this.send({ type: 'wled_get_fxdata' }); }
  sendGetState()                                          { return this.send({ type: 'wled_get_state' }); }
  sendMbConfig(enabled: boolean, fivePoint: boolean, timeoutMs?: number) {
    const msg: BLEMessage = { type: 'mb_config', enabled, five_point: fivePoint };
    if (timeoutMs !== undefined) msg.timeout_ms = timeoutMs;
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
      await new Promise(r => setTimeout(r, 500));
      try { await connected.requestMTU(247); console.log('[BLE] MTU negotiated'); }
      catch (e) { console.warn('[BLE] MTU skipped:', (e as any)?.message); }

      const discovered = await connected.discoverAllServicesAndCharacteristics();
      this.device = discovered;
      this.setConnState('connected');
      console.log('[BLE] Connected');

      discovered.monitorCharacteristicForService(SERVICE_UUID, NOTIFY_CHAR_UUID, (err, char) => {
        if (err) {
          if ((err as any)?.errorCode === 205) return;
          console.error('[BLE] Notify error:', err);
          this.handleDisconnect();
          return;
        }
        if (char?.value) this.handleNotification(char.value);
      });

      discovered.onDisconnected(() => {
        console.log('[BLE] Disconnected');
        this.handleDisconnect();
      });
    } catch (e) {
      console.error('[BLE] Connection failed:', e);
      this.setConnState('error');
      this.scheduleReconnect();
    }
  }

  private handleDisconnect() {
    this.device = null;
    this.notifyBuffer = '';
    this.chunkBuffer = {};
    this.setConnState('disconnected');
    if (this.shouldReconnect) this.scheduleReconnect();
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
