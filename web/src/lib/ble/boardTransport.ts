import { webBleBoard } from './chunking';
import { REST_DEFAULT_HOST, REST_DEFAULT_PORT, webRestBoard } from './restTransport';

const BOARD_TRANSPORT_LS_KEY = 'illuma-buggy-board-transport';

export function loadBoardTransportSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(BOARD_TRANSPORT_LS_KEY) || '{}');
    const port = Number(stored.port);
    return {
      mode: stored.mode === 'rest' ? 'rest' : 'ble',
      host: (stored.host || REST_DEFAULT_HOST).trim() || REST_DEFAULT_HOST,
      port: Number.isFinite(port) && port > 0 ? port : REST_DEFAULT_PORT,
    };
  } catch {
    return { mode: 'ble', host: REST_DEFAULT_HOST, port: REST_DEFAULT_PORT };
  }
}

export function saveBoardTransportSettings(next) {
  const current = loadBoardTransportSettings();
  const merged = { ...current, ...next };
  try {
    localStorage.setItem(BOARD_TRANSPORT_LS_KEY, JSON.stringify(merged));
  } catch { /* ignore quota */ }
  return merged;
}

export function activeBoard(mode) {
  return mode === 'rest' ? webRestBoard : webBleBoard;
}

export function currentBoard() {
  return activeBoard(loadBoardTransportSettings().mode);
}
