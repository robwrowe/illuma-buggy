/**
 * Run show phases via board preset apply (per-binding presets, not global only).
 */

import { bleService } from './BLEService';
import { applyPresetToBoard } from '../utils/bleBoardSync';
import type { Preset, RecallState } from '../stores/store';
import type { CustomSegmentLayout } from '../utils/segmentLayouts';
import type { ParkShowBinding, ShowKind } from '../utils/showBindings';
import { applyShowLiveBrightnessIfNeeded, restoreShowBrightnessIfNeeded } from '../utils/showBrightness';

export type ShowPhase = 'pre' | 'live' | 'post';

function firmwarePhase(kind: ShowKind, phase: ShowPhase): 'pre' | 'black' | 'live' | 'post' {
  if (phase === 'live' && kind === 'fireworks') return 'black';
  return phase;
}

async function onShowLiveStarted(phase: ShowPhase): Promise<void> {
  if (phase === 'live') {
    await applyShowLiveBrightnessIfNeeded();
  }
}

export async function runShowPhase(
  binding: ParkShowBinding,
  phase: ShowPhase,
  presets: Preset[],
  recall: RecallState,
  layouts: CustomSegmentLayout[],
  fadeMs = 800,
): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  const presetId = binding.presets[phase];
  if (!presetId) return false;

  if (presetId === '__BLACK__') {
    await bleService.sendFadeToBlack(undefined, fadeMs);
    await onShowLiveStarted(phase);
    await bleService.sendShowModeEnter(binding.kind, firmwarePhase(binding.kind, phase));
    return true;
  }

  const preset = presets.find(p => p.id === presetId);
  if (!preset) return false;

  const ok = await applyPresetToBoard(preset, recall, layouts);
  if (ok) {
    await onShowLiveStarted(phase);
    await bleService.sendShowModeEnter(binding.kind, firmwarePhase(binding.kind, phase));
  }
  return ok;
}

export async function stopShowMode(): Promise<void> {
  if (!bleService.isConnected()) {
    await restoreShowBrightnessIfNeeded();
    return;
  }
  await bleService.sendShowModeExit();
  await restoreShowBrightnessIfNeeded();
}
