const MAPS_KEY_STORAGE = 'maps-api-key';

let loadPromise = null;

export function getMapsApiKey() {
  return localStorage.getItem(MAPS_KEY_STORAGE) || '';
}

export function setMapsApiKey(key) {
  localStorage.setItem(MAPS_KEY_STORAGE, key);
}

/** @returns {Promise<typeof google>} */
export function loadGoogleMaps(apiKey) {
  const key = (apiKey ?? getMapsApiKey()).trim();
  if (!key) return Promise.reject(new Error('Google Maps API key not set'));
  if (typeof window !== 'undefined' && window.google?.maps) {
    return Promise.resolve(window.google);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const prev = window.initMap;
    window.initMap = () => {
      window.MAPS_LOADED = true;
      if (typeof prev === 'function') prev();
      resolve(window.google);
    };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=initMap&libraries=geometry`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });

  return loadPromise;
}

export function isMapsLoaded() {
  return !!(typeof window !== 'undefined' && window.google?.maps);
}
