import { useCallback, useEffect, useMemo, useState } from 'react';
import { testPresetOnWled } from '../../lib/ble/chunking';
import { buildPaletteSelectOptions } from '../../lib/utils';
import { fetchWledCatalog, loadCachedWledCatalog } from '../../lib/wled/catalog';

/**
 * WLED IP / catalog / connect + test-on-strip status for the Presets tab.
 */
export function usePresetWled(data, sel) {
  const [wledIp, setWledIp] = useState(() => localStorage.getItem('wled-ip') || '4.3.2.1');
  const [wledStatus, setWledStatus] = useState('idle'); // idle | connecting | connected | error
  const [wledEffects, setWledEffects] = useState<any[]>([]);
  const [wledPalettes, setWledPalettes] = useState<any[]>([]);
  const [effectFilter, setEffectFilter] = useState('');
  const [presetTestStatus, setPresetTestStatus] = useState('idle'); // idle | testing | ok | error
  const [presetTestErr, setPresetTestErr] = useState('');

  useEffect(() => {
    const cached = loadCachedWledCatalog();
    if (cached.effects.length) setWledEffects(cached.effects);
    if (cached.palettes.length) setWledPalettes(cached.palettes);
    if (cached.effects.length || cached.palettes.length) setWledStatus('connected');
  }, []);

  const setWledIpPersisted = useCallback((value) => {
    setWledIp(value);
    if (typeof value === 'string' && value.trim()) {
      localStorage.setItem('wled-ip', value.trim());
    }
  }, []);

  const connectWled = useCallback(async () => {
    if (!wledIp.trim()) return;
    localStorage.setItem('wled-ip', wledIp.trim());
    setWledStatus('connecting');
    try {
      const { effects, palettes } = await fetchWledCatalog(wledIp);
      setWledEffects(effects);
      setWledPalettes(palettes);
      setWledStatus('connected');
    } catch {
      setWledStatus('error');
      alert(
        'Could not connect to WLED at ' +
          wledIp +
          '. Make sure your computer is on the same network as WLED (or StrollerNet).',
      );
    }
  }, [wledIp]);

  const paletteKnown = !!(sel && wledPalettes.some((p) => p.id === sel.global?.pal));

  const sortedEffects = useMemo(
    () => [...wledEffects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [wledEffects],
  );

  const filteredEffects = useMemo(() => {
    const q = effectFilter.trim().toLowerCase();
    if (!q) return sortedEffects;
    return sortedEffects.filter(
      (e) => e.name.toLowerCase().includes(q) || String(e.id).includes(q),
    );
  }, [sortedEffects, effectFilter]);

  const paletteOptions = useMemo(
    () => buildPaletteSelectOptions(wledPalettes, sel?.global, paletteKnown),
    [wledPalettes, sel?.global, paletteKnown],
  );

  const resetTestStatus = useCallback(() => {
    setPresetTestStatus('idle');
    setPresetTestErr('');
  }, []);

  const testPreset = useCallback(
    async (preset) => {
      setPresetTestErr('');
      setPresetTestStatus('testing');
      const ip = wledIp.trim();
      if (!ip) {
        setPresetTestStatus('error');
        setPresetTestErr('Enter a WLED IP in WLED Connect (left panel).');
        return;
      }
      localStorage.setItem('wled-ip', ip);
      try {
        await testPresetOnWled(ip, preset, data);
        setPresetTestStatus('ok');
        setTimeout(() => setPresetTestStatus('idle'), 2500);
      } catch {
        setPresetTestStatus('error');
        setPresetTestErr(
          `Could not reach WLED at ${ip}. Join StrollerNet or the same LAN as the controller.`,
        );
      }
    },
    [wledIp, data],
  );

  return {
    wledIp,
    setWledIp,
    setWledIpPersisted,
    wledStatus,
    setWledStatus,
    wledEffects,
    setWledEffects,
    wledPalettes,
    setWledPalettes,
    effectFilter,
    setEffectFilter,
    filteredEffects,
    paletteOptions,
    presetTestStatus,
    presetTestErr,
    setPresetTestErr,
    resetTestStatus,
    connectWled,
    testPreset,
  };
}
