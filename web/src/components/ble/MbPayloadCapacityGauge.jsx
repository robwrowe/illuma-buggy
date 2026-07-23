import { useMemo, useState } from 'react';
import { Box, Collapse, Group, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { estimateMbPayloadFootprint } from '../../lib/ble/mbMapping';

function formatKb(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes >= 10240 ? 0 : 1)} KB`;
}

function bandColor(pct) {
  // Thresholds assume ~1.55× overhead: 60% estimated ≈ room to grow;
  // 85% estimated still leaves ~15% before the 128KB software cap.
  if (pct >= 85) return 'red';
  if (pct >= 60) return 'yellow';
  return 'teal';
}

/**
 * Live set_mb_rules capacity gauge — visible while editing rules / maps / timing models.
 */
export function MbPayloadCapacityGauge({ mbMapping }) {
  const [open, setOpen] = useState(false);
  const fp = useMemo(() => estimateMbPayloadFootprint(mbMapping), [mbMapping]);
  const color = bandColor(fp.pctOfBudget);
  const pct = Math.min(100, Math.max(0, fp.pctOfBudget));

  return (
    <Box
      p="sm"
      mb="sm"
      style={{
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--surface2)',
      }}
    >
      <UnstyledButton onClick={() => setOpen((v) => !v)} style={{ width: '100%', textAlign: 'left' }}>
        <Group justify="space-between" gap="xs" wrap="nowrap" mb={6}>
          <Text size="xs" fw={700}>
            Rules payload
          </Text>
          <Text size="xs" c="dimmed">
            {open ? 'Hide detail ▴' : 'Show detail ▾'}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" mb={6}>
          ~{formatKb(fp.totalRawBytes)} raw · ~{formatKb(fp.estimatedParsedBytes)} estimated
          {' · '}
          {Math.round(fp.pctOfBudget)}% of {formatKb(fp.budgetBytes)} budget
        </Text>
        <Progress value={pct} color={color} size="sm" radius="sm" />
      </UnstyledButton>

      <Text size="xs" c="dimmed" mt={8}>
        Rules: {formatKb(fp.breakdown.rules || 0)} ({fp.ruleCount})
        {' · '}
        Maps: {formatKb(fp.breakdown.segmentMaps || 0)} ({fp.segmentMapCount})
        {' · '}
        Timing: {formatKb(fp.breakdown.timingModels || 0)} ({fp.timingModelCount})
      </Text>

      <Collapse in={open}>
        <Stack gap={4} mt="sm">
          <Text size="xs" fw={600} c="dimmed">
            Heaviest items
          </Text>
          {fp.heaviest.length === 0 && (
            <Text size="xs" c="dimmed">No rules or maps yet.</Text>
          )}
          {fp.heaviest.map((item) => (
            <Group key={`${item.kind}-${item.id}`} justify="space-between" gap="xs" wrap="nowrap">
              <Text size="xs" style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
                <Text span c="dimmed" ff="monospace">{item.kind === 'segmentMap' ? 'map' : item.kind === 'timingModel' ? 'tm' : 'rule'}</Text>
                {' '}
                {item.name}
              </Text>
              <Text size="xs" ff="monospace" c="dimmed">
                {formatKb(item.bytes)}
              </Text>
            </Group>
          ))}
          <Text size="xs" c="dimmed" mt={4} lh={1.4}>
            Estimated pool size uses a {fp.estimatedParsedBytes && fp.totalRawBytes
              ? (fp.estimatedParsedBytes / Math.max(1, fp.totalRawBytes)).toFixed(2)
              : '1.55'}× overhead factor (calibrate via serial{' '}
            <Text span ff="monospace">logRulesHeap</Text> psramFree delta — see{' '}
            <Text span ff="monospace">ARDUINOJSON_OVERHEAD_FACTOR</Text>).
          </Text>
        </Stack>
      </Collapse>
    </Box>
  );
}
