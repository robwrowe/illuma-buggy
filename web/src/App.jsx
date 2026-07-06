import { useState, useEffect, useCallback } from 'react';
import {
  AppShell,
  Box,
  Button,
  FileButton,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';
import { WandLabTab } from './components/ble/WandLabTab';
import { BoardSyncModal } from './components/board/BoardSyncModal';
import { BrightnessTab } from './components/brightness/BrightnessTab';
import { MapZonesTab } from './components/map/MapZonesTab';
import { PalettesTab } from './components/palettes/PalettesTab';
import { PresetsTab } from './components/presets/PresetsTab';
import { SettingsTab } from './components/settings/SettingsTab';
import { ShowsTab } from './components/shows/ShowsTab';
import { LS_KEY, LS_PROFILES, migrateConfig } from './lib/config';
import { loadGoogleMaps } from './lib/googleMaps';

const TABS = [
  { id: 'map', label: 'Map & Zones', icon: '🗺' },
  { id: 'presets', label: 'Presets', icon: '✨' },
  { id: 'palettes', label: 'Palettes', icon: '🎨' },
  { id: 'shows', label: 'Shows', icon: '🎆' },
  { id: 'brightness', label: 'Brightness', icon: '💡' },
  { id: 'wandlab', label: 'Wand Lab', icon: '🪄' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const [tab, setTab] = useState('map');
  const [mapsReady, setMapsReady] = useState(false);
  const isNarrow = useMediaQuery('(max-width: 48em)');
  const [data, setData] = useState(() => {
    try {
      const s = localStorage.getItem(LS_KEY);
      return migrateConfig(s ? JSON.parse(s) : null);
    } catch {
      return migrateConfig(null);
    }
  });
  const [profiles, setProfiles] = useState(() => {
    try { return JSON.parse(localStorage.getItem(LS_PROFILES) || '{}'); } catch { return {}; }
  });
  const [profilesOpened, { open: openProfiles, close: closeProfiles }] = useDisclosure(false);
  const [showBoardSync, setShowBoardSync] = useState(false);
  const [mapsKey, setMapsKey] = useLocalStorage({ key: 'maps-api-key', defaultValue: '' });
  const [keyInput, setKeyInput] = useState(mapsKey);
  const [keyModalOpened, setKeyModalOpened] = useState(() => !mapsKey);
  const [newProfileName, setNewProfileName] = useState('');

  useEffect(() => {
    if (!mapsKey) return;
    loadGoogleMaps(mapsKey).then(() => setMapsReady(true)).catch(() => {});
  }, [mapsKey]);

  useEffect(() => {
    setKeyModalOpened(!mapsKey);
    if (mapsKey) setKeyInput(mapsKey);
  }, [mapsKey]);

  const replaceData = useCallback((next) => {
    setData(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const update = useCallback((patch) => {
    setData((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const saveMapsKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    setMapsKey(k);
    setKeyModalOpened(false);
    loadGoogleMaps(k).then(() => setMapsReady(true)).catch(() => {});
  };

  const saveProfile = () => {
    if (!newProfileName.trim()) return;
    const updated = { ...profiles, [newProfileName]: { ...data, savedAt: new Date().toISOString() } };
    setProfiles(updated);
    localStorage.setItem(LS_PROFILES, JSON.stringify(updated));
    setNewProfileName('');
  };

  const loadProfile = (name) => {
    if (!profiles[name]) return;
    const { savedAt: _savedAt, ...rest } = profiles[name];
    replaceData(migrateConfig(rest));
    closeProfiles();
  };

  const deleteProfile = (name) => {
    if (!confirm(`Delete profile "${name}"?`)) return;
    const updated = { ...profiles };
    delete updated[name];
    setProfiles(updated);
    localStorage.setItem(LS_PROFILES, JSON.stringify(updated));
  };

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `illuma-buggy-${(newProfileName || 'export').replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const importJSON = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        replaceData(migrateConfig(JSON.parse(ev.target.result)));
        alert('Imported!');
      } catch {
        alert('Invalid file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <AppShell
      header={{ height: isNarrow ? 100 : 56 }}
      padding={0}
      styles={{ main: { height: 'calc(100vh - var(--app-shell-header-height))', overflow: 'hidden' } }}
    >
      <AppShell.Header px="md">
        <Stack gap="xs" h="100%" justify="center">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Title order={5}>🔦 Illuma Buggy</Title>
            <Group gap={4} wrap="nowrap">
              <Button size="xs" variant="default" onClick={() => setShowBoardSync(true)}>📡 Board</Button>
              <Button size="xs" variant="default" onClick={openProfiles}>
                🗂 {Object.keys(profiles).length > 0 ? `(${Object.keys(profiles).length})` : ''}
              </Button>
              <FileButton onChange={importJSON} accept=".json">
                {(props) => <Button size="xs" variant="default" {...props}>📥</Button>}
              </FileButton>
              <Button size="xs" onClick={exportJSON}>📤</Button>
            </Group>
          </Group>
          <ScrollArea type="never" offsetScrollbars={false}>
            <Tabs value={tab} onChange={(v) => v && setTab(v)} styles={{ list: { flexWrap: 'nowrap' } }}>
              <Tabs.List grow={!isNarrow}>
                {TABS.map((t) => (
                  <Tabs.Tab key={t.id} value={t.id}>
                    {isNarrow ? t.icon : `${t.icon} ${t.label}`}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
          </ScrollArea>
        </Stack>
      </AppShell.Header>

      <AppShell.Main>
        <Box h="100%">
          {tab === 'map' && <MapZonesTab data={data} update={update} mapsReady={mapsReady} />}
          {tab === 'presets' && <PresetsTab data={data} update={update} />}
          {tab === 'palettes' && <PalettesTab data={data} update={update} />}
          {tab === 'shows' && <ShowsTab data={data} update={update} />}
          {tab === 'brightness' && <BrightnessTab data={data} update={update} />}
          {tab === 'wandlab' && <WandLabTab data={data} update={update} />}
          {tab === 'settings' && <SettingsTab data={data} update={update} />}
        </Box>
      </AppShell.Main>

      <Modal opened={keyModalOpened} onClose={() => setKeyModalOpened(false)} withCloseButton={!!mapsKey} title="🔑 Google Maps API Key" size="md">
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Stored only in your browser. Get a key at{' '}
            <Text component="a" href="https://console.cloud.google.com/google/maps-apis" target="_blank" rel="noreferrer" c="violet.4" inherit>
              Google Cloud Console
            </Text>
            {' '}— enable Maps JavaScript API and Geocoding API.
          </Text>
          <TextInput
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveMapsKey()}
            placeholder="AIza..."
            styles={{ input: { fontFamily: 'monospace' } }}
            autoFocus
          />
          <Group>
            {mapsKey && <Button variant="default" onClick={() => setKeyModalOpened(false)} style={{ flex: 1 }}>Cancel</Button>}
            <Button onClick={saveMapsKey} disabled={!keyInput.trim()} style={{ flex: 1 }}>Save & Load Map</Button>
          </Group>
        </Stack>
      </Modal>

      {showBoardSync && <BoardSyncModal data={data} onClose={() => setShowBoardSync(false)} />}

      <Modal opened={profilesOpened} onClose={closeProfiles} title="🗂 Profiles" size="md">
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            Profiles save your full config to a named slot in browser storage — load one before you leave the house.
          </Text>
          <Group>
            <TextInput
              style={{ flex: 1 }}
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveProfile()}
              placeholder="Profile name (e.g. Magic Kingdom)"
            />
            <Button onClick={saveProfile}>Save</Button>
          </Group>
          {Object.keys(profiles).length === 0 ? (
            <Text ta="center" c="dimmed" py="md" size="sm">No profiles saved yet</Text>
          ) : (
            Object.entries(profiles).map(([name, prof]) => (
              <Paper key={name} p="sm" withBorder>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div style={{ flex: 1, minWidth: 0 }}>
                  <Text fw={600} size="sm">{name}</Text>
                  <Text size="xs" c="dimmed">
                    {prof.presets?.length || 0} presets · {prof.zones?.length || 0} zones
                    {prof.savedAt && ` · ${new Date(prof.savedAt).toLocaleDateString()}`}
                  </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Button size="xs" onClick={() => loadProfile(name)}>Load</Button>
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => {
                        const updated = { ...profiles, [name]: { ...data, savedAt: new Date().toISOString() } };
                        setProfiles(updated);
                        localStorage.setItem(LS_PROFILES, JSON.stringify(updated));
                      }}
                    >
                      Update
                    </Button>
                    <Button size="xs" color="red" variant="light" onClick={() => deleteProfile(name)}>✕</Button>
                  </Group>
                </Group>
              </Paper>
            ))
          )}
        </Stack>
      </Modal>
    </AppShell>
  );
}
