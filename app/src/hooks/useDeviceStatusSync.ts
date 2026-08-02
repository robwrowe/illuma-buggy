/**
 * Subscribes to BLE 'status' notifications for the life of the connection
 * and mirrors them into the store's deviceStatus. This is the missing link
 * between HomeScreen's periodic sendStatus() poll and the store — see
 * DeviceStatus in stores/store.ts and the status payload in
 * firmware/StrollerController/BleCommandHandler.cpp (type == "status").
 *
 * override values (post BLE_EFFECT merge — see spec Part A):
 *   0 NONE, 1 ZONE, 2 MANUAL, 3 SHOW_MODE, 4 BLE_EFFECT
 */
import { useEffect } from 'react';
import { bleService } from '../services/BLEService';
import { useAppStore, type DeviceStatus } from '../stores/store';

function mapStatusMessage(msg: Record<string, unknown>): DeviceStatus {
  return {
    override:          Number(msg.override ?? 0),
    killOnZone:        Boolean(msg.kill_on_zone),
    brightness:        Number(msg.brightness ?? 0),
    currentPreset:     String(msg.preset ?? ''),
    wifiConnected:     Boolean(msg.wifi),
    starlightEnabled:  Boolean(msg.sw_enabled),
    starlightTimeoutMs: Number(msg.sw_timeout_ms ?? 0),
    magicBandEnabled:  Boolean(msg.mb_enabled),
    mbTimeoutMs:       Number(msg.mb_timeout_ms ?? 0),
    rulesPaused:       Boolean(msg.rules_paused),
    showType:          msg.show_type ? String(msg.show_type) : undefined,
    showPhase:         msg.show_phase ? String(msg.show_phase) : undefined,
    boardPresetCount:  msg.preset_count != null ? Number(msg.preset_count) : undefined,
    wledSsid:          msg.wled_ssid != null ? String(msg.wled_ssid) : undefined,
    wledIp:            msg.wled_ip != null ? String(msg.wled_ip) : undefined,
    wledPort:          msg.wled_port != null ? Number(msg.wled_port) : undefined,
    mbMappingLoaded:   msg.mb_mapping_loaded != null ? Boolean(msg.mb_mapping_loaded) : undefined,
    boardRole:         msg.board_role === 'logic_board' ? 'logic_board' : 'standalone',
    scannerMac:        msg.scanner_mac != null ? String(msg.scanner_mac) : undefined,
    logicMac:          msg.logic_mac != null ? String(msg.logic_mac) : undefined,
    scannerSeen:       msg.scanner_seen != null ? Boolean(msg.scanner_seen) : undefined,
    scannerAgeMs:      msg.scanner_age_ms != null ? Number(msg.scanner_age_ms) : undefined,
  };
}

export function useDeviceStatusSync() {
  useEffect(() => {
    return bleService.onMessage((msg) => {
      if (msg.type !== 'status') return;
      const override = Number(msg.override ?? 0);
      if (override > 4) {
        console.warn(`[Status] unexpected override value ${override} (expected 0–4)`);
      }
      useAppStore.getState().setDeviceStatus(mapStatusMessage(msg));
    });
  }, []);
}
