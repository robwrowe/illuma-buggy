import { getSheetsEndpoint } from './config';

function assertAbsoluteSheetsUrl(endpoint) {
  if (!/^https?:\/\//i.test(endpoint)) {
    throw new Error(
      'Wand Lab Sheets endpoint must be a full https:// URL (no quotes). Check Settings → General.',
    );
  }
}

/** Compact string for the Sheets `byte_tags` column (and local export). */
export function serializeByteTags(byteTags) {
  return (byteTags || [])
    .map((t, i) => {
      if (!t) return null;
      if (t.kind === 'param') {
        const d = t.detail || {};
        return `${i}:param:${d.bitStart ?? 0}:${d.bitCount ?? 8}:${(d.paramName || '').replace(/[:,]/g, '_')}`;
      }
      if (t.kind === 'color' && t.detail?.mode === 'rgb') {
        return `${i}:color:rgb:${t.detail.channelRole}:${(t.detail.groupId || '').replace(/[:,]/g, '_')}`;
      }
      return `${i}:${t.kind}`;
    })
    .filter(Boolean)
    .join(',');
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
    throw new Error(
      'Sheets endpoint not set — open Settings → General and paste the Apps Script Web App URL.',
    );
  }
  assertAbsoluteSheetsUrl(endpoint);

  console.info('[Sheets] POST', payload.sheet, '→', endpoint.slice(0, 60) + '…', {
    rows: Array.isArray(payload.rows) ? payload.rows.length : 0,
  });

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

  console.info('[Sheets] response', res.status, data || text.slice(0, 240));

  if (!res.ok) {
    if (text.includes('doGet') || text.includes('Script function not found')) {
      throw new Error(
        'Apps Script has no doGet (or POST became GET). Paste the updated script, then Deploy → Manage deployments → Edit → New version.',
      );
    }
    throw new Error(`Sheets write failed: ${res.status} ${text.slice(0, 120)}`);
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
  if (payload.sheet && data.wrote !== payload.sheet) {
    throw new Error(
      `Sheets wrote "${data.wrote}" but expected "${payload.sheet}". Redeploy the latest Apps Script.`,
    );
  }
  // Old scripts echoed body.sheet as `wrote` even when they ignored unknown tabs.
  // New scripts also return spreadsheetId / rows after a real append.
  if (data.rows == null && data.spreadsheetId == null) {
    throw new Error(
      `Sheets returned wrote="${data.wrote}" without row proof — the Web App is likely an old deployment that ignored this tab. Paste docs/wand-lab-sheets-apps-script.js and Deploy → New version.`,
    );
  }
  return data;
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

/**
 * entry.byteTags: array aligned to entry.hex bytes; each element is either null or
 * `{ kind, detail }`.
 * entry.linkedRuleId: existing rule id this finding maps to, or '' if none.
 * entry.generatedRuleId: id of a rule this finding created, or '' if none.
 */
export async function postByteTagFinding(entry) {
  const hex = entry.hex || entry.bytes || '';
  await postToSheets({
    sheet: 'byte_tags',
    rows: [{
      finding_id: entry.id,
      created_at: entry.createdAt ?? entry.ts,
      opcode: entry.opcode,
      hex,
      byte_tags: entry.byteTagsSerialized || serializeByteTags(entry.byteTags),
      linked_rule_id: entry.linkedRuleId || '',
      generated_rule_id: entry.generatedRuleId || '',
      notes: entry.notes ?? entry.note ?? '',
    }],
  });
}

/** Route a log entry to the correct Sheets tab. */
export async function postLogEntryToSheets(entry) {
  if (entry?.kind === 'byte_tags' || entry?.sheetsTarget === 'byte_tags') {
    await postByteTagFinding(entry);
    return;
  }
  await postFinding(entry);
}
