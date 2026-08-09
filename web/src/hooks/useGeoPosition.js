import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Wraps navigator.geolocation.watchPosition. Requires HTTPS (or localhost)
 * — browsers refuse geolocation on plain HTTP. GitHub Pages serves over
 * HTTPS by default, so production is fine; local http://localhost:5173 is
 * also allowed by browsers for geolocation.
 *
 * status: 'idle' | 'requesting' | 'active' | 'denied' | 'unsupported' | 'error'
 */
export function useGeoPosition({ enabled }) {
  const [status, setStatus] = useState('idle');
  const [position, setPosition] = useState(null); // { lat, lng, accuracy } | null
  const [error, setError] = useState('');
  const watchIdRef = useRef(null);

  const stop = useCallback(() => {
    if (watchIdRef.current != null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setStatus('idle');
    setPosition(null);
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unsupported');
      return;
    }
    setStatus('requesting');
    setError('');
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setStatus('active');
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'error');
        setError(err.message || 'Location error');
      },
      // High accuracy + short max-age mirrors field walking pace (RN uses High + 3s interval).
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
  }, []);

  useEffect(() => {
    if (enabled) start();
    else stop();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, position, error, retry: start };
}
