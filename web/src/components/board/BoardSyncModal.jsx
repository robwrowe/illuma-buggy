import { useState, useEffect } from 'react';
import { Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { Modal } from '../shared/Modal';
import { AppButton } from '../shared/styles';
import { webBleBoard } from '../../lib/ble/chunking';
import { BOARD_SYNC_ITEMS, loadBoardSyncOptions, saveBoardSyncOptions, syncProfileToBoard } from '../../lib/boardSync';

export function BoardSyncModal({ data, onClose }) {
  const [connected, setConnected] = useState(webBleBoard.connected);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [syncOptions, setSyncOptions] = useState(loadBoardSyncOptions);
  const supported = webBleBoard.supported;
  const presetCount = (data.presets || []).length;

  const setOption = (key, val) => {
    setSyncOptions((prev) => {
      const next = { ...prev, [key]: val };
      saveBoardSyncOptions(next);
      return next;
    });
  };

  const anySelected = Object.values(syncOptions).some(Boolean);
  const presetsBlocked = syncOptions.presets && presetCount === 0;

  useEffect(() => webBleBoard.onConnectionChange(setConnected), []);

  const handleConnect = async () => {
    setError('');
    setBusy(true);
    try {
      await webBleBoard.connect();
      setStatus('Connected to IllumaBuggy');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleSync = async () => {
    if (!anySelected) return;
    if (presetsBlocked) {
      setError('No presets in this profile — uncheck Presets or add presets first.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      if (!connected) await webBleBoard.connect();
      await syncProfileToBoard(data, setStatus, syncOptions);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="📡 Send to Board" onClose={onClose} width={500}>
      <Stack gap="md">
        <Text size="xs" c="dimmed" lh={1.6}>
          Push selected settings to the ESP32 over Bluetooth — same protocol as the Android app.
          Requires <strong>Chrome or Edge</strong> (Web Bluetooth). Serve this page via{' '}
          <Text span ff="monospace" size="xs">./serve.sh</Text> on localhost.
        </Text>
        <Paper p="sm" bg="var(--surface2)" radius="md">
          <Text size="xs" fw={600} mb="xs">Include in sync</Text>
          {BOARD_SYNC_ITEMS.map(({ key, label, hint }) => (
            <Checkbox
              key={key}
              checked={!!syncOptions[key]}
              onChange={(e) => setOption(key, e.target.checked)}
              mb="xs"
              label={(
                <Stack gap={0}>
                  <Text size="xs" fw={600}>{label}</Text>
                  <Text size="xs" c="dimmed">{hint(data)}</Text>
                </Stack>
              )}
            />
          ))}
        </Paper>
        <Text size="xs" c="dimmed" lh={1.5}>
          GPS zones, brightness, recall state, and segment layouts stay in the browser / phone — export JSON to move those.
        </Text>
        {!supported && (
          <Text size="xs" c="red">Web Bluetooth is not available in this browser.</Text>
        )}
        <Group gap="xs" wrap="wrap">
          {!connected ? (
            <AppButton variant="primary" onClick={handleConnect} disabled={!supported || busy}>Connect</AppButton>
          ) : (
            <>
              <Text size="xs" c="green" fw={600} style={{ alignSelf: 'center' }}>● Connected</Text>
              <AppButton variant="default" onClick={() => { webBleBoard.disconnect(); setStatus(''); }} disabled={busy}>Disconnect</AppButton>
            </>
          )}
          <AppButton variant="primary" onClick={handleSync} disabled={!supported || busy || !anySelected || presetsBlocked}>
            {busy ? 'Sending…' : 'Send selected'}
          </AppButton>
        </Group>
        {!anySelected && (
          <Text size="xs" c="dimmed">Select at least one item to send.</Text>
        )}
        {presetsBlocked && (
          <Text size="xs" c="yellow">Presets is checked but this profile has none.</Text>
        )}
        {status && <Text size="xs" c="dimmed">{status}</Text>}
        {error && <Text size="xs" c="red">{error}</Text>}
      </Stack>
    </Modal>
  );
}
