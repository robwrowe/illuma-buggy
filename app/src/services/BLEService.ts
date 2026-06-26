/**
 * BLEService.ts
 * Core BLE layer for IllumaBuggy companion app.
 *
 * Handles:
 *  - Scanning for and connecting to "IllumaBuggy" device
 *  - Writing JSON commands to CMD characteristic
 *  - Subscribing to NOTIFY characteristic for responses
 *  - Chunked preset list reassembly
 *  - Auto-reconnect on disconnect
 */

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import base64 from 'base64-js';

// ─────────────────────────────────────────────
// UUIDs — must match firmware exactly
// ─────────────────────────────────────────────
export const BLE_DEVICE_NAME  = 'IllumaBuggy';
export const SERVICE_UUID     = '12345678-1234-1234-1234-123456789abc';
export const CMD_CHAR_UUID    = '12345678-1234-1234-1234-123456789abd';
export const NOTIFY_CHAR_UUID = '12345678-1234-1234-1234-123456789abe';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export type ConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'error';

export type BLEMessage = Record<string, unknown>;
export type MessageHandler = (msg: BLEMessage) => void;
export type StateHandler   = (state: ConnectionState) => void;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function strToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  return base64.fromByteArray(bytes);
}

function base64ToStr(b64: string): string {
  const bytes = base64.toByteArray(b64);
  return new TextDecoder().decode(bytes);
}

// ─────────────────────────────────────────────
// BLEService class
// ─────────────────────────────────────────────

class BLEService {
  private manager:        BleManager | null = null;
  private device:         Device | null = null;
  private connState:      ConnectionState = 'disconnected';
  private msgHandlers:    Set<MessageHandler> = new Set();
  private stateHandlers:  Set<StateHandler>   = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  // Chunked preset list reassembly
  private presetChunks: unknown[] = [];

  // Lazy init — BleManager must not be instantiated at module load time
  private getManager(): BleManager {
    if (!this.manager) {
      this.manager = new BleManager();
    }
    return this.manager;
  }

  // ── Public API ──────────────────────────────

  onMessage(handler: MessageHandler): () => void {
    this.msgHandlers.add(handler);
    return () => this.msgHandlers.delete(handler);
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  getConnectionState(): ConnectionState {
    return this.connState;
  }

  isConnected(): boolean {
    return this.connState === 'connected';
  }

  async connect(): Promise<void> {
    this.shouldReconnect = true;
    await this.requestPermissions();
    await this.waitForBLEReady();
    this.scan();
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.device) {
      try { await this.device.cancelConnection(); } catch {}
      this.device = null;
    }
    this.setState('disconnected');
  }

  async send(msg: BLEMessage): Promise<boolean> {
    if (!this.device || this.connState !== 'connected') {
      console.warn('[BLE] Not connected, cannot send');
      return false;
    }
    try {
      const json = JSON.stringify(msg);
      const b64  = strToBase64(json);
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID, CMD_CHAR_UUID, b64
      );
      return true;
    } catch (e) {
      console.error('[BLE] Send error:', e);
      return false;
    }
  }

  // Convenience wrappers
  sendPresetApply(id: string)           { return this.send({ type: 'preset_apply', id }); }
  sendPresetSave(id: string, name: string, wled: object) {
    return this.send({ type: 'preset_save', id, name, wled });
  }
  sendPresetDelete(id: string)          { return this.send({ type: 'preset_delete', id }); }
  sendPresetList()                      { return this.send({ type: 'preset_list' }); }
  sendZoneTrigger(presetId: string)     { return this.send({ type: 'zone_trigger', preset_id: presetId }); }
  sendOverrideClear()                   { return this.send({ type: 'override_clear' }); }
  sendOverrideMode(killOnZone: boolean) { return this.send({ type: 'override_mode', kill_on_zone: killOnZone }); }
  sendBrightness(value: number)         { return this.send({ type: 'brightness', value }); }
  sendWledRaw(wled: object)             { return this.send({ type: 'wled_raw', wled }); }
  sendStatus()                          { return this.send({ type: 'status' }); }

  // ── Permissions ─────────────────────────────

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
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
    }
  }

  private waitForBLEReady(): Promise<void> {
    return new Promise((resolve) => {
      const sub = this.getManager().onStateChange((state) => {
        if (state === State.PoweredOn) {
          sub.remove();
          resolve();
        }
      }, true);
    });
  }

  // ── Scan ────────────────────────────────────

  private scan() {
    this.setState('scanning');
    console.log('[BLE] Scanning for', BLE_DEVICE_NAME);

    this.getManager().startDeviceScan(null, { allowDuplicates: false }, (err, device) => {
      if (err) {
        console.error('[BLE] Scan error:', err);
        this.setState('error');
        this.scheduleReconnect();
        return;
      }
      if (device?.name === BLE_DEVICE_NAME) {
        this.getManager().stopDeviceScan();
        this.connectToDevice(device);
      }
    });
  }

  // ── Connect ──────────────────────────────────

  private async connectToDevice(device: Device) {
    this.setState('connecting');
    console.log('[BLE] Connecting to', device.id);

    try {
      const connected  = await device.connect({ autoConnect: false });

      // Request larger MTU — wait briefly first to let connection settle
      await new Promise(r => setTimeout(r, 500));
      try {
        await connected.requestMTU(247);
        console.log('[BLE] MTU negotiated');
      } catch (mtuErr) {
        // Non-fatal — default MTU (23 bytes) will still work with buffering
        console.warn('[BLE] MTU negotiation skipped:', (mtuErr as any)?.message);
      }

      const discovered = await connected.discoverAllServicesAndCharacteristics();
      this.device = discovered;
      this.setState('connected');
      console.log('[BLE] Connected');

      // Subscribe to notify characteristic
      discovered.monitorCharacteristicForService(
        SERVICE_UUID,
        NOTIFY_CHAR_UUID,
        (err, char) => {
          if (err) {
            // Code 205 = operation cancelled on disconnect — not a real error
            if ((err as any)?.errorCode === 205) return;
            console.error('[BLE] Notify error:', err);
            this.handleDisconnect();
            return;
          }
          if (char?.value) this.handleNotification(char.value);
        }
      );

      // Watch for disconnection
      discovered.onDisconnected(() => {
        console.log('[BLE] Device disconnected');
        this.handleDisconnect();
      });

    } catch (e) {
      console.error('[BLE] Connection failed:', e);
      this.setState('error');
      this.scheduleReconnect();
    }
  }

  // ── Disconnect / Reconnect ───────────────────

  private handleDisconnect() {
    this.device = null;
    this.setState('disconnected');
    if (this.shouldReconnect) this.scheduleReconnect();
  }

  private scheduleReconnect(delayMs = 3000) {
    this.clearReconnectTimer();
    console.log(`[BLE] Reconnecting in ${delayMs}ms`);
    this.reconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) this.scan();
    }, delayMs);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Notification handling ────────────────────

  // Accumulate partial packets until we have valid JSON
  private notifyBuffer = '';

  private handleNotification(b64Value: string) {
    try {
      const chunk = base64ToStr(b64Value);
      this.notifyBuffer += chunk;

      // Try to parse — if it fails, wait for more chunks
      try {
        const msg = JSON.parse(this.notifyBuffer) as BLEMessage;
        this.notifyBuffer = '';
        this.handleMessage(msg);
      } catch {
        // Incomplete JSON — keep buffering
        // Safety valve: if buffer grows unreasonably large, reset it
        if (this.notifyBuffer.length > 4096) {
          console.warn('[BLE] Notification buffer overflow, resetting');
          this.notifyBuffer = '';
        }
      }
    } catch (e) {
      console.error('[BLE] Failed to decode notification:', e);
      this.notifyBuffer = '';
    }
  }

  private handleMessage(msg: BLEMessage) {
    // Reassemble chunked preset list
    if (msg.type === 'preset_chunk') {
      const data = msg.data as unknown[];
      this.presetChunks.push(...data);
      if (msg.last) {
        const assembled: BLEMessage = { type: 'preset_list', presets: [...this.presetChunks] };
        this.presetChunks = [];
        this.emit(assembled);
      }
      return;
    }
    this.emit(msg);
  }

  private emit(msg: BLEMessage) {
    this.msgHandlers.forEach((h) => h(msg));
  }

  // ── State ────────────────────────────────────

  private setState(state: ConnectionState) {
    this.connState = state;
    this.stateHandlers.forEach((h) => h(state));
  }

  destroy() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.getManager().destroy();
  }
}

// Singleton — one instance for the whole app
export const bleService = new BLEService();
