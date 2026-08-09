import { BLE_SEND_DELAY_MS, isGattDisconnectedError, webBleBoard } from './ble/chunking';
import { compactMbPayloadForBle, normalizeMbMapping, normalizePreset } from './ble/mbMapping';
import { DEFAULT_DATA, normalizeColorCalibration } from './utils';

export const BOARD_SYNC_LS_KEY = 'illuma-buggy-board-sync';

export const DEFAULT_BOARD_SYNC_OPTIONS = {
  presets: true,
  mbMapping: true,
  colorCalibration: true,
  effectTransition: true,
  overrideMode: true,
  showMode: true,
  mbRuleConfig: true,
};

export function loadBoardSyncOptions() {
  try {
    const stored = localStorage.getItem(BOARD_SYNC_LS_KEY);
    return stored ? { ...DEFAULT_BOARD_SYNC_OPTIONS, ...JSON.parse(stored) } : { ...DEFAULT_BOARD_SYNC_OPTIONS };
  } catch {
    return { ...DEFAULT_BOARD_SYNC_OPTIONS };
  }
}

export function saveBoardSyncOptions(options) {
  try { localStorage.setItem(BOARD_SYNC_LS_KEY, JSON.stringify(options)); } catch { }
}

export async function syncProfileToBoard(data, onProgress, options = DEFAULT_BOARD_SYNC_OPTIONS) {
  const opts = { ...DEFAULT_BOARD_SYNC_OPTIONS, ...options };
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const presets = data.presets || [];
  const mb = normalizeMbMapping(data.mbMapping);
  const sent = [];

  if (opts.effectTransition) {
    onProgress?.('Sending effect transitions…');
    await webBleBoard.send({
      type: 'ble_effect_config',
      transition_ms: data.bleEffectTransitionMs ?? 700,
    });
    sent.push('effect transitions');
    await delay(BLE_SEND_DELAY_MS);
  }

  if (opts.mbMapping) {
    onProgress?.('Sending BLE Data rules…');
    try {
      await webBleBoard.send({
        type: 'set_mb_rules',
        mapping: compactMbPayloadForBle(mb),
      });
    } catch (e) {
      const detail = e?.message || String(e);
      if (isGattDisconnectedError(e)) {
        throw new Error(
          'BLE Data rules push failed: disconnected mid-push (likely MTU/radio contention). ' +
          'Reconnect, then retry the full rules push — partial resume is not supported.',
        );
      }
      throw new Error(`BLE Data rules push failed: ${detail}`);
    }
    sent.push(`BLE Data rules (${(mb.rules || []).length})`);
    await delay(BLE_SEND_DELAY_MS);
  }

  if (opts.colorCalibration) {
    onProgress?.('Sending color calibration…');
    const calibration = normalizeColorCalibration(
      data.colorCalibration || DEFAULT_DATA.colorCalibration,
    );
    await webBleBoard.send({
      type: 'set_color_calibration',
      calibration,
    });
    sent.push(calibration.enabled ? 'color calibration (on)' : 'color calibration (off)');
    await delay(BLE_SEND_DELAY_MS);
  }

  if (opts.overrideMode) {
    onProgress?.('Sending override mode…');
    await webBleBoard.send({
      type: 'override_mode',
      kill_on_zone: !!data.overrideKillOnZone,
    });
    sent.push('override mode');
    await delay(BLE_SEND_DELAY_MS);
  }

  if (opts.mbRuleConfig) {
    onProgress?.('Sending BLE Data rule fade-to-black preset…');
    await webBleBoard.send({
      type: 'mb_rule_config',
      ftbPresetId: data.ftbPresetId || '',
    });
    sent.push('BLE Data rule FTB');
    await delay(BLE_SEND_DELAY_MS);
  }

  if (opts.showMode) {
    onProgress?.('Sending show mode config…');
    await webBleBoard.send({
      type: 'show_mode_config',
      parade: data.showModeConfig?.parade ?? DEFAULT_DATA.showModeConfig.parade,
      fireworks: data.showModeConfig?.fireworks ?? DEFAULT_DATA.showModeConfig.fireworks,
    });
    sent.push('show mode');
    await delay(BLE_SEND_DELAY_MS);
  }

  if (opts.presets) {
    for (let i = 0; i < presets.length; i++) {
      const p = presets[i];
      onProgress?.(`Saving preset ${i + 1}/${presets.length}: ${p.name}`);
      const normalized = normalizePreset(p);
      // Send the full new-shape preset; firmware stores it whole and resolves at apply time.
      await webBleBoard.send({
        type: 'preset_save',
        ...normalized,
      });
      await delay(BLE_SEND_DELAY_MS + 30);
    }
    sent.push(`${presets.length} preset${presets.length === 1 ? '' : 's'}`);
  }

  onProgress?.(sent.length
    ? `Done — sent ${sent.join(', ')}.`
    : 'Nothing selected to send.');
}

export const BOARD_SYNC_ITEMS = [
  { key: 'presets', label: 'Presets', hint: (data) => `${(data.presets || []).length} preset${(data.presets || []).length === 1 ? '' : 's'} (ESP32 NVS, not WLED slots)` },
  { key: 'mbMapping', label: 'BLE Data rules + mapping', hint: (data) => `${(data.mbMapping?.rules || []).length} rules, colors, segments` },
  {
    key: 'colorCalibration',
    label: 'Color calibration',
    hint: (data) => {
      const cal = data.colorCalibration || DEFAULT_DATA.colorCalibration;
      return cal?.enabled ? 'Per-channel RGB curves (enabled)' : 'Per-channel RGB curves (disabled)';
    },
  },
  { key: 'effectTransition', label: 'Effect transitions', hint: (data) => `${data.bleEffectTransitionMs ?? 700} ms fade` },
  { key: 'overrideMode', label: 'Override mode', hint: (data) => data.overrideKillOnZone ? 'Kill override on zone entry' : 'Keep override in zones' },
  { key: 'mbRuleConfig', label: 'BLE Data rule FTB preset', hint: (data) => data.ftbPresetId ? `Preset ${data.ftbPresetId}` : 'Pure black (on:false fallback)' },
  { key: 'showMode', label: 'Show mode', hint: () => 'Parade + fireworks preset looks' },
];
