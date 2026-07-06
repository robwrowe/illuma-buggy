import { useEffect, useRef, useState } from 'react';
import { getStatus, stopShow } from '../lib/ble/wandSimClient.js';

const POLL_MS = 350;

/** Poll WandSim /status while a show is active. Cleans up on unmount. */
export function useShowProgress(simIp) {
  const [progress, setProgress] = useState(null);
  const pollRef = useRef(null);

  const clearPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = (onDone) => {
    clearPoll();
    const ip = (simIp || '').trim();
    if (!ip) return;

    const tick = async () => {
      try {
        const st = await getStatus(ip);
        if (st.showActive) {
          setProgress({
            step: st.showStep ?? 0,
            total: st.showTotal ?? 0,
            active: true,
          });
        } else {
          setProgress((prev) => (prev ? { ...prev, active: false } : null));
          clearPoll();
          onDone?.(st);
        }
      } catch {
        clearPoll();
        setProgress(null);
        onDone?.(null);
      }
    };

    tick();
    pollRef.current = setInterval(tick, POLL_MS);
  };

  const stop = async () => {
    const ip = (simIp || '').trim();
    if (ip) {
      try { await stopShow(ip); } catch { /* ignore */ }
    }
    clearPoll();
    setProgress(null);
  };

  useEffect(() => () => clearPoll(), []);

  return { progress, startPolling, stop, clearProgress: () => setProgress(null) };
}
