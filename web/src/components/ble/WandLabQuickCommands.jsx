import { useState } from 'react';
import {
  Button,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from '@mantine/core';
import { MB_SEGMENT_SIM_COMMAND, mbPaletteOptions } from '../../lib/ble/mbConstants';
import { sendLine, stopShow } from '../../lib/ble/wandSimClient';

const SW_FX_NAMES = [
  'rainbow', 'flash', 'sparkle', 'pulse', 'circle', 'fade', 'fade2', 'blink', 'palette5',
];

const TEST_SEGMENTS = Object.keys(MB_SEGMENT_SIM_COMMAND);

const MB_COLOR_SHORT = [
  'red', 'green', 'blue', 'cyan', 'purple', 'pink', 'yellow', 'lime', 'orange', 'white',
];

export function WandLabQuickCommands({ simIp, onStatus, sending, setSending }) {
  const [mbColor, setMbColor] = useState('red');
  const [mbLoopColor, setMbLoopColor] = useState('red');
  const [swFx, setSwFx] = useState('rainbow');
  const [testSeg, setTestSeg] = useState('all');
  const [five, setFive] = useState({ tl: '0', bl: '2', br: '21', tr: '8', c: '19' });

  const palOpts = mbPaletteOptions();
  const runLine = async (line) => {
    const ip = (simIp || '').trim();
    if (!ip) { onStatus?.('Set simulator IP first'); return; }
    setSending?.(true);
    onStatus?.('');
    try {
      await sendLine(ip, line);
      onStatus?.(`Sent: ${line}`);
    } catch (e) {
      onStatus?.(e.message || 'Send failed');
    } finally {
      setSending?.(false);
    }
  };

  const stopAll = async () => {
    const ip = (simIp || '').trim();
    if (!ip) return;
    try {
      await stopShow(ip);
      onStatus?.('Stopped loops / show');
    } catch (e) {
      onStatus?.(e.message || 'Stop failed');
    }
  };

  return (
    <Stack gap="sm" mt="md">
      <Text size="xs" c="dimmed" fw={600} tt="uppercase">Quick commands (firmware /send line)</Text>
      <Group grow wrap="wrap" align="flex-end">
        <Select
          label="mb color"
          size="xs"
          data={[...MB_COLOR_SHORT.map((c) => ({ value: c, label: c })), ...palOpts.slice(0, 8)]}
          value={mbColor}
          onChange={(v) => setMbColor(v || 'red')}
          searchable
        />
        <Button size="xs" disabled={sending} onClick={() => runLine(`mb ${mbColor}`)}>
          mb {mbColor}
        </Button>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {[
          ['tl', 'Top-left'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'],
          ['tr', 'Top-right'], ['c', 'Center'],
        ].map(([key, label]) => (
          <Select
            key={key}
            label={label}
            size="xs"
            data={palOpts}
            value={five[key]}
            onChange={(v) => setFive((prev) => ({ ...prev, [key]: v || '0' }))}
            searchable
          />
        ))}
      </SimpleGrid>
      <Button
        size="xs"
        variant="light"
        disabled={sending}
        onClick={() => runLine(`mb five ${five.tl} ${five.bl} ${five.br} ${five.tr} ${five.c}`)}
      >
        mb five (corners)
      </Button>
      <Group gap="xs" wrap="wrap">
        <Button size="xs" variant="default" disabled={sending} onClick={() => runLine('mbsweep')}>mbsweep</Button>
        <Button size="xs" variant="default" disabled={sending} onClick={() => runLine(`mbloop ${mbLoopColor}`)}>mbloop</Button>
        <Select
          size="xs"
          w={100}
          data={MB_COLOR_SHORT.map((c) => ({ value: c, label: c }))}
          value={mbLoopColor}
          onChange={(v) => setMbLoopColor(v || 'red')}
        />
        <Button size="xs" variant="default" disabled={sending} onClick={() => runLine('swfxloop')}>swfxloop</Button>
        <Button size="xs" color="red" variant="light" onClick={stopAll}>Stop</Button>
      </Group>
      <Group grow align="flex-end">
        <Select
          label="sw fx"
          size="xs"
          data={SW_FX_NAMES.map((n) => ({ value: n, label: n }))}
          value={swFx}
          onChange={(v) => setSwFx(v || 'rainbow')}
        />
        <Button size="xs" disabled={sending} onClick={() => runLine(`sw fx ${swFx}`)}>
          Send sw fx
        </Button>
      </Group>
      <Group grow align="flex-end">
        <Select
          label="test segment"
          size="xs"
          data={TEST_SEGMENTS.map((s) => ({ value: s, label: s }))}
          value={testSeg}
          onChange={(v) => setTestSeg(v || 'all')}
        />
        <Button size="xs" disabled={sending} onClick={() => runLine(`test ${testSeg}`)}>
          test highlight
        </Button>
      </Group>
    </Stack>
  );
}
