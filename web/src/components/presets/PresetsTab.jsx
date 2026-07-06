import { useState, useEffect, useMemo } from 'react';
import {
  ActionIcon,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Slider,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ColorCell } from '../shared/ColorCell';
import { Field } from '../shared/Field';
import { Modal } from '../shared/Modal';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SegmentBar } from '../shared/SegmentBar';
import { TagChipRow } from '../shared/TagChipRow';
import { TagEditor } from '../shared/TagEditor';
import { TagFilterBar } from '../shared/TagFilterBar';
import { AppButton } from '../shared/styles';
import { testPresetOnWled } from '../../lib/ble/chunking';
import { duplicateTaggedName, itemMatchesTagFilter } from '../../lib/tags';
import { MAX_EFFECT_COLORS, buildPaletteSelectOptions, generateId, hexListToWledCol, paletteSelectValue, saveColorToLibrary, wledColToHexList } from '../../lib/utils';
import { DEFAULT_WLED_CAPTURE_OPTS, applyWledStateCapture, fetchWledFullStateFromIp, formatSegLabel, summarizeLayout, wledCaptureLabels } from '../../lib/wled/capture';
import { fetchWledCatalog, loadCachedWledCatalog } from '../../lib/wled/catalog';

const PRESET_SUB_TABS = ['effect', 'palette', 'colors', 'segments', 'params', 'memory'];

export function PresetsTab({ data, update }) {
  const [sel, setSel] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [ptab, setPtab] = useState('effect');
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);

  const filteredPresets = useMemo(
    () => (data.presets || []).filter(p => itemMatchesTagFilter(p, search, activeTag)),
    [data.presets, search, activeTag],
  );

  // WLED connection
  const [wledIp, setWledIp] = useState(localStorage.getItem('wled-ip') || '4.3.2.1');
  const [wledStatus, setWledStatus] = useState('idle'); // idle | connecting | connected | error
  const [wledEffects, setWledEffects] = useState([]);
  const [wledPalettes, setWledPalettes] = useState([]);
  const [effectFilter, setEffectFilter] = useState('');
  const [presetTestStatus, setPresetTestStatus] = useState('idle'); // idle | testing | ok | error
  const [presetTestErr, setPresetTestErr] = useState('');
  const [showCapture, setShowCapture] = useState(false);
  const [captureOpts, setCaptureOpts] = useState(() => ({ ...DEFAULT_WLED_CAPTURE_OPTS }));
  const [captureUpdateMemory, setCaptureUpdateMemory] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [captureErr, setCaptureErr] = useState('');

  useEffect(() => {
    const cached = loadCachedWledCatalog();
    if (cached.effects.length) setWledEffects(cached.effects);
    if (cached.palettes.length) setWledPalettes(cached.palettes);
    if (cached.effects.length || cached.palettes.length) setWledStatus('connected');
  }, []);

  const blank = () => ({
    id: generateId(), name: '', createdAt: Date.now(), tags: [],
    wled: { on: true, fx: undefined, fxName: '', pal: undefined, palName: '', sx: 128, ix: 128, c1: 128, c2: 128, c3: 16, o1: false, o2: false, o3: false },
    memory: { effect: true, palette: true, parameters: true, color: false, segments: false },
  });

  const duplicatePreset = (p) => {
    const copy = {
      ...p,
      id: generateId(),
      name: duplicateTaggedName(p.name),
      tags: [...(p.tags || [])],
      createdAt: Date.now(),
      wled: JSON.parse(JSON.stringify(p.wled)),
      memory: { ...p.memory },
    };
    update({ presets: [...data.presets, copy] });
    setSel(copy);
    setIsNew(false);
    setPtab('effect');
  };

  const save = () => {
    if (!sel.name.trim()) return alert('Enter a name');
    update({ presets: isNew ? [...data.presets, sel] : data.presets.map(p => p.id === sel.id ? sel : p) });
    setSel(null);
  };
  const del = id => { if (confirm('Delete this preset?')) { update({ presets: data.presets.filter(p => p.id !== id) }); setSel(null); } };
  const w = (k, v) => setSel(s => ({ ...s, wled: { ...s.wled, [k]: v } }));
  const m = (k, v) => setSel(s => ({ ...s, memory: { ...s.memory, [k]: v } }));

  const connectWled = async () => {
    if (!wledIp.trim()) return;
    localStorage.setItem('wled-ip', wledIp);
    setWledStatus('connecting');
    try {
      const { effects, palettes } = await fetchWledCatalog(wledIp);
      setWledEffects(effects);
      setWledPalettes(palettes);
      setWledStatus('connected');
    } catch (e) {
      setWledStatus('error');
      alert('Could not connect to WLED at ' + wledIp + '. Make sure your computer is on the same network as WLED (or StrollerNet).');
    }
  };

  const paletteKnown = sel && (
    wledPalettes.some(p => p.id === sel.wled.pal)
  );
  const sortedEffects = useMemo(
    () => [...wledEffects].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [wledEffects],
  );
  const filteredEffects = useMemo(() => {
    const q = effectFilter.trim().toLowerCase();
    if (!q) return sortedEffects;
    return sortedEffects.filter(e =>
      e.name.toLowerCase().includes(q) || String(e.id).includes(q),
    );
  }, [sortedEffects, effectFilter]);
  const paletteOptions = useMemo(
    () => buildPaletteSelectOptions(wledPalettes, sel?.wled, paletteKnown),
    [wledPalettes, sel?.wled, paletteKnown],
  );

  const testPreset = async (preset) => {
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
      setPresetTestErr(`Could not reach WLED at ${ip}. Join StrollerNet or the same LAN as the controller.`);
    }
  };

  const applyPalettePick = (v) => {
    if (!v) {
      setSel(s => ({ ...s, wled: { ...s.wled, pal: undefined, palName: '' } }));
      return;
    }
    if (v.startsWith('wled:')) {
      const id = parseInt(v.slice(5), 10);
      const pal = wledPalettes.find(p => p.id === id);
      setSel(s => ({ ...s, wled: { ...s.wled, pal: id, palName: pal?.name || s.wled.palName } }));
    }
  };

  const savedColors = data.savedColors || [];
  const saveColor = (hex) => saveColorToLibrary(data, update, hex);
  const effectHexes = sel ? wledColToHexList(sel.wled.col) : [];
  const setEffectHexes = (hexes) => {
    const col = hexListToWledCol(hexes);
    setSel(s => ({
      ...s,
      wled: { ...s.wled, col },
      memory: { ...s.memory, color: hexes.length > 0 ? true : s.memory.color },
    }));
  };

  const toggleCaptureOpt = (k) => setCaptureOpts(o => ({ ...o, [k]: !o[k] }));
  const setAllCaptureOpts = (v) => setCaptureOpts(Object.fromEntries(Object.keys(DEFAULT_WLED_CAPTURE_OPTS).map(k => [k, v])));

  const runCaptureFromWled = async () => {
    if (!Object.values(captureOpts).some(Boolean)) {
      setCaptureErr('Select at least one property to import.');
      return;
    }
    setCapturing(true);
    setCaptureErr('');
    try {
      const ip = wledIp.trim();
      if (!ip) throw new Error('Enter a WLED IP in WLED Connect (left panel).');
      localStorage.setItem('wled-ip', ip);
      let effects = wledEffects;
      let palettes = wledPalettes;
      const state = await fetchWledFullStateFromIp(ip);
      if (!effects.length || !palettes.length) {
        try {
          const cat = await fetchWledCatalog(ip);
          effects = cat.effects;
          palettes = cat.palettes;
          setWledEffects(effects);
          setWledPalettes(palettes);
          setWledStatus('connected');
        } catch { /* names may fall back to IDs */ }
      }
      setSel(s => applyWledStateCapture(s, state, {
        effects, palettes,
      }, captureOpts, captureUpdateMemory));
      setShowCapture(false);
      setCaptureErr('');
    } catch (e) {
      setCaptureErr(e.message || 'Capture failed');
    } finally {
      setCapturing(false);
    }
  };

  const selectPreset = (p) => {
    setSel({ ...p, wled: { ...p.wled }, memory: { ...p.memory } });
    setIsNew(false);
    setPtab('effect');
    setPresetTestStatus('idle');
    setPresetTestErr('');
  };

  return (
    <Box style={{ display: 'flex', height: '100%' }}>
      {/* List */}
      <Box
        w={240}
        bg="var(--surface)"
        style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        <Group justify="space-between" align="center" px="sm" py="xs" style={{ borderBottom: '1px solid var(--border)' }}>
          <Text fw={700} size="sm">Presets ({data.presets.length})</Text>
          <AppButton
            variant="primary"
            size="compact-xs"
            onClick={() => { setSel(blank()); setIsNew(true); setPtab('effect'); }}
          >
            + New
          </AppButton>
        </Group>

        {/* WLED connect */}
        <Paper p="xs" radius={0} bg="var(--surface2)" style={{ borderBottom: '1px solid var(--border)' }}>
          <Stack gap={6}>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }}>WLED Connect</Text>
            <Group gap={4} wrap="nowrap">
              <TextInput
                value={wledIp}
                onChange={e => setWledIp(e.target.value)}
                placeholder="192.168.x.x or 4.3.2.1"
                size="xs"
                style={{ flex: 1 }}
                onKeyDown={e => e.key === 'Enter' && connectWled()}
              />
              <AppButton
                variant={wledStatus === 'connected' ? 'success' : 'primary'}
                size="compact-xs"
                onClick={connectWled}
                style={{ whiteSpace: 'nowrap' }}
              >
                {wledStatus === 'connecting' ? '…' : wledStatus === 'connected' ? '✓' : wledStatus === 'error' ? '✕' : 'Go'}
              </AppButton>
            </Group>
            {wledStatus === 'connected' && (
              <Text size="xs" c="green">{wledEffects.length} effects · {wledPalettes.length} palettes loaded</Text>
            )}
            {wledStatus === 'error' && (
              <Text size="xs" c="red">Connection failed — check IP and network</Text>
            )}
          </Stack>
        </Paper>

        <TagFilterBar items={data.presets} search={search} onSearchChange={setSearch}
          activeTag={activeTag} onActiveTagChange={setActiveTag} />

        <ScrollArea style={{ flex: 1 }}>
          {data.presets.length === 0 && (
            <Text p="md" size="sm" c="dimmed">No presets yet.</Text>
          )}
          {data.presets.length > 0 && filteredPresets.length === 0 && (
            <Text p="md" size="sm" c="dimmed">No matches.</Text>
          )}
          {filteredPresets.map(p => (
            <Box
              key={p.id}
              onClick={() => selectPreset(p)}
              p="sm"
              style={{
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                background: sel?.id === p.id ? 'var(--primary-dim)' : 'transparent',
              }}
            >
              <Group gap={6} wrap="nowrap" align="flex-start">
                <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={600} size="sm">{p.name}</Text>
                  <TagChipRow tags={p.tags} />
                  <Text size="xs" c="dimmed">
                    {p.wled.fxName || '—'} · {p.wled.palName || '—'}
                    {p.segmentLayoutId && (() => {
                      const lay = (data.customSegmentLayouts || []).find(l => l.id === p.segmentLayoutId);
                      return lay ? ` · ${lay.name}` : ' · layout';
                    })()}
                  </Text>
                </Stack>
                <ActionIcon
                  variant="default"
                  size="sm"
                  title="Duplicate"
                  onClick={e => { e.stopPropagation(); duplicatePreset(p); }}
                >
                  ⧉
                </ActionIcon>
                <ActionIcon
                  variant="filled"
                  size="sm"
                  title="Test on strip"
                  onClick={e => { e.stopPropagation(); testPreset(p); }}
                >
                  ▶
                </ActionIcon>
              </Group>
            </Box>
          ))}
        </ScrollArea>
      </Box>

      {/* Edit panel */}
      {sel ? (
        <ScrollArea style={{ flex: 1 }}>
          <Stack p="lg" gap="sm">
            <Group justify="space-between" align="center" wrap="nowrap">
              <TextInput
                value={sel.name}
                onChange={e => setSel({ ...sel, name: e.target.value })}
                placeholder="Preset name"
                size="md"
                fw={600}
                style={{ flex: 1, marginRight: 12 }}
              />
              <Group gap="xs" wrap="nowrap">
                <AppButton
                  type="button"
                  variant="default"
                  size="compact-sm"
                  onClick={() => { setCaptureOpts({ ...DEFAULT_WLED_CAPTURE_OPTS }); setCaptureErr(''); setShowCapture(true); }}
                  title="Import live strip state from WLED"
                >
                  Import from WLED
                </AppButton>
                <AppButton
                  type="button"
                  variant={presetTestStatus === 'ok' ? 'success' : 'primary'}
                  size="compact-sm"
                  onClick={() => testPreset(sel)}
                  disabled={presetTestStatus === 'testing'}
                >
                  {presetTestStatus === 'testing' ? 'Testing…' : presetTestStatus === 'ok' ? 'Sent ✓' : 'Test on strip'}
                </AppButton>
                {!isNew && (
                  <AppButton variant="danger" size="compact-sm" onClick={() => del(sel.id)}>Delete</AppButton>
                )}
                {!isNew && (
                  <AppButton variant="default" size="compact-sm" onClick={() => duplicatePreset(sel)}>Duplicate</AppButton>
                )}
                <AppButton variant="default" size="compact-sm" onClick={() => setSel(null)}>Cancel</AppButton>
                <AppButton variant="primary" size="compact-sm" onClick={save}>Save</AppButton>
              </Group>
            </Group>

            {presetTestErr && (
              <Paper p="sm" radius="md" bg="#ef444422" style={{ border: '1px solid var(--danger)' }}>
                <Text size="sm" c="red">{presetTestErr}</Text>
              </Paper>
            )}
            {!presetTestErr && presetTestStatus === 'ok' && (
              <Text size="sm" c="green">Preset sent to WLED at {wledIp.trim()}.</Text>
            )}

            <TagEditor tags={sel.tags || []} onChange={tags => setSel({ ...sel, tags })} />

            {/* Sub-tabs */}
            <Tabs value={ptab} onChange={setPtab}>
              <Tabs.List>
                {PRESET_SUB_TABS.map(t => (
                  <Tabs.Tab key={t} value={t}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>

            {/* Effect tab */}
            {ptab === 'effect' && (
              <Stack gap="sm" maw={520}>
                {sel.wled.fx != null && sel.wled.fx !== '' && (
                  <Paper p="sm" radius="md" bg="var(--primary-dim)" style={{ border: '1px solid var(--border)' }}>
                    <Text size="xs" c="dimmed" mb={2}>Selected</Text>
                    <Text size="sm" fw={600}>
                      {sel.wled.fxName || 'Unnamed effect'}
                      <Text component="span" fw={400} c="dimmed" ml={6}>#{sel.wled.fx}</Text>
                    </Text>
                  </Paper>
                )}
                {wledEffects.length > 0 ? (
                  <>
                    <Field label={`Filter effects (${filteredEffects.length} of ${wledEffects.length})`}>
                      <TextInput
                        value={effectFilter}
                        onChange={e => setEffectFilter(e.target.value)}
                        placeholder="Type to filter by name or ID…"
                      />
                    </Field>
                    <ScrollArea.Autosize mah={360} style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
                      {filteredEffects.length === 0 && (
                        <Text p="md" size="sm" c="dimmed" ta="center">No effects match</Text>
                      )}
                      {filteredEffects.map(eff => (
                        <Box
                          key={eff.id}
                          onClick={() => setSel(s => ({ ...s, wled: { ...s.wled, fx: eff.id, fxName: eff.name } }))}
                          p="sm"
                          style={{
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border)',
                            background: sel.wled.fx === eff.id ? 'var(--primary-dim)' : 'transparent',
                            color: sel.wled.fx === eff.id ? 'var(--primary)' : 'var(--text)',
                          }}
                        >
                          <Text size="sm" component="span">{eff.name}</Text>
                          <Text size="xs" c="dimmed" component="span" ml={6}>#{eff.id}</Text>
                        </Box>
                      ))}
                    </ScrollArea.Autosize>
                    {sel.wled.fx != null && sel.wled.fx !== '' && (
                      <AppButton
                        type="button"
                        variant="default"
                        size="compact-sm"
                        onClick={() => setSel(s => ({ ...s, wled: { ...s.wled, fx: undefined, fxName: '' } }))}
                        style={{ alignSelf: 'flex-start' }}
                      >
                        Clear selection
                      </AppButton>
                    )}
                  </>
                ) : (
                  <Text size="xs" c="dimmed">
                    Use WLED Connect in the left panel to fetch the effect list. Lists are cached in the browser after the first successful connect.
                  </Text>
                )}
                <Box component="details">
                  <Box component="summary" style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <Text size="sm" c="dimmed">Manual override</Text>
                  </Box>
                  <Stack gap="sm" mt="sm">
                    <Field label="Effect name">
                      <TextInput
                        value={sel.wled.fxName || ''}
                        onChange={e => w('fxName', e.target.value)}
                        placeholder="e.g. Rainbow"
                      />
                    </Field>
                    <Field label="Effect ID">
                      <NumberInput
                        value={sel.wled.fx ?? ''}
                        onChange={v => w('fx', v === '' || v == null ? undefined : parseInt(String(v), 10))}
                        placeholder="0"
                        hideControls
                      />
                    </Field>
                  </Stack>
                </Box>
              </Stack>
            )}

            {/* Palette tab */}
            {ptab === 'palette' && (
              <Stack gap="sm" maw={520}>
                <Field label="Color palette">
                  <SearchableSelect value={paletteSelectValue(sel.wled)} onChange={applyPalettePick}
                    placeholder="— Select palette —" maxListHeight={320}
                    options={paletteOptions} />
                </Field>
                {sel.wled.pal != null && sel.wled.pal !== '' && (
                  <Text size="sm" c="dimmed">
                    {sel.wled.palName || 'Unnamed palette'} · ID {sel.wled.pal}
                  </Text>
                )}
                {wledPalettes.length === 0 && (
                  <Text size="xs" c="dimmed">
                    Connect to WLED to load palette names from the controller catalog.
                  </Text>
                )}
                <Box component="details">
                  <Box component="summary" style={{ cursor: 'pointer', userSelect: 'none' }}>
                    <Text size="sm" c="dimmed">Manual override</Text>
                  </Box>
                  <Stack gap="sm" mt="sm">
                    <Field label="Palette name">
                      <TextInput
                        value={sel.wled.palName || ''}
                        onChange={e => w('palName', e.target.value)}
                        placeholder="e.g. Rainbow"
                      />
                    </Field>
                    <Field label="Palette ID">
                      <NumberInput
                        value={sel.wled.pal ?? ''}
                        onChange={v => w('pal', v === '' || v == null ? undefined : parseInt(String(v), 10))}
                        placeholder="0"
                        hideControls
                      />
                    </Field>
                  </Stack>
                </Box>
              </Stack>
            )}

            {/* Colors tab — WLED effect col */}
            {ptab === 'colors' && (
              <Stack gap="sm" maw={520}>
                <Text size="sm" c="dimmed" lh={1.5}>
                  Effect colors (WLED <Text component="code" ff="monospace" span>col</Text>). Used for solid, dual, triple, and similar effects.
                  Honored when Settings → Recall State includes color (or preset memory has color checked).
                </Text>
                {effectHexes.length === 0 && (
                  <Text size="sm" c="dimmed">No effect colors set — add one for effects that use custom RGB instead of a palette.</Text>
                )}
                <SimpleGrid cols={2} spacing="sm">
                  {effectHexes.map((hex, i) => (
                    <Stack key={i} gap={6}>
                      <Text size="xs" fw={700} c="dimmed">Color {i + 1}</Text>
                      <ColorCell color={hex} savedColors={savedColors} onSaveColor={saveColor}
                        onRemove={effectHexes.length > 1 ? () => {
                          const next = effectHexes.filter((_, j) => j !== i);
                          setEffectHexes(next);
                        } : null}
                        onChange={nc => {
                          const next = [...effectHexes];
                          next[i] = nc;
                          setEffectHexes(next);
                        }} />
                    </Stack>
                  ))}
                </SimpleGrid>
                {effectHexes.length < MAX_EFFECT_COLORS && (
                  <AppButton
                    type="button"
                    variant="default"
                    size="compact-sm"
                    onClick={() => setEffectHexes([...effectHexes, '#ffffff'])}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    + Add color ({effectHexes.length}/{MAX_EFFECT_COLORS})
                  </AppButton>
                )}
                {effectHexes.length > 0 && (
                  <AppButton
                    type="button"
                    variant="danger"
                    size="compact-sm"
                    onClick={() => setEffectHexes([])}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    Clear all colors
                  </AppButton>
                )}
                <Field label="Remember color at recall">
                  <Checkbox
                    label='Include in preset when global recall is "memory"'
                    checked={sel.memory.color}
                    onChange={e => m('color', e.target.checked)}
                  />
                </Field>
              </Stack>
            )}

            {/* Segments tab — link saved layout library item */}
            {ptab === 'segments' && (
              <Stack gap="sm" maw={520}>
                <Text size="sm" c="dimmed">
                  Linked layout applies when recall includes segments (Settings → Recall State). Import from WLED to capture inline layout, or pick a saved layout from Palettes → Segments.
                </Text>
                {sel.wled.seg?.length > 0 && !sel.segmentLayoutId && (
                  <Paper p="sm" radius="md" bg="var(--primary-dim)" style={{ border: '1px solid var(--primary)' }}>
                    <Group gap="sm" mb={6} wrap="nowrap">
                      <Text size="sm" fw={600} style={{ flex: 1 }}>Inline layout (imported)</Text>
                      <AppButton
                        type="button"
                        variant="danger"
                        size="compact-xs"
                        onClick={() => setSel(s => ({ ...s, wled: { ...s.wled, seg: undefined }, memory: { ...s.memory, segments: false } }))}
                      >
                        Clear
                      </AppButton>
                    </Group>
                    <SegmentBar segments={sel.wled.seg} />
                    <Text size="xs" c="dimmed" mt={4} ff="monospace">
                      {sel.wled.seg.map(s => {
                        const fxPart = s.fx != null ? `fx:${s.fx}` : `fx:${sel.wled.fx ?? '-'}`;
                        const palPart = s.pal != null ? `pal:${s.pal}` : `pal:${sel.wled.pal ?? '-'}`;
                        return `${formatSegLabel(s)} · ${fxPart} · ${palPart}`;
                      }).join(' · ')}
                    </Text>
                  </Paper>
                )}
                <Paper
                  p="sm"
                  radius="md"
                  bg={!sel.segmentLayoutId && !sel.wled.seg?.length ? 'var(--primary-dim)' : 'var(--surface2)'}
                  style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
                  onClick={() => setSel(s => ({ ...s, segmentLayoutId: undefined, wled: { ...s.wled, seg: undefined }, memory: { ...s.memory, segments: false } }))}
                >
                  <Group gap="sm" wrap="nowrap">
                    <Text size="sm" style={{ flex: 1 }}>None (single segment only)</Text>
                    {!sel.segmentLayoutId && !sel.wled.seg?.length && (
                      <Text c="var(--primary)">✓</Text>
                    )}
                  </Group>
                </Paper>
                {(data.customSegmentLayouts || []).length === 0 && (
                  <Text size="sm" c="dimmed">No segment layouts yet — add them on the Palettes tab.</Text>
                )}
                {(data.customSegmentLayouts || []).map(layout => (
                  <Paper
                    key={layout.id}
                    p="sm"
                    radius="md"
                    bg={sel.segmentLayoutId === layout.id ? 'var(--primary-dim)' : 'var(--surface2)'}
                    style={{ border: '1px solid var(--border)', cursor: 'pointer' }}
                    onClick={() => setSel(s => ({
                      ...s, segmentLayoutId: layout.id, memory: { ...s.memory, segments: true },
                      wled: { ...s.wled, seg: undefined },
                    }))}
                  >
                    <Group gap="sm" mb={6} wrap="nowrap">
                      <Text size="sm" fw={600} style={{ flex: 1 }}>{layout.name}</Text>
                      {sel.segmentLayoutId === layout.id && (
                        <Text c="var(--primary)">✓</Text>
                      )}
                    </Group>
                    <SegmentBar segments={layout.segments} />
                    <Text size="xs" c="dimmed" mt={4} ff="monospace">{summarizeLayout(layout)}</Text>
                  </Paper>
                ))}
                {(sel.segmentLayoutId || sel.wled.seg?.length > 0) && (
                  <Field label="Remember segments at recall">
                    <Checkbox
                      checked={sel.memory.segments}
                      onChange={e => m('segments', e.target.checked)}
                    />
                  </Field>
                )}
              </Stack>
            )}

            {/* Params tab */}
            {ptab === 'params' && (
              <SimpleGrid cols={2} spacing="md">
                {[{ k: 'sx', label: 'Speed', max: 255 }, { k: 'ix', label: 'Intensity', max: 255 }, { k: 'c1', label: 'Custom 1', max: 255 }, { k: 'c2', label: 'Custom 2', max: 255 }, { k: 'c3', label: 'Custom 3', max: 31 }].map(({ k, label, max }) => (
                  <Field key={k} label={`${label}: ${sel.wled[k] ?? 128}`}>
                    <Slider
                      min={0}
                      max={max}
                      value={sel.wled[k] ?? 128}
                      onChange={v => w(k, v)}
                      size="xs"
                    />
                  </Field>
                ))}
                {[{ k: 'o1', label: 'Option 1' }, { k: 'o2', label: 'Option 2' }, { k: 'o3', label: 'Option 3' }].map(({ k, label }) => (
                  <Field key={k} label={label}>
                    <Checkbox
                      checked={sel.wled[k] || false}
                      onChange={e => w(k, e.target.checked)}
                    />
                  </Field>
                ))}
              </SimpleGrid>
            )}

            {/* Memory tab */}
            {ptab === 'memory' && (
              <Stack gap="sm">
                <Text size="sm" c="dimmed" lh={1.5}>
                  When global recall is &quot;memory&quot;, only checked properties are applied from this preset.
                  Use <Text component="strong" span>Import from WLED</Text> to snapshot the live strip and optionally sync these flags.
                </Text>
                {Object.keys(sel.memory).map(k => (
                  <Group key={k} justify="space-between" align="center" py="xs" style={{ borderBottom: '1px solid var(--border)' }}>
                    <Text size="sm" tt="capitalize">{k}</Text>
                    <Checkbox
                      checked={sel.memory[k]}
                      onChange={e => m(k, e.target.checked)}
                    />
                  </Group>
                ))}
                <Text size="xs" c="dimmed" mt={4}>Zone assignments using this preset:</Text>
                {data.zones.filter(z => z.presetId === sel.id).map(z => (
                  <Text key={z.id} size="sm" c="var(--primary)" py={2}>📍 {z.name}</Text>
                ))}
              </Stack>
            )}
          </Stack>
        </ScrollArea>
      ) : (
        <Stack flex={1} align="center" justify="center">
          <Text size="sm" c="dimmed">Select a preset or click + New</Text>
        </Stack>
      )}

      {showCapture && sel && (
        <Modal title="Import from WLED" onClose={() => { setShowCapture(false); setCaptureErr(''); }} width={440}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed" lh={1.55}>
              Reads the current strip at <Text component="code" ff="monospace" span>{wledIp.trim() || '…'}</Text> via{' '}
              <Text component="code" ff="monospace" span>/json/state</Text>. Only checked fields overwrite this preset; others stay as-is.
            </Text>
            <Group gap="xs">
              <AppButton type="button" variant="default" size="compact-xs" onClick={() => setAllCaptureOpts(true)}>Select all</AppButton>
              <AppButton type="button" variant="default" size="compact-xs" onClick={() => setAllCaptureOpts(false)}>Clear all</AppButton>
            </Group>
            {Object.entries(wledCaptureLabels()).map(([key, { title, hint }]) => (
              <Paper
                key={key}
                p="sm"
                radius="md"
                bg="var(--surface2)"
                style={{ cursor: 'pointer' }}
                onClick={() => toggleCaptureOpt(key)}
              >
                <Group gap="sm" align="flex-start" wrap="nowrap">
                  <Checkbox
                    checked={!!captureOpts[key]}
                    onChange={() => toggleCaptureOpt(key)}
                    onClick={e => e.stopPropagation()}
                    mt={2}
                    style={{ flexShrink: 0 }}
                  />
                  <Stack gap={2}>
                    <Text size="sm" fw={600}>{title}</Text>
                    <Text size="xs" c="dimmed">{hint}</Text>
                  </Stack>
                </Group>
              </Paper>
            ))}
            <Checkbox
              label="Update Memory tab flags for imported fields"
              checked={captureUpdateMemory}
              onChange={e => setCaptureUpdateMemory(e.target.checked)}
              size="sm"
            />
            {captureErr && <Text size="sm" c="red">{captureErr}</Text>}
            <Group gap="sm">
              <AppButton type="button" variant="default" style={{ flex: 1 }} onClick={() => { setShowCapture(false); setCaptureErr(''); }} disabled={capturing}>Cancel</AppButton>
              <AppButton type="button" variant="primary" style={{ flex: 1 }} onClick={runCaptureFromWled} disabled={capturing}>
                {capturing ? 'Reading…' : 'Import'}
              </AppButton>
            </Group>
          </Stack>
        </Modal>
      )}
    </Box>
  );
}
