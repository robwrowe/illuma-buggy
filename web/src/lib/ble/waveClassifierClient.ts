/** Local wave-classifier backend client (tools/wave-classifier-server). */

export const DEFAULT_BACKEND_URL = 'http://localhost:8420';

function trimBase(baseUrl) {
  return String(baseUrl || DEFAULT_BACKEND_URL).replace(/\/+$/, '');
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
      const detail = data?.detail;
      const msg = typeof detail === 'string' ? detail : (data?.message || res.statusText);
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
 * @param {string} baseUrl
 * @param {{ payloads: {hex_full: string, label?: string, tail_index?: number}[], hold_ms?: number, repeat?: number, zone_layout?: string, base_url?: string }} params
 */
export async function observe(baseUrl, params) {
  const n = params?.payloads?.length || 0;
  const hold = params?.hold_ms || 4000;
  const timeoutMs = Math.max(120000, n * (hold + 4000) + 15000);
  return jsonFetch(`${trimBase(baseUrl)}/observe`, {
    method: 'POST',
    body: JSON.stringify(params),
    timeoutMs,
  });
}

export async function discover(baseUrl, minGroup = 3) {
  return jsonFetch(`${trimBase(baseUrl)}/discover?min_group=${minGroup}`, { method: 'POST' });
}
