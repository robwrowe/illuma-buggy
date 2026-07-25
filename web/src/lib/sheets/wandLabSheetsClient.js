import { getSheetsEndpoint } from './config';

/**
 * POST a Wand Lab finding to the shared Apps Script Web App.
 * Omits Content-Type so the browser skips CORS preflight (Apps Script
 * does not handle OPTIONS by default).
 */
export async function postFinding(entry) {
  const endpoint = getSheetsEndpoint();
  if (!endpoint) {
    console.warn('Wand Lab Sheets endpoint not configured — see Settings');
    return;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify({
      sheet: 'findings',
      rows: [{
        finding_id: entry.id,
        created_at: entry.createdAt ?? entry.ts,
        updated_at: Date.now(),
        opcode: entry.opcode,
        device_type: entry.deviceType,
        hex: entry.bytes,
        total_time_s: entry.totalTimeS,
        fade_time_s: entry.fadeTimeS,
        cycle_time_s: entry.cycleTimeS,
        num_cycles: entry.numCycles,
        colors: (entry.colors || []).join(','),
        layout: entry.layout,
        show: entry.show,
        notes: entry.notes ?? entry.note ?? '',
      }],
    }),
  });
  if (!res.ok) throw new Error(`Sheets write failed: ${res.status}`);
}
