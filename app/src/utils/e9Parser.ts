/**
 * MagicBand+ E9xx broadcast packet parser (Tier 1 confirmed decodes + Tier 2 fallback).
 * Decode/display only — WLED decisions live in firmware MbRuleEngine.
 */

import { MB_COLOR_NAMES } from './mbConfig';

export const STANDARD_COLOR_MASK = 0b101; // bits 7-5 — "normal color" mask

export type E9Tier = 1 | 2;

/** Decode-time class label for capture display (not a mapping system). */
export type E9AnimationClass =
  | 'singleColor'
  | 'dualColor'
  | 'sixBitColor'
  | 'fivePositionPalette'
  | 'fivePositionFlash'
  | 'unclassified';

export type E909Position = 'topLeft' | 'bottomLeft' | 'bottomRight' | 'topRight' | 'center';
export type E90EPosition = 'center' | 'upperRight' | 'bottomRight' | 'bottomLeft' | 'upperLeft';

export interface E9ColorByte {
  raw: number;
  mask: number;
  paletteIndex: number;
  maskUnusual: boolean;
}

export interface E9TimingByte {
  raw: number;
  alwaysOn: boolean;
  scaler: boolean;
  fadeOut: number;
  timeValue: number;
}

export interface ParsedE9Base {
  tier: E9Tier;
  opcode: number;
  opcodeHex: string;
  animationClass: E9AnimationClass;
  rawHex: string;
  payloadLen: number;
  /** Tier 2 signature for per-packet mapping */
  signature: string;
  decodeQuality: 'full' | 'partial' | 'preset_only';
}

export interface ParsedE905 extends ParsedE9Base {
  kind: 'E905';
  tier: 1;
  color: E9ColorByte;
  mask8: number;
  timing?: E9TimingByte;
  vibration?: number;
}

export interface ParsedE906 extends ParsedE9Base {
  kind: 'E906';
  tier: 1;
  inner: E9ColorByte;
  outer: E9ColorByte;
  timing?: E9TimingByte;
  vibration?: number;
}

export interface ParsedE908 extends ParsedE9Base {
  kind: 'E908';
  tier: 1;
  rgb: [number, number, number];
  rgb6: [number, number, number];
  timing?: E9TimingByte;
  vibration?: number;
}

export interface ParsedE909 extends ParsedE9Base {
  kind: 'E909';
  tier: 1;
  colors: Record<E909Position, E9ColorByte>;
  timing?: E9TimingByte;
  vibration?: number;
}

export interface ParsedE90CPalette extends ParsedE9Base {
  kind: 'E90C_palette';
  tier: 1;
  subMode: 'palette5';
  colors: Record<E909Position, E9ColorByte>;
  timing?: E9TimingByte;
  vibration?: number;
}

export interface E90EPatternInfo {
  patternId: number;
  label: string;
  animate: boolean;
  cadence: number;
  sentinelDisable: boolean;
}

export interface ParsedE90E extends ParsedE9Base {
  kind: 'E90E';
  tier: 1;
  colors: Record<E90EPosition, E9ColorByte>;
  pattern: E90EPatternInfo;
  opaqueBytes: { b14?: number; b15?: number; b16?: number };
  vibration?: number;
}

export interface ParsedE9Tier2 extends ParsedE9Base {
  kind: 'tier2';
  tier: 2;
  reason: string;
}

export type ParsedE9 =
  | ParsedE905
  | ParsedE906
  | ParsedE908
  | ParsedE909
  | ParsedE90CPalette
  | ParsedE90E
  | ParsedE9Tier2;

const E909_POSITIONS: E909Position[] = ['topLeft', 'bottomLeft', 'bottomRight', 'topRight', 'center'];
const E90E_POSITIONS: E90EPosition[] = ['center', 'upperRight', 'bottomRight', 'bottomLeft', 'upperLeft'];

const E90E_PATTERN_LABELS: Record<number, string> = {
  0: 'Off / minimal',
  1: 'Off / minimal',
  2: 'Off / minimal',
  3: 'Off / minimal',
  4: 'Upper left, upper right, bottom left',
  5: 'All 5 LEDs',
  6: 'Upper right only',
  7: 'Upper left + upper right',
  8: 'Upper left, upper right, bottom right (fallback)',
};

const PERMANENT_TIER2_OPCODES = new Set([0xe910, 0xe913]);
const UNINVESTIGATED_TIER2 = new Set([0xe90f, 0xe911, 0xe912, 0xe914, 0xe91b]);

// ── Shared helpers ───────────────────────────────────────────────────────────

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Payload after optional 8301 CID prefix */
export function disneyPayload(bytes: number[]): number[] {
  if (bytes.length >= 2 && bytes[0] === 0x83 && bytes[1] === 0x01) return bytes.slice(2);
  return bytes;
}

export function extractE9Opcode(payload: number[]): number | null {
  if (payload.length >= 4 && (payload[0] === 0xe1 || payload[0] === 0xe2) && payload[2] === 0xe9) {
    return (payload[2] << 8) | payload[3];
  }
  if (payload.length >= 2 && payload[0] === 0xe9) return (payload[0] << 8) | payload[1];
  return null;
}

export function opcodeToHex(op: number): string {
  return `E${op.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 6-bit channel (bits 6-1) → 8-bit via bit replication (not naive ×4). */
export function scale6To8(v: number): number {
  const x = v & 0x3f;
  return (x << 2) | (x >> 4);
}

export function decode6BitChannel(byte: number): number {
  return scale6To8((byte >> 1) & 0x3f);
}

export function looksLikePaletteByte(b: number): boolean {
  return ((b >> 5) & 0x07) === STANDARD_COLOR_MASK;
}

export function decodeColorByte(b: number): E9ColorByte {
  const mask = (b >> 5) & 0x07;
  return {
    raw: b,
    mask,
    paletteIndex: b & 0x1f,
    maskUnusual: mask !== STANDARD_COLOR_MASK,
  };
}

export function decodeTimingByte(b: number): E9TimingByte {
  return {
    raw: b,
    alwaysOn: (b & 0x80) !== 0,
    scaler: (b & 0x40) !== 0,
    fadeOut: (b >> 4) & 0x03,
    timeValue: b & 0x0f,
  };
}

export function decodeE905MaskByte(payload: number[]): number {
  const b6 = payload[6];
  if (b6 !== 0x0e && b6 !== 0x0f) return b6;
  return (payload[7] >> 5) & 0x07;
}

export function e90cIsPaletteSubMode(payload: number[]): boolean {
  if (payload.length < 12) return false;
  if (payload[6] !== 0x0f) return false;
  for (let i = 7; i <= 11; i++) {
    if (!looksLikePaletteByte(payload[i])) return false;
  }
  return true;
}

export function e90eStructuralValid(payload: number[]): boolean {
  return payload.length >= 12 && payload[6] === 0x0f;
}

export function extractCandidatePalettes(payload: number[], startIdx: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = startIdx + i;
    if (idx >= payload.length) break;
    out.push(payload[idx] & 0x1f);
  }
  return out;
}

function simpleStructuralHash(payload: number[], opcode: number): string {
  const head = payload.slice(0, Math.min(6, payload.length));
  return bytesToHex(head) + (payload.length > 6 ? `:${payload.length}` : '');
}

export function tier2Signature(payload: number[], opcode: number): string {
  return `${opcodeToHex(opcode)}:${payload.length}:${simpleStructuralHash(payload, opcode)}`;
}

function baseFields(payload: number[], opcode: number, tier: E9Tier, animClass: E9AnimationClass, quality: ParsedE9Base['decodeQuality'], reason?: string): ParsedE9Base {
  const hex = bytesToHex(payload);
  return {
    tier,
    opcode,
    opcodeHex: opcodeToHex(opcode),
    animationClass: animClass,
    rawHex: hex,
    payloadLen: payload.length,
    signature: tier2Signature(payload, opcode),
    decodeQuality: quality,
    ...(reason ? {} : {}),
  };
}

function tier2(payload: number[], opcode: number, reason: string): ParsedE9Tier2 {
  return {
    ...baseFields(payload, opcode, 2, 'unclassified', 'preset_only'),
    kind: 'tier2',
    tier: 2,
    reason,
  };
}

function decodeE909Colors(payload: number[]): Record<E909Position, E9ColorByte> {
  const colors = {} as Record<E909Position, E9ColorByte>;
  E909_POSITIONS.forEach((pos, i) => {
    colors[pos] = decodeColorByte(payload[7 + i]);
  });
  return colors;
}

function decodeE90EColors(payload: number[]): Record<E90EPosition, E9ColorByte> {
  const colors = {} as Record<E90EPosition, E9ColorByte>;
  E90E_POSITIONS.forEach((pos, i) => {
    colors[pos] = decodeColorByte(payload[7 + i]);
  });
  return colors;
}

function decodeE90EPattern(payload: number[]): E90EPatternInfo {
  if (payload.length >= 14 && payload[12] === 0xff && payload[13] === 0xff) {
    return { patternId: -1, label: 'Disable timing/vibration (FFFF)', animate: false, cadence: 0, sentinelDisable: true };
  }
  const b12 = payload[12];
  const patternId = (b12 >> 4) & 0x0f;
  const lowNibble = b12 & 0x0f;
  const animate = lowNibble !== 0x03;
  let label = E90E_PATTERN_LABELS[patternId] ?? `Pattern ${patternId}`;
  if (patternId >= 8) label = E90E_PATTERN_LABELS[8];
  if (!animate) label += ' (static)';
  return {
    patternId,
    label,
    animate,
    cadence: payload.length > 13 ? payload[13] : 0,
    sentinelDisable: false,
  };
}

/** Gated heuristic — only runs when opcode/sub-mode already validated as Tier 1 palette frame. */
export function applyUnknownE9Heuristic(payload: number[], opcode: number): number[] | null {
  if (opcode === 0xe909 || (opcode === 0xe90c && e90cIsPaletteSubMode(payload))) {
    if (payload.length < 12) return null;
    return extractCandidatePalettes(payload, 7, 5);
  }
  if (opcode === 0xe90e && e90eStructuralValid(payload)) {
    return extractCandidatePalettes(payload, 7, 5);
  }
  if (opcode === 0xe905 && payload.length >= 8) {
    return [decodeE905MaskByte(payload) ? decodeColorByte(payload[7]).paletteIndex : payload[7] & 0x1f];
  }
  if (opcode === 0xe906 && payload.length >= 9) {
    return [payload[7] & 0x1f, payload[8] & 0x1f];
  }
  return null;
}

// ── Main parser ──────────────────────────────────────────────────────────────

export function parseE9Packet(input: number[] | string): ParsedE9 | null {
  const bytes = typeof input === 'string' ? disneyPayload(hexToBytes(input)) : disneyPayload(input);
  const opcode = extractE9Opcode(bytes);
  if (opcode === null) return null;

  switch (opcode) {
    case 0xe905: {
      if (bytes.length < 9) return tier2(bytes, opcode, 'E905 frame too short');
      const color = decodeColorByte(bytes[7]);
      return {
        ...baseFields(bytes, opcode, 1, 'singleColor', 'full'),
        kind: 'E905',
        tier: 1,
        color,
        mask8: decodeE905MaskByte(bytes),
        timing: bytes.length > 6 ? decodeTimingByte(bytes[6]) : undefined,
        vibration: bytes.length > 8 ? bytes[8] : undefined,
      };
    }
    case 0xe906: {
      if (bytes.length < 10) return tier2(bytes, opcode, 'E906 frame too short');
      return {
        ...baseFields(bytes, opcode, 1, 'dualColor', 'full'),
        kind: 'E906',
        tier: 1,
        inner: decodeColorByte(bytes[7]),
        outer: decodeColorByte(bytes[8]),
        timing: bytes.length > 6 ? decodeTimingByte(bytes[6]) : undefined,
        vibration: bytes.length > 9 ? bytes[9] : undefined,
      };
    }
    case 0xe908: {
      if (bytes.length < 12) return tier2(bytes, opcode, 'E908 frame too short');
      const rgb6: [number, number, number] = [
        (bytes[8] >> 1) & 0x3f,
        (bytes[9] >> 1) & 0x3f,
        (bytes[10] >> 1) & 0x3f,
      ];
      return {
        ...baseFields(bytes, opcode, 1, 'sixBitColor', 'full'),
        kind: 'E908',
        tier: 1,
        rgb6,
        rgb: [scale6To8(rgb6[0]), scale6To8(rgb6[1]), scale6To8(rgb6[2])],
        timing: bytes.length > 6 ? decodeTimingByte(bytes[6]) : undefined,
        vibration: bytes.length > 11 ? bytes[11] : undefined,
      };
    }
    case 0xe909: {
      if (bytes.length < 13) return tier2(bytes, opcode, 'E909 frame too short');
      const colors = decodeE909Colors(bytes);
      const hasUnusualMask = Object.values(colors).some(c => c.maskUnusual);
      return {
        ...baseFields(bytes, opcode, 1, 'fivePositionPalette', hasUnusualMask ? 'partial' : 'full'),
        kind: 'E909',
        tier: 1,
        colors,
        timing: bytes.length > 6 ? decodeTimingByte(bytes[6]) : undefined,
        vibration: bytes.length > 12 ? bytes[12] : undefined,
      };
    }
    case 0xe90c: {
      if (e90cIsPaletteSubMode(bytes)) {
        const colors = decodeE909Colors(bytes);
        return {
          ...baseFields(bytes, opcode, 1, 'fivePositionPalette', 'full'),
          kind: 'E90C_palette',
          tier: 1,
          subMode: 'palette5',
          colors,
          timing: bytes.length > 6 ? decodeTimingByte(bytes[6]) : undefined,
          vibration: bytes.length > 12 ? bytes[bytes.length - 1] : undefined,
        };
      }
      return tier2(bytes, opcode, 'E90C sub-mode B (animation/unknown)');
    }
    case 0xe90e: {
      if (!e90eStructuralValid(bytes)) return tier2(bytes, opcode, 'E90E byte 6 != 0x0f');
      if (bytes.length < 14) return tier2(bytes, opcode, 'E90E frame too short');
      const colors = decodeE90EColors(bytes);
      const hasUnusualMask = Object.values(colors).some(c => c.maskUnusual);
      return {
        ...baseFields(bytes, opcode, 1, 'fivePositionFlash', hasUnusualMask ? 'partial' : 'partial'),
        kind: 'E90E',
        tier: 1,
        colors,
        pattern: decodeE90EPattern(bytes),
        opaqueBytes: {
          b14: bytes.length > 14 ? bytes[14] : undefined,
          b15: bytes.length > 15 ? bytes[15] : undefined,
          b16: bytes.length > 16 ? bytes[16] : undefined,
        },
        vibration: bytes.length > 17 ? bytes[17] : bytes[bytes.length - 1],
      };
    }
    default: {
      if (PERMANENT_TIER2_OPCODES.has(opcode)) {
        return tier2(bytes, opcode, `${opcodeToHex(opcode)} permanently Tier 2 (parametric animation)`);
      }
      if (UNINVESTIGATED_TIER2.has(opcode)) {
        return tier2(bytes, opcode, `${opcodeToHex(opcode)} uninvestigated`);
      }
      if (opcode >= 0xe900 && opcode <= 0xe9ff) {
        return tier2(bytes, opcode, `Unhandled E9 opcode ${opcodeToHex(opcode)}`);
      }
      return tier2(bytes, opcode, 'Not an E9 show opcode');
    }
  }
}

export function paletteIndexToHex(idx: number, colors: string[]): string {
  if (idx < 0 || idx > 31 || !colors[idx]) return '#000000';
  return colors[idx];
}

export function describeParsedE9(parsed: ParsedE9, colors?: string[]): string {
  const palName = (idx: number) => colors?.[idx] ? `${idx} (${MB_COLOR_NAMES[idx] ?? 'pal'})` : String(idx);

  switch (parsed.kind) {
    case 'E905':
      return `${parsed.opcodeHex} single mask=${parsed.mask8} pal=${palName(parsed.color.paletteIndex)}`;
    case 'E906':
      return `${parsed.opcodeHex} dual inner=${palName(parsed.inner.paletteIndex)} outer=${palName(parsed.outer.paletteIndex)}`;
    case 'E908':
      return `${parsed.opcodeHex} RGB(${parsed.rgb.join(',')})`;
    case 'E909':
    case 'E90C_palette': {
      const slots = E909_POSITIONS.map(p => `${p[0].toUpperCase()}${p.slice(1)}=${palName(parsed.colors[p].paletteIndex)}`);
      return `${parsed.opcodeHex} five-palette [${slots.join(' ')}]`;
    }
    case 'E90E':
      return `${parsed.opcodeHex} flash pattern=${parsed.pattern.patternId} (${parsed.pattern.label})`;
    case 'tier2':
      return `${parsed.opcodeHex} Tier2: ${parsed.reason}`;
    default:
      return parsed.opcodeHex;
  }
}

export function effectClassBadge(parsed: ParsedE9): 'Fully Decoded' | 'Partially Decoded' | 'Unmapped Bytes — Preset Only' {
  if (parsed.tier === 2) return 'Unmapped Bytes — Preset Only';
  if (parsed.decodeQuality === 'partial') return 'Partially Decoded';
  return 'Fully Decoded';
}
