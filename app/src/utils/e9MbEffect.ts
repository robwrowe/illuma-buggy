/**
 * Apply parsed E9 packets to WLED via the board — app-side protocol intelligence.
 */

import { bleService } from '../services/BLEService';
import type { Preset, RecallState } from '../stores/store';
import { buildRecallPayload } from '../stores/store';
import type { CustomSegmentLayout, WledSegmentDef } from './segmentLayouts';
import { finalizeWledSegmentPayload } from './segmentLayouts';
import type { MbMappingConfig } from './mbConfig';
import { MB_PAL_OFF, MB_PAL_RANDOM, MB_PAL_UNIQUE } from './mbConfig';
import { applyPresetToBoard } from './bleBoardSync';
import {
  parseE9Packet,
  resolveEffectClassMapping,
  disneyPayload,
  hexToBytes,
  type ParsedE9,
  type E909Position,
  type E90EPosition,
} from './e9Parser';

const E909_SEG: Record<E909Position, string> = {
  topLeft: 'topLeft',
  bottomLeft: 'bottomLeft',
  bottomRight: 'bottomRight',
  topRight: 'topRight',
  center: 'center',
};

const E90E_SEG: Record<E90EPosition, string> = {
  center: 'center',
  upperRight: 'topRight',
  bottomRight: 'bottomRight',
  bottomLeft: 'bottomLeft',
  upperLeft: 'topLeft',
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function resolvePaletteRgb(idx: number, colors: string[]): [number, number, number] | null {
  if (idx === MB_PAL_OFF) return [0, 0, 0];
  if (idx === MB_PAL_UNIQUE || idx === MB_PAL_RANDOM) return null;
  if (idx < 0 || idx > 31) return null;
  return hexToRgb(colors[idx] ?? '#000000');
}

/** Build segment-colored WLED state for Tier 1 decoded packets. */
export function buildWledFromParsedE9(
  parsed: ParsedE9,
  preset: Preset,
  mbMapping: MbMappingConfig,
  recall: RecallState,
): object {
  const base = buildRecallPayload(preset, recall);
  const colors = mbMapping.colors;
  const segList: object[] = [];

  const addSegSolid = (segKey: string, rgb: [number, number, number]) => {
    const refs = mbMapping.segments[segKey as keyof typeof mbMapping.segments];
    if (!refs?.length) return;
    for (const ref of refs) {
      if (ref.stop <= ref.start) continue;
      segList.push({
        id: ref.id,
        start: ref.start,
        stop: ref.stop,
        fx: ref.fx ?? 0,
        col: [[rgb[0], rgb[1], rgb[2]]],
      });
    }
  };

  switch (parsed.kind) {
    case 'E905': {
      const rgb = resolvePaletteRgb(parsed.color.paletteIndex, colors);
      if (rgb) {
        if (parsed.mask8 === 0) addSegSolid('all', rgb);
        else {
          for (let i = 0; i < 8; i++) {
            if (parsed.mask8 & (1 << i)) {
              const rgb2 = resolvePaletteRgb(parsed.color.paletteIndex, colors);
              if (rgb2) addSegSolid(`band${i}`, rgb2);
            }
          }
        }
      }
      break;
    }
    case 'E906':
      {
        const inner = resolvePaletteRgb(parsed.inner.paletteIndex, colors);
        const outer = resolvePaletteRgb(parsed.outer.paletteIndex, colors);
        if (inner) addSegSolid('inner', inner);
        if (outer) addSegSolid('outer', outer);
      }
      break;
    case 'E908':
      addSegSolid('all', parsed.rgb);
      break;
    case 'E909':
    case 'E90C_palette':
      for (const [pos, slot] of Object.entries(parsed.colors) as [E909Position, { paletteIndex: number }][]) {
        const rgb = resolvePaletteRgb(slot.paletteIndex, colors);
        if (rgb) addSegSolid(E909_SEG[pos], rgb);
      }
      break;
    case 'E90E':
      for (const [pos, slot] of Object.entries(parsed.colors) as [E90EPosition, { paletteIndex: number }][]) {
        const rgb = resolvePaletteRgb(slot.paletteIndex, colors);
        if (rgb) addSegSolid(E90E_SEG[pos], rgb);
      }
      break;
    default:
      break;
  }

  if (segList.length === 0) return base;
  return { ...base, on: true, seg: segList };
}

export async function applyParsedE9Mapping(
  hex: string,
  mbMapping: MbMappingConfig,
  presets: Preset[],
  recall: RecallState,
  layouts: CustomSegmentLayout[],
): Promise<boolean> {
  if (!bleService.isConnected()) return false;

  const parsed = parseE9Packet(disneyPayload(hexToBytes(hex)));
  if (!parsed) return false;

  let mapping = resolveEffectClassMapping(parsed, mbMapping);
  if (!mapping?.presetId) return false;

  const preset = presets.find(p => p.id === mapping!.presetId);
  if (!preset) return false;

  if (parsed.tier === 2 || !mapping.useMbColors) {
    return applyPresetToBoard(preset, recall, layouts);
  }

  const wled = buildWledFromParsedE9(parsed, preset, mbMapping, recall);
  const finalized = finalizeWledSegmentPayload(wled as { on?: boolean; seg?: import('./segmentLayouts').WledSegmentDef[] });
  const ok = await bleService.sendWledRaw(finalized, preset.id);
  if (ok) {
    await bleService.sendPresetSave(preset.id, preset.name, wled);
  }
  return ok;
}
