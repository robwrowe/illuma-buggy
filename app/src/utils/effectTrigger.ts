/**
 * Unified effect trigger + logging — foreground sends immediately; background queues for main-thread drain.
 */

import { useAppStore } from '../stores/store';
import { presetWledForBoard } from './bleBoardSync';
import { enqueuePendingBle } from './locationRuntimeBridge';

type BleMsg = Record<string, unknown>;

async function enqueueFromMsg(msg: BleMsg): Promise<void> {
  const kind = String(msg.type ?? '');
  if (kind === 'wled_raw' && msg.preset_id) {
    await enqueuePendingBle({ type: 'zone_preset', presetId: String(msg.preset_id) });
    return;
  }
  if (kind === 'brightness' && msg.value != null) {
    await enqueuePendingBle({ type: 'brightness', value: Number(msg.value) });
    return;
  }
  if (kind === 'override_clear') {
    await enqueuePendingBle({ type: 'override_clear' });
  }
}

async function sendEffectCommand(msg: BleMsg, reason: string): Promise<boolean> {
  const kind = String(msg.type ?? '?');
  const queueOnly = reason.includes('bg') || reason.includes('location-task');
  if (queueOnly) {
    await enqueueFromMsg(msg);
    console.log('[Effect] QUEUED', kind, `(${reason})`);
    return true;
  }
  const { bleService } = require('../services/BLEService') as typeof import('../services/BLEService');
  if (!bleService.isConnected()) {
    console.warn('[Effect]', kind, 'FAILED — not connected', `(${reason})`);
    await enqueueFromMsg(msg);
    return false;
  }
  const ok = await bleService.send(msg);
  console.log('[Effect]', kind, ok ? 'SENT' : 'FAILED', `(${reason})`);
  if (!ok) await enqueueFromMsg(msg);
  return ok;
}

export async function triggerZonePresetEffect(
  presetId: string,
  zoneName: string,
  reason: string,
): Promise<boolean> {
  const s = useAppStore.getState();
  const preset = s.presets.find(p => p.id === presetId);
  if (!preset) {
    console.warn('[Effect] TRIGGER zone_preset — preset missing', { presetId, zoneName, reason });
    return false;
  }
  const payload = presetWledForBoard(preset, s.customSegmentLayouts, s.recallState);
  console.log('[Effect] TRIGGER zone_preset', {
    zone: zoneName,
    preset: preset.name,
    presetId,
    reason,
    bytes: JSON.stringify(payload).length,
  });
  const msg: BleMsg = { type: 'wled_raw', wled: payload, preset_id: presetId };
  return sendEffectCommand(msg, reason);
}

export async function triggerBrightnessEffect(value: number, reason: string): Promise<boolean> {
  console.log('[Effect] TRIGGER brightness', { value, reason });
  return sendEffectCommand({ type: 'brightness', value }, reason);
}

export async function triggerOverrideClearEffect(reason: string): Promise<boolean> {
  console.log('[Effect] TRIGGER override_clear', { reason });
  return sendEffectCommand({ type: 'override_clear' }, reason);
}

export async function triggerFadeToBlackEffect(
  presetId: string | undefined,
  fadeMs: number,
  reason: string,
): Promise<boolean> {
  const s = useAppStore.getState();
  if (presetId) {
    const preset = s.presets.find(p => p.id === presetId);
    if (!preset) {
      console.warn('[Effect] FTB preset missing in app', { presetId, reason });
      return false;
    }
    const payload = presetWledForBoard(preset, s.customSegmentLayouts, s.recallState);
    // WLED's "transition" field is in deciseconds (tenths of a second), not ms —
    // the wled_raw firmware path forwards this JSON verbatim (no ms→decisecond
    // conversion like injectWledTransition does), so we must convert here or the
    // crossfade runs ~10x too long and you see blended colors linger mid-fade.
    const tenths = Math.min(655, Math.max(1, Math.round(fadeMs / 100)));
    const wled = fadeMs > 0 ? { ...payload, transition: tenths } : payload;
    console.log('[Effect] TRIGGER ftb wled_raw', {
      presetId,
      preset: preset.name,
      fadeMs,
      reason,
      bytes: JSON.stringify(wled).length,
    });
    return sendEffectCommand({ type: 'wled_raw', wled, preset_id: presetId }, reason);
  }
  console.log('[Effect] TRIGGER fade_to_black (pure off)', { fadeMs, reason });
  return sendEffectCommand({ type: 'fade_to_black', fade_ms: fadeMs }, reason);
}
