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
 *                 board_ts_date | board_ts_time | received_at_date | received_at_time |
 *                 rssi | len | quality | func | label | note |
 *                 device_id | lat | lng | accuracy_m | gps_updated_at
 *                 (date = YYYY-MM-DD, time = HH:MM:SS — script timezone)
 *   byte_tags: finding_id | created_at | opcode | hex | byte_tags | linked_rule_id |
 *              generated_rule_id | notes
 *              (byte_tags is comma-separated "idx:kind" pairs, e.g. "0:signature,9:color";
 *               param entries are "idx:param:bitStart:bitCount:paramName";
 *               rgb-mode color entries are "idx:color:rgb:role:groupId", e.g. "10:color:rgb:r:grp1";
 *               palette-mode color entries are just "idx:color")
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

/** Split epoch-ms / ISO / Date into [YYYY-MM-DD, HH:MM:SS] in the script timezone. */
function splitTsDateTime(raw) {
  if (raw === '' || raw == null) return ['', ''];
  var d = null;
  if (Object.prototype.toString.call(raw) === '[object Date]') {
    d = raw;
  } else if (typeof raw === 'number' || (/^\d+$/).test(String(raw))) {
    var n = Number(raw);
    // seconds vs milliseconds
    if (n > 0 && n < 1e12) n *= 1000;
    d = new Date(n);
  } else {
    d = new Date(String(raw));
  }
  if (!d || isNaN(d.getTime())) return ['', ''];
  var tz = Session.getScriptTimeZone();
  return [
    Utilities.formatDate(d, tz, 'yyyy-MM-dd'),
    Utilities.formatDate(d, tz, 'HH:mm:ss'),
  ];
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
      const board = splitTsDateTime(r.board_ts);
      const recv = splitTsDateTime(r.received_at);
      sheet.appendRow([
        r.observation_id, r.session_id, r.session_name, r.hex, r.opcode,
        r.tag, board[0], board[1], recv[0], recv[1], r.rssi, r.len, r.quality,
        r.func, r.label, r.note, r.device_id, r.lat, r.lng,
        r.accuracy_m, r.gps_updated_at,
      ]);
    });
  }

  if (body.sheet === 'byte_tags') {
    const sheet = ss.getSheetByName('byte_tags');
    body.rows.forEach((r) => {
      sheet.appendRow([
        r.finding_id, r.created_at, r.opcode, r.hex, r.byte_tags,
        r.linked_rule_id, r.generated_rule_id, r.notes,
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
