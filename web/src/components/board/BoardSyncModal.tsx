import { useState, useEffect } from 'react';
import { Checkbox, Group, NumberInput, Paper, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { Modal } from '../shared/Modal';
import { AppButton } from '../shared/styles';
import { webBleBoard } from '../../lib/ble/chunking';
import {
  activeBoard,
  loadBoardTransportSettings,
  saveBoardTransportSettings,
} from '../../lib/ble/boardTransport';
import { BOARD_SYNC_ITEMS, loadBoardSyncOptions, saveBoardSyncOptions, syncProfileToBoard } from '../../lib/boardSync';
import { RuleLogPanel } from './RuleLogPanel';

export function BoardSyncModal({ data, onClose }) {
  const [transport, setTransport] = useState(loadBoardTransportSettings);
  const board = activeBoard(transport.mode);
  const [connected, setConnected] = useState(board.connected);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [syncOptions, setSyncOptions] = useState(loadBoardSyncOptions);
  const supported = board.supported;
  const presetCount = (data.presets || []).length;
  const restMode = transport.mode === 'rest';

  const setOption = (key, val) => {
    setSyncOptions((prev) => {
      const next = { ...prev, [key]: val };
      saveBoardSyncOptions(next);
      return next;
    });
  };

  const patchTransport = (patch) => {
    setTransport(saveBoardTransportSettings(patch));
  };

  const anySelected = Object.values(syncOptions).some(Boolean);
  const presetsBlocked = syncOptions.presets && presetCount === 0;

  useEffect(() => {
    const unsub = activeBoard(transport.mode).onConnectionChange(setConnected);
    return () => { unsub(); };
  }, [transport.mode]);

  const ensureConnected = async () => {
    const b = activeBoard(transport.mode) as any;
    if (b.connected) return;
    if (transport.mode === 'rest') {
      await b.connect(transport.host, transport.port);
    } else {
      await b.connect();
    }
  };

  const handleConnect = async () => {
    setError('');
    setBusy(true);
    try {
      await ensureConnected();
      setStatus(restMode
        ? `Connected to ${transport.host}:${transport.port}`
        : 'Connected to IllumaBuggy');
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
      await ensureConnected();
      await syncProfileToBoard(data, setStatus, syncOptions);
      onClose();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="📡 Send to Board" onClose={onClose} width={560}>
      <Stack gap="md">
        <Text size="xs" c="dimmed" lh={1.6}>
          Push selected settings to the ESP32. BLE uses the same protocol as the Android app
          (Chrome/Edge + Web Bluetooth). REST posts the same JSON over WiFi on port 8080 —
          much faster for large rules at the bench.
        </Text>
        <SegmentedControl
          size="xs"
          value={transport.mode}
          onChange={(mode) => patchTransport({ mode })}
          data={[
            { value: 'ble', label: 'Bluetooth' },
            { value: 'rest', label: 'WiFi (REST)' },
          ]}
        />
        {restMode && (
          <Group gap="xs" grow>
            <TextInput
              size="xs"
              label="Board host"
              value={transport.host}
              onChange={(e) => patchTransport({ host: e.target.value })}
              placeholder="illuma-logic.local"
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
            <NumberInput
              size="xs"
              label="Port"
              value={transport.port}
              onChange={(v) => patchTransport({ port: Number(v) || 8080 })}
              min={1}
              max={65535}
              w={110}
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
          </Group>
        )}
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
          GPS zones, brightness, and recall state stay in the browser / phone — export JSON to move those.
          Segment geometry for presets is resolved into concrete WLED seg[] before push.
        </Text>
        {!supported && !restMode && (
          <Text size="xs" c="red">Web Bluetooth is not available in this browser.</Text>
        )}
        <Group gap="xs" wrap="wrap">
          {!connected ? (
            <AppButton variant="primary" onClick={handleConnect} disabled={!supported || busy}>Connect</AppButton>
          ) : (
            <>
              <Text size="xs" c="green" fw={600} style={{ alignSelf: 'center' }}>● Connected</Text>
              <AppButton variant="default" onClick={() => { board.disconnect(); setStatus(''); }} disabled={busy}>Disconnect</AppButton>
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

        <RuleLogPanel connected={webBleBoard.supported} />
      </Stack>
    </Modal>
  );
}
