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
 * @param {{ payloads: {hex_full: string, label?: string, tail_index?: number}[], hold_ms?: number, repeat?: number, zone_layout?: string, base_url?: string, onChunk?: function }} params
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
  const reports = [];
  let last = null;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    params?.onChunk?.(c, chunks.length, chunk.length);
    const timeoutMs = Math.max(120000, chunk.length * (hold + 4000) + 15000);
    const body = { ...params, payloads: chunk, hold_ms: hold };
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

export async function discover(baseUrl, minGroup = 3) {
  return jsonFetch(`${trimBase(baseUrl)}/discover?min_group=${minGroup}`, { method: 'POST' });
}
