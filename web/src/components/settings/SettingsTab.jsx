import { useState, useEffect } from 'react';
import {
  Badge,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { BleMappingTabBar } from '../ble/BleMappingTabBar';
import { DefaultPresetField } from '../ble/DefaultPresetField';
import { MbEffectField } from '../ble/MbEffectField';
import { RandomPoolEditor } from '../ble/RandomPoolEditor';
import { WledSegEditor } from '../ble/WledSegEditor';
import { ColorInput } from '../shared/ColorInput';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import { webBleBoard } from '../../lib/ble/chunking';
import { MB_ANIMATION_META, MB_COLOR_NAMES, MB_EFFECT_CLASS_META, MB_PAL_RANDOM, MB_PATTERN_META, MB_SEGMENT_META, MB_SEGMENT_SIM_COMMAND, SW_ANIMATION_META, TIER2_OPCODE_OPTIONS } from '../../lib/ble/mbConstants';
import { DEFAULT_MB_EFFECT_CLASSES, DEFAULT_MB_MAPPING, normalizeMbMapping, withSegRefDefaults } from '../../lib/ble/mbMapping';
import { DEFAULT_DATA, generateId, saveColorToLibrary, showModePresetOptions } from '../../lib/utils';
import { buildFiveCornerPreview, buildPresetLayoutPayload, buildSegmentHighlightPreview, fetchWledSegmentsFromIp, postWledState, pruneRefsToSnapshot } from '../../lib/wled/capture';
import { fetchWledCatalog, loadCachedWledCatalog } from '../../lib/wled/catalog';

export function SettingsTab({ data, update }) {
  const mb = data.mbMapping || DEFAULT_MB_MAPPING;
  const presets = data.presets || [];
  const savedColors = data.savedColors || [];
  const mbLayouts = data.mbSegmentLayouts || [];
  const activeLayoutId = data.mbActiveSegmentLayoutId || mbLayouts[0]?.id;
  const activeLayout = mbLayouts.find(l => l.id === activeLayoutId) || mbLayouts[0];
  const mbSegments = activeLayout?.segments || mb.segments;
  const [bleTab, setBleTab] = useState('sw');
  const [wledIp, setWledIp] = useState(() => localStorage.getItem('wled-ip') || '4.3.2.1');
  const [wledPreviewErr, setWledPreviewErr] = useState('');
  const [segSnapshots, setSegSnapshots] = useState({});
  const [segCaptureId, setSegCaptureId] = useState(null);
  const [segFxOptions, setSegFxOptions] = useState(() => loadCachedWledCatalog().effects);
  const [segPalOptions, setSegPalOptions] = useState(() => loadCachedWledCatalog().palettes);
  const saveColor = (hex) => saveColorToLibrary(data, update, hex);
  const setMb = (patch) => update({ mbMapping: normalizeMbMapping({ ...mb, ...patch }) });
  const setMbColor = (idx, hex) => {
    const colors = [...mb.colors];
    const v = hex.startsWith('#') ? hex : `#${hex}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    colors[idx] = v;
    setMb({ colors });
  };
  const setAnim = (key, patch) => setMb({ animations: { ...mb.animations, [key]: { ...mb.animations[key], ...patch } } });
  const setSwAnim = (key, patch) => setMb({ swAnimations: { ...mb.swAnimations, [key]: { ...mb.swAnimations[key], ...patch } } });
  const setPat = (key, patch) => setMb({ patterns: { ...mb.patterns, [key]: { ...mb.patterns[key], ...patch } } });
  const setEffectClass = (key, patch) => {
    const ec = mb.effectClasses || DEFAULT_MB_EFFECT_CLASSES;
    setMb({ effectClasses: { ...ec, [key]: { ...ec[key], ...patch } } });
  };
  const setUnclassifiedOpcode = (opcode, presetId) => {
    const ec = mb.effectClasses || DEFAULT_MB_EFFECT_CLASSES;
    setMb({
      effectClasses: {
        ...ec,
        unclassifiedOpcodes: {
          ...ec.unclassifiedOpcodes,
          [opcode]: { presetId, useMbColors: false },
        },
      },
    });
  };

  const updateActiveLayoutSegments = (segKey, refs) => {
    if (!activeLayout) {
      setMb({ segments: { ...mb.segments, [segKey]: refs.map(withSegRefDefaults) } });
      return;
    }
    const nextSegs = { ...activeLayout.segments, [segKey]: refs.map(withSegRefDefaults) };
    const nextLayouts = mbLayouts.map(l => l.id === activeLayout.id ? { ...l, segments: nextSegs } : l);
    update({
      mbSegmentLayouts: nextLayouts,
      mbMapping: normalizeMbMapping({ ...mb, segments: nextSegs }),
    });
  };

  const switchMbLayout = async (layoutId) => {
    const layout = mbLayouts.find(l => l.id === layoutId);
    if (!layout) return;
    update({
      mbActiveSegmentLayoutId: layoutId,
      mbMapping: normalizeMbMapping({ ...mb, segments: layout.segments }),
    });
    const idx = mbLayouts.findIndex(l => l.id === layoutId);
    if (webBleBoard.connected && idx >= 0) {
      try { await webBleBoard.send({ type: 'mb_layout_switch', index: idx }); } catch { }
    }
  };

  const addMbLayout = () => {
    const name = prompt('Layout name:', 'New layout');
    if (!name?.trim()) return;
    const id = generateId();
    const segments = JSON.parse(JSON.stringify(activeLayout?.segments || mb.segments));
    update({
      mbSegmentLayouts: [...mbLayouts, { id, name: name.trim(), createdAt: Date.now(), segments }],
      mbActiveSegmentLayoutId: id,
      mbMapping: normalizeMbMapping({ ...mb, segments }),
    });
  };

  useEffect(() => {
    if (bleTab !== 'segments') return;
    const ip = wledIp.trim();
    if (!ip) return;
    fetchWledCatalog(ip).then(({ effects, palettes }) => {
      setSegFxOptions(effects);
      setSegPalOptions(palettes);
    }).catch(() => { });
  }, [bleTab, wledIp]);

  const setSeg = (id, refs) => updateActiveLayoutSegments(id, refs);

  const sendStripPreview = async (payload) => {
    setWledPreviewErr('');
    const ip = wledIp.trim();
    if (!ip) { setWledPreviewErr('Enter a WLED IP to preview on the strip.'); return; }
    localStorage.setItem('wled-ip', ip);
    try {
      await postWledState(ip, payload);
    } catch {
      setWledPreviewErr(`Could not reach WLED at ${ip}. Join StrollerNet or the same LAN as the controller.`);
    }
  };

  const previewSegment = (segId) => sendStripPreview(buildSegmentHighlightPreview(mbSegments, segId));
  const previewFiveCorners = () => sendStripPreview(buildFiveCornerPreview(mbSegments));

  const applyDefaultLayout = async () => {
    setWledPreviewErr('');
    const preset = presets.find(p => p.id === mb.defaultPresetId);
    if (!preset) { setWledPreviewErr('Set a default zone preset on the Starlight or MagicBand tab first.'); return; }
    const payload = buildPresetLayoutPayload(preset, data.customSegmentLayouts);
    if (!payload) { setWledPreviewErr('Link a segment layout to that preset or save segments in the preset.'); return; }
    await sendStripPreview(payload);
  };

  const captureSegSnapshot = async (regionId) => {
    setSegCaptureId(regionId);
    setWledPreviewErr('');
    try {
      const ip = wledIp.trim();
      if (!ip) throw new Error('Enter WLED IP');
      localStorage.setItem('wled-ip', ip);
      const segments = await fetchWledSegmentsFromIp(ip);
      if (!segments.length) throw new Error('No active segments in WLED state');
      setSegSnapshots(prev => ({ ...prev, [regionId]: segments }));
      const pruned = pruneRefsToSnapshot(segments, mb.segments[regionId]);
      const cur = mb.segments[regionId] || [];
      if (pruned.length !== cur.length || pruned.some((r, i) => r.id !== cur[i]?.id)) {
        setSeg(regionId, pruned);
      }
    } catch (e) {
      setWledPreviewErr(e.message || 'Could not read WLED segments');
    } finally {
      setSegCaptureId(null);
    }
  };

  return (
    <ScrollArea h="100%">
      <Stack p="md" gap="md" maw={720}>
        <Title order={3}>Settings</Title>
        <Text size="xs" c="dimmed" lh={1.6}>
          Wand and MagicBand effects use the <strong>same presets as GPS zones</strong>. Push mapping + presets with <strong>📡 Board</strong>.
        </Text>

        <BleMappingTabBar active={bleTab} onChange={setBleTab} />

        {(bleTab === 'sw' || bleTab === 'mb') && (
          <DefaultPresetField mb={mb} presets={presets} onChange={setMb} />
        )}

        {bleTab === 'device' && (
          <>
            <Text size="xs" c="dimmed" lh={1.5}>
              Pushed via <strong>📡 Board</strong> or Android app on connect. Timeout = idle seconds since last BLE effect (<code style={{ fontFamily: 'monospace' }}>0</code> = never).
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
              <Field label="Starlight Wand enabled">
                <Checkbox
                  label="Listen for wand casts & SW animations"
                  checked={data.starlightEnabled !== false}
                  onChange={(e) => update({ starlightEnabled: e.target.checked })}
                />
              </Field>
              <Field label="SW auto-clear (sec)">
                <NumberInput
                  min={0}
                  max={600}
                  value={data.starlightTimeoutSec ?? 15}
                  onChange={(v) => update({ starlightTimeoutSec: Math.max(0, parseInt(v, 10) || 0) })}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
              </Field>
              <Field label="MagicBand+ enabled">
                <Checkbox
                  label="Listen for E9 show / guest commands"
                  checked={data.magicBandEnabled !== false}
                  onChange={(e) => update({ magicBandEnabled: e.target.checked })}
                />
              </Field>
              <Field label="MB+ auto-clear (sec)">
                <NumberInput
                  min={0}
                  max={600}
                  value={data.magicBandTimeoutSec ?? 15}
                  onChange={(v) => update({ magicBandTimeoutSec: Math.max(0, parseInt(v, 10) || 0) })}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
              </Field>
              <Field label="Effect fade (ms)">
                <NumberInput
                  min={0}
                  max={5000}
                  value={data.bleEffectTransitionMs ?? 700}
                  onChange={(v) => update({ bleEffectTransitionMs: Math.max(0, parseInt(v, 10) || 0) })}
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
              </Field>
              <Field label="MagicBand five-point mode">
                <Checkbox
                  label="4 corners + center (legacy)"
                  checked={data.magicBandFivePoint !== false}
                  onChange={(e) => update({ magicBandFivePoint: e.target.checked })}
                />
              </Field>
            </SimpleGrid>
          </>
        )}

        {bleTab === 'sw' && (
          <>
            <Text size="xs" c="dimmed">
              Starlight has priority over MagicBand+. Test with WandSimulator: <code style={{ fontFamily: 'monospace' }}>sw cast red</code>, <code style={{ fontFamily: 'monospace' }}>sw fx sparkle</code>.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              {SW_ANIMATION_META.map(({ key, label, hint }) => (
                <MbEffectField key={key} label={label} hint={hint} compact
                  mapping={mb.swAnimations?.[key] || DEFAULT_MB_MAPPING.swAnimations[key]} presets={presets}
                  onChange={m => setSwAnim(key, m)} />
              ))}
            </SimpleGrid>
          </>
        )}

        {bleTab === 'mb' && (
          <>
            <SectionHead>MagicBand+ Effect Mapping</SectionHead>
            <Text size="xs" c="dimmed" lh={1.5}>
              Animation classes group opcodes by behavior. Empty = firmware built-in fallback.
            </Text>
            {MB_EFFECT_CLASS_META.map(({ key, label, description, badge, tier }) => (
              <AppCard key={key} mb="xs" p="sm">
                <Group justify="space-between" gap="xs" mb={6}>
                  <Text fw={700} size="sm">{label}</Text>
                  <Badge variant="light" size="xs" color="gray">{badge}</Badge>
                </Group>
                <Text size="xs" c="dimmed" mb="sm" lh={1.4}>{description}</Text>
                <Field label="Preset">
                  <SearchableSelect
                    value={(mb.effectClasses || DEFAULT_MB_EFFECT_CLASSES)[key]?.presetId || ''}
                    onChange={v => setEffectClass(key, { presetId: v })}
                    placeholder="Default preset" options={presets.map(p => ({ value: p.id, label: p.name }))} allowEmpty={true} />
                </Field>
                {tier === 1 && (
                  <Checkbox
                    label="Use MagicBand+ decoded colors"
                    checked={(mb.effectClasses || DEFAULT_MB_EFFECT_CLASSES)[key]?.useMbColors !== false}
                    onChange={(e) => setEffectClass(key, { useMbColors: e.target.checked })}
                    mt="xs"
                  />
                )}
              </AppCard>
            ))}
            <SectionHead>Per-opcode Tier 2 overrides</SectionHead>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mb="md">
              {TIER2_OPCODE_OPTIONS.map(opcode => (
                <Field key={opcode} label={opcode}>
                  <SearchableSelect
                    value={mb.effectClasses?.unclassifiedOpcodes?.[opcode]?.presetId || ''}
                    onChange={v => setUnclassifiedOpcode(opcode, v)}
                    placeholder="Unclassified default" options={presets.map(p => ({ value: p.id, label: p.name }))} allowEmpty={true} />
                </Field>
              ))}
            </SimpleGrid>
            <details>
              <summary style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', color: 'var(--text2)' }}>Legacy per-opcode mapping</summary>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
                {MB_ANIMATION_META.filter(a => a.key !== 'wand').map(({ key, label }) => (
                  <MbEffectField key={key} label={label} compact
                    mapping={mb.animations[key]} presets={presets}
                    onChange={m => setAnim(key, m)} />
                ))}
              </SimpleGrid>
              <SectionHead>Patterns (E909)</SectionHead>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {MB_PATTERN_META.map(({ key, label }) => (
                  <MbEffectField key={key} label={`${key} — ${label}`} compact
                    mapping={mb.patterns[key]} presets={presets}
                    onChange={m => setPat(key, m)} />
                ))}
              </SimpleGrid>
            </details>
          </>
        )}

        {bleTab === 'show' && (() => {
          const sm = data.showModeConfig || DEFAULT_DATA.showModeConfig;
          const smOpts = showModePresetOptions(presets);
          const fwLiveOpts = showModePresetOptions(presets, true);
          const setShow = (patch) => update({ showModeConfig: { ...sm, ...patch } });
          const setParade = (patch) => setShow({ parade: { ...sm.parade, ...patch } });
          const setFireworks = (patch) => setShow({ fireworks: { ...sm.fireworks, ...patch } });
          return (
            <>
              <Text size="xs" c="dimmed" lh={1.5}>
                Parade and fireworks looks are pushed via <strong>📡 Board</strong>. Android parade buttons send phase changes live over BLE.
              </Text>
              <AppCard style={{ borderColor: 'var(--primary)' }}>
                <Text fw={700} size="sm" mb="sm" c="var(--primary)">Parade</Text>
                <Field label="Pre-show look">
                  <SearchableSelect value={sm.parade?.pre || ''} onChange={v => setParade({ pre: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
                </Field>
                <Field label="Show look (live)">
                  <SearchableSelect value={sm.parade?.live || ''} onChange={v => setParade({ live: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
                </Field>
              </AppCard>
              <AppCard>
                <Text fw={700} size="sm" mb="sm">Fireworks</Text>
                <Field label="Pre-show look">
                  <SearchableSelect value={sm.fireworks?.pre || ''} onChange={v => setFireworks({ pre: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
                </Field>
                <Field label="During show (live)">
                  <SearchableSelect value={sm.fireworks?.live ?? '__BLACK__'} onChange={v => setFireworks({ live: v || '__BLACK__' })}
                    placeholder="Black" options={fwLiveOpts} allowEmpty={false} />
                </Field>
                <Field label="Post-show look">
                  <SearchableSelect value={sm.fireworks?.post || ''} onChange={v => setFireworks({ post: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
                </Field>
              </AppCard>
            </>
          );
        })()}

        {bleTab === 'colors' && (
          <>
            <Text size="xs" c="dimmed">RGB used when no preset is mapped (solid MB colors).</Text>
            <RandomPoolEditor
              randomPool={mb.randomPool}
              paletteColors={mb.colors}
              onChange={randomPool => setMb({ randomPool })}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              {MB_COLOR_NAMES.map((name, idx) => (
                <Paper key={idx} p="xs" bg="var(--surface2)" radius="md">
                  <Group gap="xs" mb={6} wrap="nowrap">
                    <Paper
                      w={24}
                      h={24}
                      radius="sm"
                      style={{ background: mb.colors[idx], border: '1px solid var(--border)', flexShrink: 0 }}
                    />
                    <Stack gap={2}>
                      <Text size="xs" fw={600}>{idx} · {name}</Text>
                      {idx === MB_PAL_RANDOM && (
                        <Text size="xs" c="dimmed">Resolved at runtime from random pool</Text>
                      )}
                    </Stack>
                  </Group>
                  {idx === MB_PAL_RANDOM ? (
                    <Text size="xs" c="dimmed" ff="monospace">—</Text>
                  ) : (
                    <ColorInput value={mb.colors[idx]} onChange={v => setMbColor(idx, v)} savedColors={savedColors} onSaveColor={saveColor} />
                  )}
                </Paper>
              ))}
            </SimpleGrid>
          </>
        )}

        {bleTab === 'segments' && (
          <>
            <Text size="xs" c="dimmed" lh={1.5}>
              Per region: assign WLED segments manually (id + start/stop LED) or Capture from the strip and tick segments to add.
            </Text>
            <Group gap="xs" mb="sm" wrap="wrap">
              {mbLayouts.map(l => (
                <AppButton
                  key={l.id}
                  variant={l.id === activeLayoutId ? 'primary' : 'default'}
                  size="compact-sm"
                  onClick={() => switchMbLayout(l.id)}
                >
                  {l.name}
                </AppButton>
              ))}
              <AppButton variant="default" size="compact-sm" onClick={addMbLayout}>+ New Layout</AppButton>
            </Group>
            <Group gap="sm" mb="sm" wrap="wrap" align="center">
              <Text size="xs" fw={600} c="dimmed">WLED IP</Text>
              <TextInput
                value={wledIp}
                onChange={(e) => { setWledIp(e.target.value); setWledPreviewErr(''); }}
                placeholder="4.3.2.1"
                w={140}
                styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              />
              <AppButton variant="default" size="compact-sm" onClick={applyDefaultLayout}>
                Apply default preset layout
              </AppButton>
            </Group>
            {wledPreviewErr && <Text size="xs" c="red" mb="xs">{wledPreviewErr}</Text>}
            {MB_SEGMENT_META.map(({ id, label, hint }) => (
              <WledSegEditor key={id} label={label} hint={hint}
                simCommand={MB_SEGMENT_SIM_COMMAND[id]}
                snapshot={segSnapshots[id] || []}
                captureLoading={segCaptureId === id}
                canCapture={!!wledIp.trim()}
                onCapture={() => captureSegSnapshot(id)}
                refs={mbSegments[id]} onChange={refs => setSeg(id, refs)}
                onTest={() => previewSegment(id)}
                effectOptions={segFxOptions}
                paletteOptions={segPalOptions} />
            ))}
            <Stack pt="sm" mt="xs" style={{ borderTop: '1px solid var(--border)' }}>
              <AppButton variant="primary" size="compact-sm" onClick={previewFiveCorners}>
                Preview 5 corners
              </AppButton>
            </Stack>
          </>
        )}

        {bleTab === 'general' && (
          <>
            <SectionHead>Quick Actions</SectionHead>
            <Field label="Fade to Black preset">
              <SearchableSelect value={data.ftbPresetId || ''} allowEmpty={true}
                onChange={v => update({ ftbPresetId: v })}
                placeholder="Pure black (no preset)"
                options={presets.map(p => ({ value: p.id, label: p.name, searchText: p.name }))} />
            </Field>
            <SectionHead>Recall State</SectionHead>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mb="lg">
              {Object.keys(data.recallState || DEFAULT_DATA.recallState).map(k => (
                <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)}>
                  <SearchableSelect value={(data.recallState || DEFAULT_DATA.recallState)[k]} allowEmpty={false}
                    onChange={v => update({ recallState: { ...(data.recallState || DEFAULT_DATA.recallState), [k]: v } })}
                    placeholder={k}
                    options={['always', 'never', 'memory'].map(v => ({ value: v, label: v, searchText: v }))} />
                </Field>
              ))}
            </SimpleGrid>
            <Field label="Override kill on zone">
              <Checkbox
                label="Clear manual/MB override when entering a zone"
                checked={!!data.overrideKillOnZone}
                onChange={(e) => update({ overrideKillOnZone: e.target.checked })}
              />
            </Field>
          </>
        )}

        <Paper withBorder pt="md" mt="md">
          <AppButton
            variant="default"
            size="compact-sm"
            onClick={() => update({ mbMapping: JSON.parse(JSON.stringify(DEFAULT_MB_MAPPING)) })}
          >
            Reset BLE mapping to defaults
          </AppButton>
        </Paper>
      </Stack>
    </ScrollArea>
  );
}
