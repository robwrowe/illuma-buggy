/** BLE write chunking — no BLEService import (avoids require cycles). */

export const BLE_MAX_WRITE_BYTES = 512;
export const BLE_CHUNK_INTER_MS = 25;

export function splitCommandForBleChunks(jsonStr: string): string[] {
  const pieces: string[] = [];
  let offset = 0;
  while (offset < jsonStr.length) {
    let lo = 1;
    let hi = jsonStr.length - offset;
    let best = 0;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const data = jsonStr.slice(offset, offset + mid);
      const isLast = offset + mid >= jsonStr.length;
      const envelope = JSON.stringify({ type: 'ble_cmd_chunk', seq: pieces.length, last: isLast, data });
      if (new TextEncoder().encode(envelope).length <= BLE_MAX_WRITE_BYTES) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (best < 1) throw new Error('BLE command too large to chunk');
    pieces.push(jsonStr.slice(offset, offset + best));
    offset += best;
  }
  return pieces;
}
