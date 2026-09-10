#!/usr/bin/env node
/**
 * Smoke tests for web/src/lib/ble/tailFuzzer.ts.
 * Usage: npm run test:tail-fuzzer  (from web/)
 */
import { decodeMbColorMaskByte } from '../src/lib/ble/mbPayloads.ts';
import { assembleTailPayload, parseTailBytes } from '../src/lib/ble/tailBuilder.ts';
import {
  MAX_FUZZ_TAIL_BYTES,
  clampFuzzLen,
  randomTailBatch,
  randomTailBytes,
} from '../src/lib/ble/tailFuzzer.ts';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok  — ${msg}`);
  }
}

assert(clampFuzzLen(-3) === 0, 'clampFuzzLen negative → 0');
assert(clampFuzzLen(99) === MAX_FUZZ_TAIL_BYTES, 'clampFuzzLen 99 → 48');
assert(clampFuzzLen('nope') === 0, 'clampFuzzLen non-numeric → 0');

const fixed = randomTailBytes({ minLen: 4, maxLen: 4, count: 1 });
assert(fixed.length === 4, `fixed length 4 (got ${fixed.length})`);
assert(fixed.every((b) => b >= 0 && b <= 255), 'fixed-length bytes are 0–255');

const swapped = randomTailBytes({ minLen: 12, maxLen: 4 });
assert(
  swapped.length >= 4 && swapped.length <= 12,
  `minLen > maxLen still in sorted range (got ${swapped.length})`,
);

const empty = randomTailBytes({ minLen: 0, maxLen: 0 });
assert(empty.length === 0, 'minLen 0 / maxLen 0 → empty tail');

const emptyPkt = assembleTailPayload({
  timingByte: 0x0f,
  colorFormat: '0f',
  colors: [{ kind: 'palette', paletteIdx: 0, mask: 2 }],
  tailBytes: empty,
  vibration: null,
  envelope: 'e1',
});
assert(emptyPkt.bytes.length > 0, 'empty tail still assembles a packet');
assert(
  emptyPkt.warnings.some((w) => /Tail is empty/i.test(w)),
  'empty tail emits Tail Builder empty-tail warning',
);

const knownTail = parseTailBytes('58 F4 48 82 D1 46 02 08 D0 65 00');
const c0 = decodeMbColorMaskByte(0x56);
const c1 = decodeMbColorMaskByte(0x48);
const colors = [
  { kind: 'palette', paletteIdx: c0.palette, mask: c0.mask },
  { kind: 'palette', paletteIdx: c1.palette, mask: c1.mask },
];
const fuzzHex = assembleTailPayload({
  timingByte: 0x6f,
  colorFormat: '0f',
  colors,
  tailBytes: knownTail,
  vibration: 0,
  envelope: 'e1',
}).hex;
assert(
  fuzzHex === 'e100e911006f0f564858f44882d1460208d06500b0',
  `same tail bytes assemble identically to Tail Builder (got ${fuzzHex})`,
);

let vibHit = 0;
for (let i = 0; i < 1000; i++) {
  const t = randomTailBytes({ minLen: 1, maxLen: 8, avoidVibNibble: true });
  if (t.length && (t[t.length - 1] & 0xf0) === 0xb0) vibHit += 1;
}
assert(vibHit === 0, `avoidVibNibble:true never ends in 0xBx (hits=${vibHit})`);

let vibAllowed = 0;
for (let i = 0; i < 2000; i++) {
  const t = randomTailBytes({ minLen: 1, maxLen: 1, avoidVibNibble: false });
  if (t.length && (t[t.length - 1] & 0xf0) === 0xb0) vibAllowed += 1;
}
assert(
  vibAllowed > 0,
  `avoidVibNibble:false can emit trailing 0xBx (hits=${vibAllowed}/2000)`,
);

const batch = randomTailBatch({ minLen: 2, maxLen: 2, count: 7 });
assert(batch.length === 7, `batch count 7 (got ${batch.length})`);
assert(batch.every((t) => t.length === 2), 'batch rows honor length');

const clampedCount = randomTailBatch({ minLen: 1, maxLen: 1, count: 500 });
assert(clampedCount.length === 200, `count 500 clamps to 200 (got ${clampedCount.length})`);

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log('\nall tail-fuzzer tests passed');
