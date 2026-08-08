import { useState, useEffect, useCallback } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AppShell, Box, Button, Group, Modal, Paper, Stack, Text, TextInput } from '@mantine/core';
import { useDisclosure, useLocalStorage, useMediaQuery } from '@mantine/hooks';

import { HeaderTabs } from './components/header/Header';

import { WandLabTab } from './components/ble/WandLabTab';
import { BoardSyncModal } from './components/board/BoardSyncModal';
import { BrightnessTab } from './components/brightness/BrightnessTab';
import { MapZonesTab } from './components/map/MapZonesTab';
import { PalettesTab } from './components/palettes/PalettesTab';
import { PresetsTab } from './components/presets/PresetsTab';
import { ShotBoxModal } from './components/presets/ShotBoxModal';
import { SettingsTab } from './components/settings/SettingsTab';
import { ShowsTab } from './components/shows/ShowsTab';
import { LS_KEY, LS_PROFILES, migrateConfig } from './lib/config';
import { loadGoogleMaps } from './lib/googleMaps';
import { tabFromPathname } from './lib/routes';

export function App() {
  const location = useLocation();
  const tab = tabFromPathname(location.pathname);
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
    try {
      return JSON.parse(localStorage.getItem(LS_PROFILES) || '{}');
    } catch {
      return {};
    }
  });
  const [profilesOpened, { open: openProfiles, close: closeProfiles }] = useDisclosure(false);
  const [showBoardSync, setShowBoardSync] = useState(false);
  const [showShotBox, setShowShotBox] = useState(false);
  const [mapsKey, setMapsKey] = useLocalStorage({ key: 'maps-api-key', defaultValue: '' });
  const [sheetsEndpoint, setSheetsEndpoint] = useLocalStorage({
    key: 'wandlab-sheets-endpoint',
    defaultValue: '',
  });
  const [keyInput, setKeyInput] = useState(mapsKey);
  const [newProfileName, setNewProfileName] = useState('');
  // Prompt for Maps key only when visiting Map without a key configured.
  const keyModalOpened = tab === 'map' && !mapsKey;

  // Only load Maps JS when the Map tab is visited (not on every app start).
  useEffect(() => {
    if (!mapsKey || tab !== 'map' || mapsReady) return;
    loadGoogleMaps(mapsKey)
      .then(() => setMapsReady(true))
      .catch(() => {});
  }, [mapsKey, tab, mapsReady]);

  const replaceData = useCallback((next) => {
    setData(next);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const update = useCallback((patch) => {
    setData((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const saveMapsKey = () => {
    const k = keyInput.trim();
    if (!k) return;
    setMapsKey(k);
    loadGoogleMaps(k)
      .then(() => setMapsReady(true))
      .catch(() => {});
  };

  const saveProfile = () => {
    if (!newProfileName.trim()) return;
    const updated = {
      ...profiles,
      [newProfileName]: { ...data, savedAt: new Date().toISOString() },
    };
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
    const blob = new Blob(
      [JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2)],
      { type: 'application/json' },
    );
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
      header={{ height: isNarrow ? 100 : 93 }}
      padding={0}
      styles={{
        main: { height: 'calc(100vh - var(--app-shell-header-height))', overflow: 'hidden' },
      }}
    >
      <AppShell.Header>
        <HeaderTabs
          openProfiles={openProfiles}
          exportJSON={exportJSON}
          importJSON={importJSON}
          setShowBoardSync={setShowBoardSync}
          profiles={profiles}
          onOpenShotBox={() => setShowShotBox(true)}
        />
      </AppShell.Header>

      <AppShell.Main>
        <Box h="100%">
          <Routes>
            <Route path="/" element={<Navigate to="/presets" replace />} />
            <Route
              path="/map"
              element={<MapZonesTab data={data} update={update} mapsReady={mapsReady} />}
            />
            <Route
              path="/presets"
              element={
                <PresetsTab
                  data={data}
                  update={update}
                  onOpenShotBox={() => setShowShotBox(true)}
                />
              }
            />
            <Route path="/palettes" element={<PalettesTab data={data} update={update} />} />
            <Route path="/shows" element={<ShowsTab data={data} update={update} />} />
            <Route path="/brightness" element={<BrightnessTab data={data} update={update} />} />
            <Route path="/wandlab" element={<Navigate to="/wandlab/quick" replace />} />
            <Route path="/wandlab/:section" element={<WandLabTab data={data} update={update} />} />
            <Route
              path="/settings"
              element={
                <SettingsTab
                  data={data}
                  update={update}
                  sheetsEndpoint={sheetsEndpoint}
                  setSheetsEndpoint={setSheetsEndpoint}
                />
              }
            />
            <Route path="*" element={<Navigate to="/presets" replace />} />
          </Routes>
        </Box>
      </AppShell.Main>

      <ShotBoxModal open={showShotBox} onClose={() => setShowShotBox(false)} data={data} />

      <Modal
        opened={keyModalOpened}
        onClose={() => {}}
        withCloseButton={false}
        title="🔑 Google Maps API Key"
        size="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Stored only in your browser. Get a key at{' '}
            <Text
              component="a"
              href="https://console.cloud.google.com/google/maps-apis"
              target="_blank"
              rel="noreferrer"
              c="violet.4"
              inherit
            >
              Google Cloud Console
            </Text>{' '}
            — enable Maps JavaScript API and Geocoding API.
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
            <Button onClick={saveMapsKey} disabled={!keyInput.trim()} style={{ flex: 1 }}>
              Save & Load Map
            </Button>
          </Group>
        </Stack>
      </Modal>

      {showBoardSync && <BoardSyncModal data={data} onClose={() => setShowBoardSync(false)} />}

      <Modal opened={profilesOpened} onClose={closeProfiles} title="🗂 Profiles" size="md">
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            Profiles save your full config to a named slot in browser storage — load one before you
            leave the house.
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
            <Text ta="center" c="dimmed" py="md" size="sm">
              No profiles saved yet
            </Text>
          ) : (
            Object.entries(profiles).map(([name, prof]) => (
              <Paper key={name} p="sm" withBorder>
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text fw={600} size="sm">
                      {name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {prof.presets?.length || 0} presets · {prof.zones?.length || 0} zones
                      {prof.savedAt && ` · ${new Date(prof.savedAt).toLocaleDateString()}`}
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap">
                    <Button size="xs" onClick={() => loadProfile(name)}>
                      Load
                    </Button>
                    <Button
                      size="xs"
                      variant="default"
                      onClick={() => {
                        const updated = {
                          ...profiles,
                          [name]: { ...data, savedAt: new Date().toISOString() },
                        };
                        setProfiles(updated);
                        localStorage.setItem(LS_PROFILES, JSON.stringify(updated));
                      }}
                    >
                      Update
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={() => deleteProfile(name)}
                    >
                      ✕
                    </Button>
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
