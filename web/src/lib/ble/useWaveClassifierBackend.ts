import { useCallback, useEffect, useState } from 'react';
import { backendHealth, DEFAULT_BACKEND_URL } from './waveClassifierClient';
import { useWandLabUiState } from './wandLabUiState';

const DISABLED_TIP =
  'Local wave-classifier backend not running — see tools/wave-classifier-server/README.md';

/**
 * Health-check the local classifier server. Re-probes when the URL changes,
 * when the window gains focus, and via `refresh()` (Observe click).
 */
export function useWaveClassifierBackend() {
  const [baseUrl, setBaseUrl] = useWandLabUiState(
    'waveClassifierBackendUrl',
    DEFAULT_BACKEND_URL,
  );
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);

  const probe = useCallback(async () => {
    const res = await backendHealth(baseUrl);
    const ok = !!res?.ok;
    setAvailable(ok);
    setChecked(true);
    return ok;
  }, [baseUrl]);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    backendHealth(baseUrl).then((res) => {
      if (cancelled) return;
      setAvailable(!!res?.ok);
      setChecked(true);
    });
    const onFocus = () => {
      backendHealth(baseUrl).then((res) => {
        if (!cancelled) setAvailable(!!res?.ok);
      });
    };
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [baseUrl]);

  return {
    baseUrl,
    setBaseUrl,
    available,
    checked,
    refresh: probe,
    disabledTip: available ? '' : DISABLED_TIP,
  };
}
