/**
 * Run show phases via the board.
 * Live defaults to one fade-to-black show_mode_enter.
 * A preset phase claims SHOW_MODE first, then applies with wled_raw show_cue.
 * Live uses look "keep" so that enter does not touch the strip.
 * A plain preset write is still rejected in that state.
 */

import { bleService } from './BLEService';
import type { Preset, RecallState } from '../stores/store';
import { useAppStore } from '../stores/store';
import type { CustomSegmentLayout } from '../utils/segmentLayouts';
import { asSharedSegmentMaps } from '../utils/segmentLayouts';
import type { ParkShowBinding } from '../utils/showBindings';
import { applyShowLiveBrightnessIfNeeded, restoreShowBrightnessIfNeeded } from '../utils/showBrightness';
import { planShowPhase, type ShowPhaseName } from '../utils/showPhasePlan';
import type { ShowCue } from '../utils/showCues';
import { postWledStateDirect } from '../utils/wledDirect';

export type ShowPhase = ShowPhaseName;

async function onShowLiveStarted(phase: ShowPhase): Promise<void> {
  if (phase === 'live') {
    await applyShowLiveBrightnessIfNeeded();
  }
}

/** Apply a preset while SHOW_MODE is held. Outside SHOW_MODE this is a normal preset write. */
export async function applyShowPreset(
  preset: Preset,
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  const { presetWledForBoard } = await import('../utils/bleBoardSync');
  const payload = presetWledForBoard(
    preset,
    asSharedSegmentMaps(useAppStore.getState().mbMapping?.segmentMaps),
    layouts,
    recall,
  );
  console.log('[Shows] show_cue', preset.id, preset.name);
  return bleService.sendWledRaw(payload, preset.id, { showCue: true });
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

  const plan = planShowPhase(binding, phase, presets, fadeMs);
  if (plan.action === 'skip') return false;

  if (plan.action === 'ftb') {
    if (plan.missingLivePreset) {
      console.warn('[Shows] live preset missing — fading to black', binding.livePresetId);
    }
    // Brightness before the single blackout command so a later write cannot cut the fade.
    if (phase === 'live') await onShowLiveStarted(phase);
    await bleService.sendShowModeEnter(binding.kind, plan.firmwarePhase, {
      fadeMs: plan.fadeMs,
      look: 'black',
    });
    return true;
  }

  const preset = presets.find((p) => p.id === plan.presetId);
  if (!preset) return false;

  if (phase === 'live') await onShowLiveStarted(phase);
  // Enter first so SHOW_MODE is held, then show_cue. A preset write before enter
  // is rejected once pre-show has already taken SHOW_MODE, and enter after the
  // cue would overwrite it with the firmware phase look.
  const entered = await bleService.sendShowModeEnter(
    binding.kind,
    plan.firmwarePhase,
    phase === 'live' ? { look: 'keep' } : undefined,
  );
  if (entered === false) return false;
  return applyShowPreset(preset, recall, layouts);
}

export async function applyShowCue(cue: ShowCue): Promise<boolean> {
  if (!bleService.isConnected()) return false;
  const s = useAppStore.getState();
  const action = cue.action;
  if (action.type === 'black') {
    const fadeMs = action.fadeSec != null
      ? Math.round(action.fadeSec * 1000)
      : s.bleEffectTransitionMs;
    return bleService.sendShowModeEnter('cue', 'cue', { look: 'black', fadeMs });
  }
  const preset = s.presets.find((p) => p.id === action.presetId);
  if (!preset) {
    console.warn('[Cues] preset missing — fading to black', action.presetId);
    return bleService.sendShowModeEnter('cue', 'cue', {
      look: 'black',
      fadeMs: s.bleEffectTransitionMs,
    });
  }
  const { presetWledForBoard } = await import('../utils/bleBoardSync');
  const payload = presetWledForBoard(
    preset,
    asSharedSegmentMaps(s.mbMapping?.segmentMaps),
    s.customSegmentLayouts,
    s.recallState,
  );
  await bleService.sendShowModeEnter('cue', 'cue', { look: 'keep' });
  const direct = await postWledStateDirect(payload).catch(() => false);
  const cued = await bleService.sendWledRaw(payload, preset.id, { showCue: true });
  return direct || cued;
}

export async function stopShowMode(): Promise<void> {
  if (!bleService.isConnected()) {
    await restoreShowBrightnessIfNeeded();
    return;
  }
  await bleService.sendShowModeExit();
  await restoreShowBrightnessIfNeeded();
}
