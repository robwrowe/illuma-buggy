/**
 * Apply parsed E9 packets to WLED via the board — app-side protocol intelligence.
 */

import { bleService } from '../services/BLEService';
import type { Preset, RecallState } from '../stores/store';
import { buildRecallPayload } from '../stores/store';
import type { CustomSegmentLayout, WledSegmentDef } from './segmentLayouts';
import { finalizeWledSegmentPayload } from './segmentLayouts';
import type { MbMappingConfig, WledSegRef } from './mbConfig';
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

function pickRandomPaletteIndex(mbMapping: MbMappingConfig): number | null {
  const pool = mbMapping.randomPool?.paletteIndices ?? [];
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function resolvePaletteRgb(
  idx: number,
  colors: string[],
  mbMapping: MbMappingConfig,
): [number, number, number] | null {
  if (idx === MB_PAL_OFF) return [0, 0, 0];
  if (idx === MB_PAL_UNIQUE) return null;
  if (idx === MB_PAL_RANDOM) {
    const pick = pickRandomPaletteIndex(mbMapping);
    if (pick === null) return null;
    return hexToRgb(colors[pick] ?? '#ffffff');
  }
  if (idx < 0 || idx > 31) return null;
  return hexToRgb(colors[idx] ?? '#000000');
}

/** Build segment-colored WLED state for Tier 1 decoded packets. */
export function buildWledFromParsedE9(
  parsed: ParsedE9,
  mbMapping: MbMappingConfig,
  preset?: Preset | null,
  recall?: RecallState,
): object {
  const base = preset && recall ? buildRecallPayload(preset, recall) : { on: true };
  const colors = mbMapping.colors;
  const segList: object[] = [];

  const addSegSolid = (segKey: string, rgb: [number, number, number]) => {
    const refs = mbMapping.segments[segKey as keyof typeof mbMapping.segments];
    if (!refs?.length) return;
    for (const ref of refs) {
      if (ref.stop <= ref.start) continue;
      const r = ref as WledSegRef;
      segList.push({
        id: r.id,
        start: r.start,
        stop: r.stop,
        grp: r.grp ?? 1,
        spc: r.spc ?? 0,
        of: r.of ?? 0,
        rev: r.rev ?? false,
        mi: r.mi ?? false,
        on: true,
        fx: 0,
        col: [[rgb[0], rgb[1], rgb[2]]],
      });
    }
  };

  switch (parsed.kind) {
    case 'E905': {
      const rgb = resolvePaletteRgb(parsed.color.paletteIndex, colors, mbMapping);
      if (rgb) {
        if (parsed.mask8 === 0) addSegSolid('all', rgb);
        else {
          for (let i = 0; i < 8; i++) {
            if (parsed.mask8 & (1 << i)) addSegSolid(`band${i}`, rgb);
          }
        }
      }
      break;
    }
    case 'E906': {
      const inner = resolvePaletteRgb(parsed.inner.paletteIndex, colors, mbMapping);
      const outer = resolvePaletteRgb(parsed.outer.paletteIndex, colors, mbMapping);
      if (inner) addSegSolid('inner', inner);
      if (outer) addSegSolid('outer', outer);
      break;
    }
    case 'E908':
      addSegSolid('all', parsed.rgb);
      break;
    case 'E909':
    case 'E90C_palette':
      for (const [pos, slot] of Object.entries(parsed.colors) as [E909Position, { paletteIndex: number }][]) {
        const rgb = resolvePaletteRgb(slot.paletteIndex, colors, mbMapping);
        if (rgb) addSegSolid(E909_SEG[pos], rgb);
      }
      break;
    case 'E90E':
      for (const [pos, slot] of Object.entries(parsed.colors) as [E90EPosition, { paletteIndex: number }][]) {
        const rgb = resolvePaletteRgb(slot.paletteIndex, colors, mbMapping);
        if (rgb) addSegSolid(E90E_SEG[pos], rgb);
      }
      break;
    default:
      break;
  }

  if (segList.length === 0) return base;
  return { ...base, on: true, seg: segList };
}

function resolveMapping(
  parsed: ParsedE9,
  mbMapping: MbMappingConfig,
): { presetId: string; useMbColors: boolean } | null {
  let mapping = resolveEffectClassMapping(parsed, mbMapping);
  if (!mapping?.presetId && mbMapping.defaultPresetId) {
    mapping = { presetId: mbMapping.defaultPresetId, useMbColors: false };
  }
  return mapping;
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

  const mapping = resolveMapping(parsed, mbMapping);

  // Tier 1 color overlay — apply decoded MB colors directly (no preset required).
  if (parsed.tier === 1 && mapping?.useMbColors !== false) {
    const wled = buildWledFromParsedE9(parsed, mbMapping);
    const finalized = finalizeWledSegmentPayload(wled as { on?: boolean; seg?: WledSegmentDef[] });
    if (finalized.seg.length > 0) {
      return bleService.sendWledRaw(finalized);
    }
  }

  if (!mapping?.presetId) return false;

  const preset = presets.find(p => p.id === mapping.presetId);
  if (!preset) return false;

  if (parsed.tier === 2 || !mapping.useMbColors) {
    return applyPresetToBoard(preset, recall, layouts);
  }

  const wled = buildWledFromParsedE9(parsed, mbMapping, preset, recall);
  const finalized = finalizeWledSegmentPayload(wled as { on?: boolean; seg?: WledSegmentDef[] });
  return bleService.sendWledRaw(finalized, preset.id);
}
