const DEFAULT_PORT = 8080;

export class WebRestBoard {
  constructor() {
    this.host = null;      // e.g. "illuma-logic.local" or a raw IP
    this.port = DEFAULT_PORT;
    this.connected = false;
    this.connListeners = new Set();
  }

  get supported() {
    return typeof fetch !== 'undefined';
  }

  onConnectionChange(fn) {
    this.connListeners.add(fn);
    fn(this.connected);
    return () => this.connListeners.delete(fn);
  }

  // REST has no persistent "message" stream (unlike BLE notify) — commands
  // are request/response. Callers that previously did onMessage() + send()
  // for BLE should switch to awaiting send()'s return value directly.
  onMessage() {
    return () => {};
  }

  _setConnected(v) {
    this.connected = v;
    this.connListeners.forEach((fn) => fn(v));
  }

  async connect(host, port = DEFAULT_PORT) {
    this.host = host;
    this.port = port;
    const ok = await this.probe();
    this._setConnected(ok);
    if (!ok) throw new Error(`Could not reach board at ${host}:${port}`);
    return ok;
  }

  async probe() {
    if (!this.host) return false;
    try {
      const res = await fetch(`http://${this.host}:${this.port}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  disconnect() {
    this.host = null;
    this._setConnected(false);
  }

  /**
   * Send a command — single HTTP POST, full JSON body, no chunking.
   * Returns the parsed ack/response object (mirrors what BLE delivers via
   * onMessage for the same command types).
   */
  async send(msg) {
    if (!this.host) throw new Error('Not connected to IllumaBuggy (REST)');
    const res = await fetch(`http://${this.host}:${this.port}/cmd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      throw new Error(`Board returned HTTP ${res.status}`);
    }
    return res.json();
  }
}

export const webRestBoard = new WebRestBoard();
export const REST_DEFAULT_HOST = 'illuma-logic.local';
export const REST_DEFAULT_PORT = DEFAULT_PORT;
