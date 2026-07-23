import { useEffect, useState } from 'react';
import {
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
import { MbPayloadCapacityGauge } from '../ble/MbPayloadCapacityGauge';
import { RandomPoolEditor } from '../ble/RandomPoolEditor';
import { RuleEditor } from '../ble/RuleEditor';
import { SegmentMapEditor } from '../ble/SegmentMapEditor';
import { TimingModelEditor } from '../ble/TimingModelEditor';
import { ColorInput } from '../shared/ColorInput';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import { MB_COLOR_NAMES, MB_PAL_RANDOM } from '../../lib/ble/mbConstants';
import { DEFAULT_MB_MAPPING, normalizeMbMapping } from '../../lib/ble/mbMapping';
import { DEFAULT_DATA, saveColorToLibrary, showModePresetOptions } from '../../lib/utils';
import { fetchWledCatalog, loadCachedWledCatalog } from '../../lib/wled/catalog';
import { webBleBoard } from '../../lib/ble/chunking';

export function SettingsTab({ data, update }) {
  const mb = data.mbMapping || DEFAULT_MB_MAPPING;
  const presets = data.presets || [];
  const savedColors = data.savedColors || [];
  const [bleTab, setBleTab] = useState('rules');
  const [wledIp, setWledIp] = useState(() => localStorage.getItem('wled-ip') || '4.3.2.1');
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

  useEffect(() => {
    if (bleTab === 'device' || bleTab === 'sw' || bleTab === 'mb') setBleTab('rules');
  }, [bleTab]);

  useEffect(() => {
    if (bleTab !== 'segmentMaps' && bleTab !== 'rules' && bleTab !== 'timingModels') return;
    const ip = wledIp.trim();
    if (!ip) return;
    fetchWledCatalog(ip).then(({ effects, palettes }) => {
      setSegFxOptions(effects);
      setSegPalOptions(palettes);
    }).catch(() => { /* keep cache / last known */ });
  }, [bleTab, wledIp]);

  return (
    <ScrollArea h="100%">
      <Stack p="md" gap="md" maw={720}>
        <Title order={3}>Settings</Title>
        <Text size="xs" c="dimmed" lh={1.6}>
          MagicBand+ and wand packets are mapped with the <strong>Rules</strong> engine. Push rules + presets with <strong>📡 Board</strong>.
        </Text>

        <BleMappingTabBar active={bleTab} onChange={setBleTab} />

        {(bleTab === 'rules' || bleTab === 'segmentMaps' || bleTab === 'timingModels') && (
          <MbPayloadCapacityGauge mbMapping={mb} />
        )}

        {(bleTab === 'rules') && (
          <DefaultPresetField mb={mb} presets={presets} onChange={setMb} />
        )}

        {bleTab === 'rules' && (
          <RuleEditor
            mb={mb}
            presets={presets}
            effectOptions={segFxOptions}
            paletteOptions={segPalOptions}
            onChange={(next) => update({ mbMapping: normalizeMbMapping(next) })}
            onEditMaps={() => setBleTab('segmentMaps')}
            onEditTimingModels={() => setBleTab('timingModels')}
          />
        )}

        {bleTab === 'segmentMaps' && (
          <>
            <Group gap="sm" mb="xs" wrap="wrap" align="center">
              <Text size="xs" fw={600} c="dimmed">WLED IP</Text>
              <TextInput
                value={wledIp}
                onChange={(e) => {
                  const v = e.target.value;
                  setWledIp(v);
                  if (v.trim()) localStorage.setItem('wled-ip', v.trim());
                }}
                placeholder="4.3.2.1"
                w={140}
                styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
              />
              <Text size="xs" c="dimmed">Import + effect/palette names (same LAN / StrollerNet)</Text>
            </Group>
            <SegmentMapEditor
              mb={mb}
              presets={presets}
              wledIp={wledIp}
              effectOptions={segFxOptions}
              paletteOptions={segPalOptions}
              onChange={(next) => update({ mbMapping: normalizeMbMapping(next) })}
              onPresetsChange={(nextPresets) => update({ presets: nextPresets })}
            />
          </>
        )}

        {bleTab === 'timingModels' && (
          <TimingModelEditor
            mb={mb}
            effectOptions={segFxOptions}
            onChange={(next) => update({ mbMapping: normalizeMbMapping(next) })}
          />
        )}

        {bleTab === 'show' && (() => {
          const sm = data.showModeConfig || DEFAULT_DATA.showModeConfig;
          const smOpts = showModePresetOptions(presets);
          const setShow = (patch) => update({ showModeConfig: { ...sm, ...patch } });
          const setParade = (patch) => setShow({ parade: { ...sm.parade, ...patch } });
          const setFireworks = (patch) => setShow({ fireworks: { ...sm.fireworks, ...patch } });
          return (
            <>
              <Text size="xs" c="dimmed" lh={1.5}>
                Parade and fireworks looks are pushed via <strong>📡 Board</strong>. Live phase is blackout-only on firmware (no live preset).
                Android show buttons send phase changes live over BLE.
              </Text>
              <AppCard style={{ borderColor: 'var(--primary)' }}>
                <Text fw={700} size="sm" mb="sm" c="var(--primary)">Parade</Text>
                <Field label="Pre-show look">
                  <SearchableSelect value={sm.parade?.pre || ''} onChange={v => setParade({ pre: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
                </Field>
                <Field label="Post-show look">
                  <SearchableSelect value={sm.parade?.post || ''} onChange={v => setParade({ post: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
                </Field>
              </AppCard>
              <AppCard>
                <Text fw={700} size="sm" mb="sm">Fireworks</Text>
                <Field label="Pre-show look">
                  <SearchableSelect value={sm.fireworks?.pre || ''} onChange={v => setFireworks({ pre: v })}
                    placeholder="(none)" options={smOpts} allowEmpty={true} />
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

        {bleTab === 'general' && (
          <>
            <SectionHead>Quick Actions</SectionHead>
            <Field label="Fade to Black preset">
              <SearchableSelect value={data.ftbPresetId || ''} allowEmpty={true}
                onChange={(v) => {
                  update({ ftbPresetId: v });
                  if (webBleBoard.connected) {
                    webBleBoard.send({ type: 'mb_rule_config', ftbPresetId: v || '' }).catch(() => {});
                  }
                }}
                placeholder="Pure black (no preset)"
                options={presets.map(p => ({ value: p.id, label: p.name, searchText: p.name }))} />
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
