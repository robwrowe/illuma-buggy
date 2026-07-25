/**
 * Illuma Buggy — Wand Lab research log Apps Script
 *
 * Paste into: Google Sheet → Extensions → Apps Script
 * Deploy as Web App: Execute as Me, Anyone with the link.
 *
 * Sheet tabs (row 1 headers):
 *   findings: finding_id | created_at | updated_at | opcode | device_type | hex |
 *             total_time_s | fade_time_s | cycle_time_s | num_cycles | colors |
 *             layout | show | notes
 *   raw_captures: hex | opcode | first_seen_show | first_seen_ts | last_seen_ts |
 *                 times_seen | tested_in_wandlab | finding_id | best_rssi
 *   observations: observation_id | session_id | session_name | hex | opcode | tag |
 *                 board_ts | received_at | rssi | len | quality | func | label | note |
 *                 device_id | lat | lng | accuracy_m | gps_updated_at
 *
 * Optional: set SCRIPT_TOKEN and require body.token to match.
 */
const SCRIPT_TOKEN = ''; // e.g. 'your-secret' — leave blank to disable

/**
 * Browser GET /exec (and some POST→redirect→GET cases) hits doGet.
 * Without this, Google returns 404 "Script function not found: doGet".
 */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({
    ok: true,
    service: 'illuma-wandlab',
    hint: 'POST JSON { sheet, rows } to write. Redeploy as New version after edits.',
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  if (SCRIPT_TOKEN && body.token !== SCRIPT_TOKEN) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();

  if (body.sheet === 'findings') {
    const sheet = ss.getSheetByName('findings');
    body.rows.forEach((r) => {
      sheet.appendRow([
        r.finding_id, r.created_at, r.updated_at, r.opcode, r.device_type,
        r.hex, r.total_time_s, r.fade_time_s, r.cycle_time_s, r.num_cycles,
        r.colors, r.layout, r.show, r.notes,
      ]);
    });
    maybeBackfillFindingId(ss, body.rows);
  }

  if (body.sheet === 'raw_captures') {
    const sheet = ss.getSheetByName('raw_captures');
    const data = sheet.getDataRange().getValues();
    const hexCol = 0;
    const timesSeenCol = 5;
    const lastSeenCol = 4;
    const bestRssiCol = 8;
    body.rows.forEach((r) => {
      const idx = data.findIndex((row, i) => i > 0 && row[hexCol] === r.hex);
      if (idx === -1) {
        const row = [
          r.hex, r.opcode, r.first_seen_show, r.first_seen_ts,
          r.last_seen_ts, r.times_seen, false, '',
          r.best_rssi != null && r.best_rssi !== '' ? r.best_rssi : '',
        ];
        sheet.appendRow(row);
        data.push(row);
      } else {
        // idx is 0-based array index; sheet rows are 1-based → row = idx + 1
        const rowNum = idx + 1;
        const nextTimes = Number(data[idx][timesSeenCol] || 0) + Number(r.times_seen || 0);
        sheet.getRange(rowNum, timesSeenCol + 1).setValue(nextTimes);
        sheet.getRange(rowNum, lastSeenCol + 1).setValue(r.last_seen_ts);
        data[idx][timesSeenCol] = nextTimes;
        data[idx][lastSeenCol] = r.last_seen_ts;
        if (r.best_rssi != null && r.best_rssi !== '') {
          const existing = data[idx][bestRssiCol];
          if (existing === '' || existing == null || Number(r.best_rssi) > Number(existing)) {
            sheet.getRange(rowNum, bestRssiCol + 1).setValue(r.best_rssi);
            data[idx][bestRssiCol] = r.best_rssi;
          }
        }
      }
    });
  }

  if (body.sheet === 'observations') {
    const sheet = ss.getSheetByName('observations');
    body.rows.forEach((r) => {
      sheet.appendRow([
        r.observation_id, r.session_id, r.session_name, r.hex, r.opcode,
        r.tag, r.board_ts, r.received_at, r.rssi, r.len, r.quality,
        r.func, r.label, r.note, r.device_id, r.lat, r.lng,
        r.accuracy_m, r.gps_updated_at,
      ]);
    });
  }

  return ContentService.createTextOutput(JSON.stringify({ ok: true, wrote: body.sheet || null }))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Link findings → raw_captures when hex already exists. */
function maybeBackfillFindingId(ss, findingRows) {
  const raw = ss.getSheetByName('raw_captures');
  if (!raw) return;
  const data = raw.getDataRange().getValues();
  findingRows.forEach((f) => {
    const idx = data.findIndex((row, i) => i > 0 && row[0] === f.hex);
    if (idx === -1) return;
    const rowNum = idx + 1;
    raw.getRange(rowNum, 7).setValue(true); // tested_in_wandlab
    raw.getRange(rowNum, 8).setValue(f.finding_id);
  });
}
