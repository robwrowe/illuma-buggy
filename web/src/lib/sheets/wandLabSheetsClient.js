import { getSheetsEndpoint } from './config';

function assertAbsoluteSheetsUrl(endpoint) {
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new Error(
      'Wand Lab Sheets endpoint must be a full https:// URL (no quotes). Check Settings → General.',
    );
  }
}

/**
 * POST JSON to Apps Script as text/plain (CORS-simple — no OPTIONS preflight).
 * Apps Script doPost reads e.postData.contents either way.
 *
 * Response must include `{ ok: true, wrote: "<sheet>" }` from doPost.
 * A bare `{ ok: true }` from doGet means the browser followed a redirect as GET
 * and nothing was written.
 */
async function postToSheets(payload) {
  const endpoint = getSheetsEndpoint();
  if (!endpoint) {
    console.warn('Wand Lab Sheets endpoint not configured — see Settings');
    return;
  }
  assertAbsoluteSheetsUrl(endpoint);

  const res = await fetch(endpoint, {
    method: 'POST',
    // text/plain is a CORS-safelisted type (no preflight). application/json is not.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* non-JSON error page */
  }

  if (!res.ok) {
    if (text.includes('doGet') || text.includes('Script function not found')) {
      throw new Error(
        'Apps Script has no doGet (or POST became GET). Paste the updated script, then Deploy → Manage deployments → Edit → New version.',
      );
    }
    throw new Error(`Sheets write failed: ${res.status}`);
  }

  if (!data?.ok) {
    throw new Error(data?.error || 'Sheets write failed: unexpected response');
  }
  // doGet health-check returns ok but no `wrote` — treat as failed write
  if (!data.wrote) {
    throw new Error(
      'Request hit doGet instead of doPost (redirect). Redeploy Web App as New version with Access: Anyone, then retry.',
    );
  }
}

export async function postFinding(entry) {
  await postToSheets({
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
  });
}
