/** Local wave-classifier backend client (tools/wave-classifier-server). */

export const DEFAULT_BACKEND_URL = 'http://localhost:8420';
export const OBSERVE_MAX_PAYLOADS = 10;
export const DEFAULT_OBSERVE_HOLD_MS = 4000;

function trimBase(baseUrl) {
  return String(baseUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
}

export function wandsimUrlFromIp(simIp) {
  const host = String(simIp || '').trim();
  if (!host) return '';
  if (/^https?:\/\//i.test(host)) return host.replace(/\/+$/, '');
  return `http://${host}`;
}

export function formatBackendDetail(detail, fallback = '') {
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (typeof d === 'string') return d;
      if (d && typeof d === 'object') return d.msg || d.message || JSON.stringify(d);
      return String(d);
    }).filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  if (detail && typeof detail === 'object') {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return fallback;
}

async function jsonFetch(url, opts = {}) {
  const ctrl = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 120000;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const msg = formatBackendDetail(data?.detail, data?.message || res.statusText);
      const err = new Error(msg || `HTTP ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(
        `Request timed out after ${Math.round(timeoutMs / 1000)}s — for long sweeps turn off `
        + 'Calibrate palette or use the CLI; calibration alone can take 10+ minutes.',
      );
    }
    if (err instanceof TypeError || /failed to fetch/i.test(String(err?.message || err))) {
      throw new Error(
        'Cannot reach wave-classifier backend — start it with '
        + '`uvicorn server:app --port 8420` in tools/wave-classifier-server, '
        + 'open the web app at http://localhost:5173 (not a LAN IP unless CORS matches), '
        + 'and confirm Wave-classifier backend shows reachable.',
      );
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

/** @returns {Promise<{ok: boolean, wave_classifier_version?: string} | null>} */
export async function backendHealth(baseUrl = DEFAULT_BACKEND_URL) {
  try {
    return await jsonFetch(`${trimBase(baseUrl)}/health`, { method: 'GET', timeoutMs: 2500 });
  } catch {
    return null;
  }
}

export async function buildPayload(baseUrl, params) {
  return jsonFetch(`${trimBase(baseUrl)}/build`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function buildBatch(baseUrl, params) {
  return jsonFetch(`${trimBase(baseUrl)}/build-batch`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/**
 * @param {string} backendUrl classifier server (localhost:8420)
 * @param {{ payloads: {hex_full: string, label?: string, tail_index?: number, color_count?: number, expected_colors?: object[]}[], hold_ms?: number, repeat?: number, zone_layout?: string, base_url?: string, timeline?: boolean, hz?: number, calibrate?: boolean, black_flash_ms?: number, also_classify?: boolean, onChunk?: function }} params
 *   `base_url` here is the WandSimulator board URL (same host as Send), not the classifier.
 */
export async function observe(backendUrl, params) {
  const payloads = Array.isArray(params?.payloads) ? params.payloads : [];
  const hold = Number(params?.hold_ms) > 0 ? Number(params.hold_ms) : DEFAULT_OBSERVE_HOLD_MS;
  const chunks = [];
  for (let i = 0; i < payloads.length; i += OBSERVE_MAX_PAYLOADS) {
    chunks.push(payloads.slice(i, i + OBSERVE_MAX_PAYLOADS));
  }
  if (!chunks.length) {
    throw new Error('payloads is empty');
  }
  const runId = chunks.length > 1
    ? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    : undefined;
  const reports = [];
  let last = null;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    params?.onChunk?.(c, chunks.length, chunk.length);
    const calibrateMs = (c === 0 && params?.calibrate) ? 900000 : 0;
    const timeoutMs = Math.max(
      180000,
      chunk.length * (hold + 8000) + 30000 + calibrateMs,
    );
    const body = {
      ...params,
      payloads: chunk,
      hold_ms: hold,
      calibrate: c === 0 ? !!params?.calibrate : false,
      ...(runId ? { run_id: runId, run_seq: c + 1, run_total_chunks: chunks.length } : {}),
    };
    delete body.onChunk;
    last = await jsonFetch(`${trimBase(backendUrl)}/observe`, {
      method: 'POST',
      body: JSON.stringify(body),
      timeoutMs,
    });
    reports.push(...(last?.reports || []));
  }
  return {
    ...(last || {}),
    reports,
    count: reports.length,
  };
}

export function reportFilenameFromPath(path) {
  const s = String(path || '').trim().replace(/\\/g, '/');
  if (!s) return '';
  const marker = '/reports/';
  const idx = s.lastIndexOf(marker);
  if (idx >= 0) return s.slice(idx + marker.length);
  const parts = s.split('/');
  const tl = parts.findIndex((p) => String(p).startsWith('timeline-'));
  if (tl >= 0) return parts.slice(tl).join('/');
  return parts[parts.length - 1] || '';
}

/** Fetch a reports/ file by path or basename (markdown/csv/json text). */
export async function fetchReport(backendUrl, filenameOrPath) {
  const name = reportFilenameFromPath(filenameOrPath);
  if (!name) throw new Error('missing report filename');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${trimBase(backendUrl)}/reports/${encodeURIComponent(name)}`, {
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        const data = JSON.parse(text);
        detail = formatBackendDetail(data?.detail, data?.message || res.statusText);
      } catch {
        /* keep text */
      }
      throw new Error(detail || `HTTP ${res.status}`);
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

export async function discover(baseUrl, minGroup = 3) {
  return jsonFetch(`${trimBase(baseUrl)}/discover?min_group=${minGroup}`, { method: 'POST' });
}
