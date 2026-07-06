import { useState } from 'react';
import { Button, Checkbox, Group, Stack, Text, TextInput } from '@mantine/core';
import { importHexForDestination } from '../../lib/ble/captureImport';
import { hasCompanyIdPrefix, startShow } from '../../lib/ble/wandSimClient';

export function WandLabCapturePaste({
  hexPaste,
  onHexPasteChange,
  onLoadBytes,
  onStatus,
  simIp,
  onShowQueued,
}) {
  const [destination, setDestination] = useState('editor');
  const [strip8301, setStrip8301] = useState(true);

  const autoStrip = destination === 'editor';
  const effectiveStrip = autoStrip ? strip8301 : false;

  const apply = async () => {
    const result = importHexForDestination(hexPaste, destination, effectiveStrip);
    if (!result.ok) {
      onStatus?.(result.message);
      return;
    }

    if (result.kind === 'show') {
      const ip = (simIp || '').trim();
      if (!ip) {
        onStatus?.('Set simulator IP to queue /show from capture');
        return;
      }
      try {
        await startShow(ip, result.showBody);
        onStatus?.(result.message);
        onShowQueued?.(result.stepCount);
        onHexPasteChange('');
      } catch (e) {
        onStatus?.(e.message || 'Show queue failed');
      }
      return;
    }

    onLoadBytes(result.bytes, 'paste');
    onHexPasteChange('');
    onStatus?.(result.message);
  };

  const previewHas8301 = hasCompanyIdPrefix(hexPaste);

  return (
    <Stack gap="xs">
      <Group gap="md" wrap="wrap">
        <Checkbox
          size="xs"
          label="Load into byte editor (/send)"
          checked={destination === 'editor'}
          onChange={() => {
            setDestination('editor');
            setStrip8301(true);
          }}
        />
        <Checkbox
          size="xs"
          label="Queue as /show sequence"
          checked={destination === 'show'}
          onChange={() => setDestination('show')}
        />
      </Group>
      {destination === 'editor' && previewHas8301 && (
        <Checkbox
          size="xs"
          label="Strip 8301 envelope prefix (payload-only for /send)"
          checked={strip8301}
          onChange={(e) => setStrip8301(e.currentTarget.checked)}
        />
      )}
      <Group gap="xs" wrap="nowrap">
        <TextInput
          style={{ flex: 1 }}
          size="xs"
          placeholder="Hex, capture hex column, or tab-separated capture rows (multi-line OK)"
          value={hexPaste}
          onChange={(e) => onHexPasteChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') apply(); }}
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        />
        <Button size="xs" variant="default" onClick={apply}>
          {destination === 'show' ? 'Queue show' : 'Load'}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Capture hex includes 8301 — stripped for /send editor, kept for /show.
      </Text>
    </Stack>
  );
}
