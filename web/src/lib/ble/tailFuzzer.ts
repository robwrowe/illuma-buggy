import { tailBytesToDisplayHex } from './tailBuilder';

/**
 * @typedef {object} FuzzOptions
 * @property {number} minLen - min tail length in bytes (inclusive)
 * @property {number} maxLen - max tail length in bytes (inclusive)
 * @property {number} count - how many random tails to generate
 * @property {boolean} avoidVibNibble - if true, never let the LAST byte's
 *   high nibble equal 0xB (the confirmed vibration-field marker), since a
 *   random tail ending in a 0xBx byte would masquerade as a real vibration
 *   field per the existing "last byte high nibble 0xB = vibration" finding.
 *   Only checked on the actual last byte of each generated tail.
 * @property {number[]} excludeByteValues - byte values to never emit (rare;
 *   default empty). Provided for future use, not surfaced in UI v1.
 */

const MAX_FUZZ_TAIL_BYTES = 48; // matches MAX_TAIL_BYTES in tailBuilder/WandLabTailBuilderTab

export { MAX_FUZZ_TAIL_BYTES };

/** Clamp + validate min/max length inputs. */
export function clampFuzzLen(n) {
  return Math.max(0, Math.min(MAX_FUZZ_TAIL_BYTES, Number(n) || 0));
}

/** One Tail Builder-style entry from a byte array. */
export function tailEntryFromBytes(bytes) {
  const b = (bytes || []).map((x) => x & 0xff);
  return {
    bytes: b,
    hex: b.map((x) => x.toString(16).padStart(2, '0')).join(''),
    displayHex: tailBytesToDisplayHex(b),
  };
}

/** Generate one random tail byte array per FuzzOptions. */
export function randomTailBytes(opts) {
  const {
    minLen = 0,
    maxLen = 0,
    avoidVibNibble = true,
    excludeByteValues = [],
  } = opts || {};
  const lo = clampFuzzLen(Math.min(minLen, maxLen));
  const hi = clampFuzzLen(Math.max(minLen, maxLen));
  const len = lo + Math.floor(Math.random() * (hi - lo + 1));
  const excluded = new Set((excludeByteValues || []).map((b) => b & 0xff));
  const bytes = [];
  for (let i = 0; i < len; i++) {
    let b;
    do {
      b = Math.floor(Math.random() * 256);
    } while (excluded.has(b) && excluded.size < 256);
    bytes.push(b);
  }
  if (avoidVibNibble && bytes.length) {
    const lastIdx = bytes.length - 1;
    // Re-roll just the last byte until its high nibble isn't 0xB.
    let guard = 0;
    while ((bytes[lastIdx] & 0xf0) === 0xb0 && guard < 64) {
      bytes[lastIdx] = Math.floor(Math.random() * 256);
      guard += 1;
    }
  }
  return bytes;
}

/** Generate a batch of random tails, each as a raw byte array. */
export function randomTailBatch(opts) {
  const n = Math.max(1, Math.min(200, Number(opts?.count) || 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(randomTailBytes(opts));
  }
  return out;
}
