import { useState, useEffect } from 'react';
import { Button, Group, Paper, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AppButton } from '../shared/styles';
import { fetchThemeParkDestinations } from '../../lib/map/themeParks';
import { generateId } from '../../lib/utils';

export function ParksPanel({ parks, data, update, gmap }) {
  const [expanded, setExpanded] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [destQuery, setDestQuery] = useState('');
  const [destResults, setDestResults] = useState([]);
  const [selectedDest, setSelectedDest] = useState(null);
  const [apiParkId, setApiParkId] = useState('');
  const [centerLat, setCenterLat] = useState('');
  const [centerLng, setCenterLng] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!showAdd || destQuery.length < 2) { setDestResults([]); return; }
    let cancelled = false;
    setLoading(true);
    fetchThemeParkDestinations()
      .then((dests) => {
        if (cancelled) return;
        const q = destQuery.toLowerCase();
        setDestResults(dests.filter((d) => d.name.toLowerCase().includes(q)).slice(0, 12));
      })
      .catch((e) => { if (!cancelled) setErr(String(e.message || e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [destQuery, showAdd]);

  const resetAdd = () => {
    setShowAdd(false);
    setAddName('');
    setDestQuery('');
    setDestResults([]);
    setSelectedDest(null);
    setApiParkId('');
    setCenterLat('');
    setCenterLng('');
    setErr('');
  };

  const savePark = () => {
    const name = addName.trim() || selectedDest?.parks?.find((p) => p.id === apiParkId)?.name;
    if (!name) { setErr('Enter a park name or pick from the API list.'); return; }
    const park = {
      id: generateId(),
      name,
      themeParksApiEntityId: apiParkId || '',
      centerLat: centerLat ? parseFloat(centerLat) : undefined,
      centerLng: centerLng ? parseFloat(centerLng) : undefined,
      createdAt: Date.now(),
    };
    update({ parks: [...(parks || []), park] });
    resetAdd();
  };

  const removeParkById = (id) => {
    if (!confirm('Remove this park? Zones will become ungrouped.')) return;
    update({
      parks: parks.filter((p) => p.id !== id),
      zones: (data.zones || []).map((z) => (z.parkId === id ? { ...z, parkId: undefined } : z)),
      indoorZones: (data.indoorZones || []).map((z) => (z.parkId === id ? { ...z, parkId: undefined } : z)),
    });
  };

  return (
    <Stack gap="xs" mb="xs">
      <Group justify="space-between" align="center">
        <Button
          variant="subtle"
          size="compact-xs"
          color="gray"
          onClick={() => setExpanded((v) => !v)}
          styles={{ root: { padding: 0, height: 'auto', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 } }}
        >
          {expanded ? '▾' : '▸'} Parks ({parks?.length || 0})
        </Button>
        <AppButton variant="primary" size="compact-xs" onClick={() => setShowAdd((v) => !v)}>+ Add</AppButton>
      </Group>
      {expanded && !showAdd && (
        <Stack gap="xs">
          {(parks || []).length === 0 && <Text size="xs" c="dimmed">No parks yet</Text>}
          {(parks || []).map((p) => (
            <Paper key={p.id} p="xs" bg="var(--surface2)" radius="md">
              <Text size="sm" fw={600}>{p.name}</Text>
              {p.themeParksApiEntityId && (
                <Text size="xs" c="dimmed" ff="monospace" mt={2}>
                  API: {p.themeParksApiEntityId.slice(0, 8)}…
                </Text>
              )}
              <Group gap="xs" mt="xs">
                {p.centerLat != null && p.centerLng != null && (
                  <AppButton variant="default" size="compact-xs" onClick={() => gmap?.current?.setCenter({ lat: p.centerLat, lng: p.centerLng })}>
                    Center map
                  </AppButton>
                )}
                <AppButton variant="danger" size="compact-xs" onClick={() => removeParkById(p.id)}>Remove</AppButton>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      {showAdd && (
        <Paper p="sm" bg="var(--surface2)" radius="md">
          <Stack gap="xs">
            <Field label="Park name">
              <TextInput value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="e.g. EPCOT" />
            </Field>
            <Field label="Search destination (themeparks.wiki)">
              <TextInput
                value={destQuery}
                onChange={(e) => { setDestQuery(e.target.value); setSelectedDest(null); setApiParkId(''); }}
                placeholder="Walt Disney World"
              />
            </Field>
            {loading && <Text size="xs" c="dimmed">Searching…</Text>}
            {destResults.map((d) => (
              <AppButton
                key={d.id}
                variant={selectedDest?.id === d.id ? 'primary' : 'default'}
                fullWidth
                size="compact-sm"
                onClick={() => { setSelectedDest(d); setDestQuery(d.name); setDestResults([]); }}
                styles={{ inner: { justifyContent: 'flex-start' } }}
              >
                {d.name}
              </AppButton>
            ))}
            {selectedDest?.parks?.length > 0 && (
              <Field label="Park entity">
                <SearchableSelect
                  value={apiParkId}
                  onChange={(v) => {
                    setApiParkId(v);
                    const pick = selectedDest.parks.find((p) => p.id === v);
                    if (pick && !addName.trim()) setAddName(pick.name);
                  }}
                  placeholder="Select park…"
                  allowEmpty
                  options={selectedDest.parks.map((p) => ({ value: p.id, label: p.name, searchText: p.name }))}
                />
              </Field>
            )}
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Field label="Center lat (optional)">
                <TextInput value={centerLat} onChange={(e) => setCenterLat(e.target.value)} placeholder="28.3747" />
              </Field>
              <Field label="Center lng (optional)">
                <TextInput value={centerLng} onChange={(e) => setCenterLng(e.target.value)} placeholder="-81.5494" />
              </Field>
            </SimpleGrid>
            {err && <Text size="xs" c="red">{err}</Text>}
            <Group gap="xs">
              <AppButton variant="default" style={{ flex: 1 }} size="compact-sm" onClick={resetAdd}>Cancel</AppButton>
              <AppButton variant="primary" style={{ flex: 1 }} size="compact-sm" onClick={savePark}>Save park</AppButton>
            </Group>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
