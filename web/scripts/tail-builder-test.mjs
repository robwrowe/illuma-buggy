#!/usr/bin/env node
/**
 * Smoke tests for web/src/lib/ble/tailBuilder.ts.
 * Usage: npm run test:tail-builder  (from web/)
 */
import { decodeMbColorMaskByte } from '../src/lib/ble/mbPayloads.ts';
import {
  assembleTailPayload,
  buildColorBlockBytes,
  encodeTailColorByte,
  omitConsecutiveDuplicateTails,
  parseTailBytes,
  parseTailLine,
  parseTailList,
} from '../src/lib/ble/tailBuilder.ts';

let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
  } else {
    console.log(`ok  — ${msg}`);
  }
}

function bytesEq(a, b) {
  return Array.isArray(a) && Array.isArray(b)
    && a.length === b.length
    && a.every((v, i) => v === b[i]);
}

const spaced = '58 F4 48 82 D1 46 02 08 D0 65 00';
const packed = '58F44882D1460208D06500';
const expectedTail = [0x58, 0xf4, 0x48, 0x82, 0xd1, 0x46, 0x02, 0x08, 0xd0, 0x65, 0x00];
assert(bytesEq(parseTailBytes(spaced), expectedTail), 'parseTailBytes spaced');
assert(bytesEq(parseTailBytes(packed), expectedTail), 'parseTailBytes packed (no spaces)');
assert(bytesEq(parseTailBytes(spaced), parseTailBytes(packed)), 'parseTailBytes spaced === packed');

const c0 = decodeMbColorMaskByte(0x56);
const c1 = decodeMbColorMaskByte(0x48);
const colors = [
  { kind: 'palette', paletteIdx: c0.palette, mask: c0.mask },
  { kind: 'palette', paletteIdx: c1.palette, mask: c1.mask },
];
assert(encodeTailColorByte(colors[0]) === 0x56, 'encodeTailColorByte 0x56');
assert(encodeTailColorByte(colors[1]) === 0x48, 'encodeTailColorByte 0x48');

const result = assembleTailPayload({
  timingByte: 0x6f,
  colorFormat: '0f',
  colors,
  tailBytes: parseTailBytes(spaced),
  vibration: 0,
  envelope: 'e1',
});
assert(
  result.hex === 'e100e911006f0f564858f44882d1460208d06500b0',
  `worked example hex (got ${result.hex})`,
);
assert(result.subOpcode === 0x11, `worked example subOpcode 0x11 (got 0x${result.subOpcodeHex})`);

const rgbBlock = buildColorBlockBytes('d2', [{ kind: 'rgb', r: 255, g: 0, b: 0 }]);
assert(bytesEq(rgbBlock, [0x55, 0xff, 0x00, 0x00]), 'D2 color block 55 FF 00 00');

assert(bytesEq(parseTailLine('0x30\t0x7B\t0x02\t\t\t'), [0x30, 0x7b, 0x02]), 'TSV 0xNN cells ignore empty columns');
assert(bytesEq(parseTailLine('0x30 0x7B 0x02'), [0x30, 0x7b, 0x02]), 'spaced 0xNN tokens');
assert(bytesEq(parseTailLine('FF FF FF FF'), [0xff, 0xff, 0xff, 0xff]), 'spaced raw FF FF FF FF');
assert(bytesEq(parseTailLine('FFFFFFFF'), [0xff, 0xff, 0xff, 0xff]), 'packed FFFFFFFF');
assert(bytesEq(parseTailLine('ffffffff'), [0xff, 0xff, 0xff, 0xff]), 'packed lowercase ffffffff');
assert(bytesEq(parseTailLine(spaced), expectedTail), 'parseTailLine spaced pairs (no 0x)');

const sheetPaste = [
  '0x30\t0x7B\t0x02\t\t\t\t',
  '0x30\t0x7B\t0x00\t\t\t\t',
  '0x30\t0x7B\t0x00\t\t\t\t',
  '0x30\t0xD0\t0x37\t0xF4\t0xD2\t0x46\t0x00\t0x64\t0x64\t\t',
  '0x30\t0xD0\t0x37\t0xF4\t0xD2\t0x46\t0x00\t0x64\t0x64\t\t',
  '0x58\t0xF4\t0x48\t0x82\t0xD1\t0x46\t0x09\t0x08\t0xD0\t0x65\t0x19',
].join('\n');
const listed = parseTailList(sheetPaste);
assert(listed.tails.length === 6, `parseTailList keeps all 6 lines (got ${listed.tails.length})`);
assert(bytesEq(listed.tails[0].bytes, [0x30, 0x7b, 0x02]), 'list row 0');
assert(bytesEq(listed.tails[3].bytes, [0x30, 0xd0, 0x37, 0xf4, 0xd2, 0x46, 0x00, 0x64, 0x64]), 'list D0 37 F4 row');
const unique = omitConsecutiveDuplicateTails(listed.tails);
assert(unique.length === 4, `omit consecutive dupes 6 → 4 (got ${unique.length})`);
assert(unique[1].hex === listed.tails[1].hex, 'first 0x00 row kept, consecutive copy dropped');

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log('\nAll tail-builder assertions passed.');
