/**
 * Decides what a show phase should do before any BLE/WLED call.
 * FTB is the default. A live preset is applied first; firmware is then told
 * to keep that look instead of blacking out.
 */

import type { ParkShowBinding, ShowKind } from './showBindings';

export const FTB_FADE_SEC_MAX = 600;

export type ShowPhaseName = 'pre' | 'live' | 'post';
export type FirmwareShowPhase = 'pre' | 'black' | 'live' | 'post';

export type ShowPhasePlan =
  | { action: 'skip' }
  | {
      action: 'ftb';
      fadeMs: number;
      firmwarePhase: FirmwareShowPhase;
      missingLivePreset: boolean;
    }
  | { action: 'preset'; presetId: string; firmwarePhase: FirmwareShowPhase };

export function normalizeFtbFadeSec(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(FTB_FADE_SEC_MAX, n);
}

export function normalizeLiveFields(raw: { liveMode?: unknown; livePresetId?: unknown } | null | undefined): {
  liveMode: 'ftb' | 'preset';
  livePresetId: string;
} {
  const livePresetId = typeof raw?.livePresetId === 'string' ? raw.livePresetId : '';
  if (raw?.liveMode === 'preset' && livePresetId) {
    return { liveMode: 'preset', livePresetId };
  }
  return { liveMode: 'ftb', livePresetId: '' };
}

export function ftbDurationMs(binding: { ftbFadeSec: number | null }, fallbackMs: number): number {
  if (binding.ftbFadeSec != null) return Math.round(binding.ftbFadeSec * 1000);
  return fallbackMs;
}

export function firmwarePhase(kind: ShowKind, phase: ShowPhaseName): FirmwareShowPhase {
  if (phase === 'live' && kind === 'fireworks') return 'black';
  return phase;
}

export function planShowPhase(
  binding: Pick<ParkShowBinding, 'kind' | 'liveMode' | 'livePresetId' | 'ftbFadeSec' | 'presets'>,
  phase: ShowPhaseName,
  presets: { id: string }[],
  fadeMs: number,
): ShowPhasePlan {
  const ftbMs = ftbDurationMs(binding, fadeMs);
  const fw = firmwarePhase(binding.kind, phase);

  if (phase === 'live') {
    if (binding.liveMode === 'preset') {
      const preset = presets.find((p) => p.id === binding.livePresetId);
      if (!preset) {
        return { action: 'ftb', fadeMs: ftbMs, firmwarePhase: fw, missingLivePreset: true };
      }
      return { action: 'preset', presetId: binding.livePresetId, firmwarePhase: fw };
    }
    return { action: 'ftb', fadeMs: ftbMs, firmwarePhase: fw, missingLivePreset: false };
  }

  const presetId = binding.presets[phase];
  if (!presetId) return { action: 'skip' };
  if (presetId === '__BLACK__') {
    return { action: 'ftb', fadeMs: ftbMs, firmwarePhase: fw, missingLivePreset: false };
  }
  if (!presets.find((p) => p.id === presetId)) return { action: 'skip' };
  return { action: 'preset', presetId, firmwarePhase: fw };
}
