import { useState, useEffect, useCallback } from 'react';
import {
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Slider,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { Modal } from '../shared/Modal';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AppButton, AppCard } from '../shared/styles';
import { buildLegacyShowModeConfig, fetchParkShows, inferShowKind, normalizeShowBinding } from '../../lib/map/themeParks';
import { DEFAULT_DATA, generateId, showModePresetOptions, showPresetLabel } from '../../lib/utils';

export function ShowsTab({ data, update }) {
  const parks = data.parks || [];
  const presets = data.presets || [];
  const zones = data.zones || [];
  const showSettings = data.showSettings || DEFAULT_DATA.showSettings;
  const showBindings = (data.showBindings || [])
    .map((b) => normalizeShowBinding(b, showSettings))
    .filter(Boolean);

  const [selectedParkId, setSelectedParkId] = useState(parks[0]?.id || null);
  const [apiShows, setApiShows] = useState([]);
  const [loadingShows, setLoadingShows] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [picker, setPicker] = useState(null);
  const [showErr, setShowErr] = useState('');

  const selectedPark = parks.find((p) => p.id === selectedParkId) || null;
  const parkBindings = showBindings.filter((b) => b.parkId === selectedParkId);
  const parkZones = zones.filter((z) => z.parkId === selectedParkId && z.enabled !== false);
  const scopeLabel = (b) => {
    if (!b.scopeZoneId) return 'Entire park';
    return parkZones.find((z) => z.id === b.scopeZoneId)?.name || 'Zone';
  };
  const scopeZoneOpts = [
    { value: '', label: 'Entire park', searchText: 'park anywhere whole' },
    ...parkZones.map((z) => ({ value: z.id, label: z.name, searchText: z.name })),
  ];
  const pickerBinding = picker ? showBindings.find((b) => b.id === picker.bindingId) : null;

  const persistBindings = (nextBindings, parkId) => {
    update({
      showBindings: nextBindings,
      showModeConfig: buildLegacyShowModeConfig(nextBindings, parkId || selectedParkId),
    });
  };

  const loadApiShows = useCallback(async () => {
    const entityId = selectedPark?.themeParksApiEntityId;
    if (!entityId) { setApiShows([]); return; }
    setLoadingShows(true);
    setShowErr('');
    try {
      setApiShows(await fetchParkShows(entityId));
    } catch (e) {
      setShowErr(String(e.message || e));
      setApiShows([]);
    } finally {
      setLoadingShows(false);
    }
  }, [selectedPark?.themeParksApiEntityId]);

  useEffect(() => { loadApiShows(); }, [loadApiShows]);

  useEffect(() => {
    if (!selectedParkId && parks[0]?.id) setSelectedParkId(parks[0].id);
  }, [parks, selectedParkId]);

  const updateBinding = (id, patch) => {
    const cur = showBindings.find((b) => b.id === id);
    if (!cur) return;
    const next = showBindings.map((b) => {
      if (b.id !== id) return b;
      return normalizeShowBinding({ ...b, ...patch }, showSettings);
    }).filter(Boolean);
    persistBindings(next, cur.parkId);
  };

  const assignShow = (entityId, name) => {
    if (!selectedParkId) return;
    const existing = showBindings.find((b) => b.parkId === selectedParkId && b.entityId === entityId);
    if (existing) { setEditingId(existing.id); return; }
    const binding = normalizeShowBinding({
      id: generateId(),
      parkId: selectedParkId,
      entityId,
      name,
      kind: inferShowKind(name),
      presets: { pre: '', live: '', post: '' },
    }, showSettings);
    if (!binding) return;
    persistBindings([...showBindings, binding], selectedParkId);
    setEditingId(binding.id);
  };

  const removeBinding = (id) => {
    const b = showBindings.find((x) => x.id === id);
    if (!b || !confirm(`Remove "${b.name}"?`)) return;
    const next = showBindings.filter((x) => x.id !== id);
    persistBindings(next, b.parkId);
    if (editingId === id) setEditingId(null);
  };

  const filteredApi = apiShows.filter((sh) =>
    sh.name.toLowerCase().includes(search.toLowerCase()),
  );

  const phaseLabels = { pre: 'Pre-show', live: 'In-show', post: 'Post-show' };
  const presetOpts = showModePresetOptions(presets);
  const fwLiveOpts = showModePresetOptions(presets, true);

  return (
    <ScrollArea h="100%">
      <Stack p="md" gap="md" maw={720}>
        <Title order={3}>Shows</Title>
        <Text size="xs" c="dimmed" lh={1.5}>
          Assign pre/live/post presets per parade and fireworks show. Synced to the companion app via export/import.
          Legacy <strong>showModeConfig</strong> (Settings → Show Mode) is updated from the selected park&apos;s bindings for board push.
        </Text>

        <AppCard>
          <Text fw={700} size="sm" mb="xs">Default timing</Text>
          <Text size="xs" c="dimmed" mb="sm">Applied when adding a new show binding.</Text>
          {([
            ['defaultPreLeadSec', 'Pre-show lead (sec)'],
            ['defaultPostDelaySec', 'Post-show delay (sec)'],
            ['defaultHomeVisibleBeforeMin', 'Home visible before (min)'],
            ['defaultHomeVisibleAfterMin', 'Home visible after (min)'],
            ['defaultParadeDurationMin', 'Default parade duration (min)'],
            ['defaultFireworksDurationMin', 'Default fireworks duration (min)'],
          ]).map(([key, label]) => (
            <Group key={key} justify="space-between" mb="xs">
              <Text size="sm" c="dimmed">{label}</Text>
              <NumberInput
                w={88}
                value={showSettings[key]}
                onChange={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n)) update({ showSettings: { ...showSettings, [key]: n } });
                }}
                styles={{ input: { textAlign: 'right' } }}
              />
            </Group>
          ))}
        </AppCard>

        <AppCard>
          <Text fw={700} size="sm" mb="xs">Show brightness</Text>
          <Text size="xs" c="dimmed" mb="sm" lh={1.45}>
            At nighttime (below your solar threshold in Settings → Brightness), entering live applies this
            brightness — manual Start or auto live for fireworks. Restored when the show ends.
          </Text>
          <Checkbox
            label="Auto brightness at live"
            checked={showSettings.showAutoBrightness !== false}
            onChange={(e) => update({ showSettings: { ...showSettings, showAutoBrightness: e.target.checked } })}
            mb="xs"
          />
          <Group justify="space-between" mb="xs">
            <Text size="sm" c="dimmed">Night show brightness (0–255)</Text>
            <NumberInput
              min={0}
              max={255}
              w={88}
              value={showSettings.showNightBrightness ?? 5}
              disabled={showSettings.showAutoBrightness === false}
              onChange={(v) => {
                const n = parseInt(v, 10);
                if (!isNaN(n)) update({ showSettings: { ...showSettings, showNightBrightness: Math.min(255, Math.max(0, n)) } });
              }}
              styles={{ input: { textAlign: 'right' } }}
            />
          </Group>
          <Slider
            min={0}
            max={255}
            step={1}
            value={showSettings.showNightBrightness ?? 5}
            disabled={showSettings.showAutoBrightness === false}
            onChange={(n) => update({ showSettings: { ...showSettings, showNightBrightness: n } })}
          />
        </AppCard>

        <AppCard>
          <Text fw={700} size="sm" mb="xs">Park</Text>
          {parks.length === 0 ? (
            <Text size="xs" c="dimmed">Add a park on the Map tab with a themeparks.wiki entity ID first.</Text>
          ) : (
            <Group gap="xs">
              {parks.map((p) => (
                <AppButton
                  key={p.id}
                  variant={selectedParkId === p.id ? 'primary' : 'default'}
                  size="compact-sm"
                  onClick={() => { setSelectedParkId(p.id); setEditingId(null); }}
                >
                  {p.name}
                </AppButton>
              ))}
            </Group>
          )}
          {selectedPark && !selectedPark.themeParksApiEntityId && (
            <Text size="xs" c="yellow" mt="xs">This park has no themeparks.wiki API ID — show search will not work.</Text>
          )}
        </AppCard>

        {selectedParkId && (
          <>
            <AppCard>
              <Group justify="space-between" mb="sm">
                <Text fw={700} size="sm">Assigned shows</Text>
                <AppButton variant="default" size="compact-sm" onClick={loadApiShows} disabled={loadingShows}>
                  {loadingShows ? '…' : '↻ Refresh'}
                </AppButton>
              </Group>
              {parkBindings.length === 0 ? (
                <Text size="xs" c="dimmed">No shows assigned yet — search below.</Text>
              ) : (
                parkBindings.map((b) => (
                  <Paper
                    key={b.id}
                    p="sm"
                    mb="xs"
                    withBorder
                    style={{ borderColor: editingId === b.id ? 'var(--primary)' : undefined }}
                  >
                    <Group align="flex-start" gap="xs" wrap="nowrap">
                      <AppButton
                        variant="default"
                        style={{ flex: 1, textAlign: 'left', height: 'auto', padding: 0 }}
                        onClick={() => setEditingId(editingId === b.id ? null : b.id)}
                      >
                        <Stack gap={2} align="flex-start">
                          <Text fw={600} size="sm">{b.name}</Text>
                          <Text size="xs" c="dimmed">
                            {b.kind} · {scopeLabel(b)} · {b.durationMin}m · pre {b.preLeadSec}s · post +{b.postDelaySec}s
                          </Text>
                        </Stack>
                      </AppButton>
                      <AppButton variant="danger" size="compact-xs" onClick={() => removeBinding(b.id)}>✕</AppButton>
                    </Group>
                    {editingId === b.id && (
                      <Stack gap="xs" mt="sm" pt="sm" style={{ borderTop: '1px solid var(--border)' }}>
                        <Field label="Location (automation only runs here)">
                          <SearchableSelect
                            value={b.scopeZoneId || ''}
                            onChange={(v) => updateBinding(b.id, { scopeZoneId: v || null })}
                            placeholder="Entire park"
                            options={scopeZoneOpts}
                            allowEmpty
                          />
                        </Field>
                        {(['pre', 'live', 'post']).map((phase) => (
                          <Group key={phase} gap="xs" wrap="nowrap">
                            <Text size="xs" c="dimmed" w={88}>{phaseLabels[phase]}</Text>
                            <AppButton
                              variant="default"
                              style={{ flex: 1, justifyContent: 'flex-start' }}
                              size="compact-sm"
                              onClick={() => setPicker({ bindingId: b.id, phase })}
                            >
                              {showPresetLabel(presets, b.presets[phase], b.kind, phase)}
                            </AppButton>
                          </Group>
                        ))}
                        <Checkbox
                          label="Disable auto pre/post (all instances)"
                          checked={!!b.autoStartDisabled}
                          onChange={(e) => updateBinding(b.id, { autoStartDisabled: e.target.checked })}
                          mt="xs"
                        />
                        {([
                          ['durationMin', 'Show duration (min)'],
                          ['preLeadSec', 'Pre lead (sec)'],
                          ['postDelaySec', 'Post delay (sec)'],
                          ['homeVisibleBeforeMin', 'Home before (min)'],
                          ['homeVisibleAfterMin', 'Home after (min)'],
                        ]).map(([key, label]) => (
                          <Group key={key} justify="space-between">
                            <Text size="xs" c="dimmed">{label}</Text>
                            <NumberInput
                              w={72}
                              size="xs"
                              value={b[key]}
                              onChange={(v) => {
                                const n = parseInt(v, 10);
                                if (!isNaN(n)) updateBinding(b.id, { [key]: n });
                              }}
                              styles={{ input: { textAlign: 'right' } }}
                            />
                          </Group>
                        ))}
                      </Stack>
                    )}
                  </Paper>
                ))
              )}
            </AppCard>

            <AppCard>
              <Text fw={700} size="sm" mb="xs">Search park shows</Text>
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter parades & fireworks…"
                mb="xs"
              />
              {showErr && <Text size="xs" c="red" mb="xs">{showErr}</Text>}
              {filteredApi.map((sh) => {
                const assigned = parkBindings.some((b) => b.entityId === sh.id);
                return (
                  <Group key={sh.id} justify="space-between" py="xs" style={{ borderBottom: '1px solid var(--border)' }}>
                    <Text size="sm">{sh.name}</Text>
                    {assigned ? (
                      <Text size="xs" c="dimmed" fw={600}>Assigned</Text>
                    ) : (
                      <AppButton variant="primary" size="compact-xs" onClick={() => assignShow(sh.id, sh.name)}>+ Add</AppButton>
                    )}
                  </Group>
                );
              })}
              {!loadingShows && filteredApi.length === 0 && (
                <Text size="xs" c="dimmed" mt="xs">No matching shows — check API ID or refresh.</Text>
              )}
            </AppCard>
          </>
        )}

        {picker && pickerBinding && (
          <Modal
            title={`${phaseLabels[picker.phase]} preset — ${pickerBinding.name}`}
            onClose={() => setPicker(null)}
            width={420}
          >
            <SearchableSelect
              value={pickerBinding.presets[picker.phase] || ''}
              onChange={(v) => {
                const presetsNext = { ...pickerBinding.presets, [picker.phase]: v };
                if (picker.phase === 'live' && pickerBinding.kind === 'fireworks' && !v) {
                  presetsNext.live = '__BLACK__';
                }
                updateBinding(picker.bindingId, { presets: presetsNext });
                setPicker(null);
              }}
              placeholder={picker.phase === 'live' && pickerBinding.kind === 'fireworks' ? 'Black (strip off)' : '(none)'}
              options={picker.phase === 'live' && pickerBinding.kind === 'fireworks' ? fwLiveOpts : presetOpts}
              allowEmpty={!(picker.phase === 'live' && pickerBinding.kind === 'fireworks')}
            />
          </Modal>
        )}
      </Stack>
    </ScrollArea>
  );
}
