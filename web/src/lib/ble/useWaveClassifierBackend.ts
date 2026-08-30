import { useEffect, useState } from 'react';
import { backendHealth, DEFAULT_BACKEND_URL } from './waveClassifierClient';
import { useWandLabUiState } from './wandLabUiState';

const DISABLED_TIP =
  'Local wave-classifier backend not running — see tools/wave-classifier-server/README.md';

/**
 * One health check per backend URL per session. Observe controls stay visible
 * but disabled (with tooltip) when the backend is unreachable.
 */
export function useWaveClassifierBackend() {
  const [baseUrl, setBaseUrl] = useWandLabUiState(
    'waveClassifierBackendUrl',
    DEFAULT_BACKEND_URL,
  );
  const [available, setAvailable] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChecked(false);
    backendHealth(baseUrl).then((res) => {
      if (cancelled) return;
      setAvailable(!!res?.ok);
      setChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  return {
    baseUrl,
    setBaseUrl,
    available,
    checked,
    disabledTip: available ? '' : DISABLED_TIP,
  };
}
