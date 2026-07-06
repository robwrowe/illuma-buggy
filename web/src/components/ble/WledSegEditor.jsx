import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Slider,
  Stack,
  Text,
} from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import { AppButton } from '../shared/styles';
import { withSegRefDefaults } from '../../lib/ble/mbMapping';
import {
  appendSegRef,
  defaultNewSegRef,
  formatWledSegLabel,
  formatWledSegSelectionSummary,
  isValidSegRef,
  parseSegRefFields,
  removeRefAt,
  toggleSnapshotSelection,
  updateRefAt,
} from '../../lib/wled/capture';

export function WledSegEditor({
  label, hint, simCommand, refs, onChange, onTest, onCapture, captureLoading, canCapture, snapshot, effectOptions, paletteOptions,
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const selectedSummary = formatWledSegSelectionSummary(refs);
  const toggle = (wledSegId) => onChange(toggleSnapshotSelection(snapshot, refs, wledSegId));
  const hasSnapshot = snapshot?.length > 0;
  const list = refs || [];

  const patchRef = (index, field, raw) => {
    const cur = list[index];
    if (!cur) return;
    if (field === 'rev' || field === 'mi') {
      onChange(updateRefAt(list, index, { ...withSegRefDefaults(cur), [field]: !!raw }));
      return;
    }
    if (['grp', 'spc', 'of', 'fx', 'sx', 'ix', 'pal'].includes(field)) {
      const n = raw === '' ? (field === 'fx' || field === 'pal' ? -1 : 0) : parseInt(raw, 10);
      onChange(updateRefAt(list, index, { ...withSegRefDefaults(cur), [field]: Number.isFinite(n) ? n : cur[field] }));
      return;
    }
    const idStr = field === 'id' ? raw : String(cur.id);
    const startStr = field === 'start' ? raw : String(cur.start);
    const stopStr = field === 'stop' ? raw : String(cur.stop);
    const parsed = parseSegRefFields(idStr, startStr, stopStr);
    if (parsed) onChange(updateRefAt(list, index, { ...withSegRefDefaults(cur), ...parsed }));
    else onChange(updateRefAt(list, index, {
      ...withSegRefDefaults(cur),
      id: field === 'id' ? parseInt(raw, 10) || 0 : cur.id,
      start: field === 'start' ? parseInt(raw, 10) || 0 : cur.start,
      stop: field === 'stop' ? parseInt(raw, 10) || 0 : cur.stop,
    }));
  };

  const fxOpts = [
    { value: '-1', label: 'Solid color (default)', searchText: 'solid' },
    ...(effectOptions || []).map((e) => ({ value: String(e.id), label: e.name, searchText: `${e.id} ${e.name}` })),
  ];
  const palOpts = [
    { value: '-1', label: 'Use resolved color', searchText: 'none' },
    ...(paletteOptions || []).map((p) => ({ value: String(p.id), label: p.name, searchText: `${p.id} ${p.name}` })),
  ];

  return (
    <Paper p="sm" mb="sm" bg="var(--surface2)">
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Stack gap={2} style={{ flex: 1 }}>
            <Text size="sm" fw={600}>{label}</Text>
            <Text size="xs" c="dimmed">{hint}</Text>
            {simCommand && <Text size="xs" c="dimmed" ff="monospace">WandSim: {simCommand}</Text>}
            <Text size="xs" c="violet" fw={600} ff="monospace" mt={4}>→ {selectedSummary}</Text>
          </Stack>
          <Group gap={6} wrap="nowrap">
            {onCapture && (
              <AppButton
                variant="default"
                size="compact-xs"
                onClick={onCapture}
                disabled={!canCapture || captureLoading}
              >
                {captureLoading ? '…' : hasSnapshot ? '↻ Capture' : 'Capture'}
              </AppButton>
            )}
            {onTest && (
              <AppButton variant="primary" size="compact-xs" onClick={onTest}>Test</AppButton>
            )}
          </Group>
        </Group>

        <Text size="xs" fw={600} c="dimmed">Assigned segments</Text>
        {list.length === 0 ? (
          <Text size="xs" c="dimmed">No segments — add manually or capture from WLED.</Text>
        ) : list.map((ref, index) => {
          const seg = withSegRefDefaults(ref);
          return (
            <Stack key={`${ref.id}-${index}`} gap="xs">
              <Group gap={6} align="center" wrap="wrap">
                <Text size="xs" c="dimmed">id</Text>
                <NumberInput
                  w={44}
                  size="xs"
                  value={ref.id}
                  onChange={(v) => patchRef(index, 'id', String(v ?? ''))}
                  hideControls
                  styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
                />
                <Text size="xs" c="dimmed">start LED</Text>
                <NumberInput
                  w={44}
                  size="xs"
                  value={ref.start}
                  onChange={(v) => patchRef(index, 'start', String(v ?? ''))}
                  hideControls
                  styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
                />
                <Text size="xs" c="dimmed">stop LED</Text>
                <NumberInput
                  w={44}
                  size="xs"
                  value={ref.stop}
                  onChange={(v) => patchRef(index, 'stop', String(v ?? ''))}
                  hideControls
                  styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
                />
                {!isValidSegRef(ref) ? (
                  <Text size="xs" c="red">invalid</Text>
                ) : (
                  <Text size="xs" c="dimmed">ok</Text>
                )}
                <ActionIcon variant="subtle" color="red" size="sm" onClick={() => onChange(removeRefAt(list, index))}>×</ActionIcon>
                <Button
                  size="compact-xs"
                  variant="default"
                  onClick={() => setAdvancedOpen((o) => (o === index ? false : index))}
                >
                  {advancedOpen === index ? '▴' : '▾'} Advanced
                </Button>
              </Group>
              {advancedOpen === index && (
                <Paper p="xs" bg="var(--bg)" withBorder>
                  <Stack gap="xs">
                    <SimpleGrid cols={3}>
                      {['grp', 'spc', 'of'].map((f) => (
                        <Stack key={f} gap={2}>
                          <Text size="xs" c="dimmed">{f}</Text>
                          <NumberInput
                            size="xs"
                            value={seg[f] ?? (f === 'grp' ? 1 : 0)}
                            onChange={(v) => patchRef(index, f, String(v ?? ''))}
                            hideControls
                            styles={{ input: { textAlign: 'center', fontFamily: 'monospace' } }}
                          />
                        </Stack>
                      ))}
                    </SimpleGrid>
                    <Group gap="md">
                      <Checkbox label="rev" size="xs" checked={!!seg.rev} onChange={(e) => patchRef(index, 'rev', e.target.checked)} />
                      <Checkbox label="mi" size="xs" checked={!!seg.mi} onChange={(e) => patchRef(index, 'mi', e.target.checked)} />
                    </Group>
                    <Stack gap={4}>
                      <Text size="xs" c="dimmed">Effect</Text>
                      <SearchableSelect
                        value={String(seg.fx ?? -1)}
                        allowEmpty={false}
                        onChange={(v) => patchRef(index, 'fx', v)}
                        placeholder="Solid"
                        options={fxOpts}
                      />
                    </Stack>
                    <SimpleGrid cols={2}>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">sx</Text>
                        <Slider min={0} max={255} value={seg.sx ?? 128} onChange={(v) => patchRef(index, 'sx', String(v))} size="xs" />
                      </Stack>
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">ix</Text>
                        <Slider min={0} max={255} value={seg.ix ?? 128} onChange={(v) => patchRef(index, 'ix', String(v))} size="xs" />
                      </Stack>
                    </SimpleGrid>
                    <Stack gap={4}>
                      <Text size="xs" c="dimmed">Palette override</Text>
                      <SearchableSelect
                        value={String(seg.pal ?? -1)}
                        allowEmpty={false}
                        onChange={(v) => patchRef(index, 'pal', v)}
                        placeholder="None"
                        options={palOpts}
                      />
                    </Stack>
                  </Stack>
                </Paper>
              )}
            </Stack>
          );
        })}
        <Button
          variant="subtle"
          size="compact-sm"
          onClick={() => onChange(appendSegRef(list, defaultNewSegRef(list)))}
          mb={hasSnapshot ? 'xs' : 0}
        >
          + Add segment
        </Button>

        {hasSnapshot && (
          <>
            <Text size="xs" fw={600} c="dimmed" mt={4}>From capture</Text>
            <Text size="xs" c="dimmed" ff="monospace" lh={1.4}>
              {snapshot.map(formatWledSegLabel).join(' · ')}
            </Text>
            <Stack gap={4}>
              {snapshot.map((seg) => {
                const checked = list.some((r) => r.id === seg.id);
                return (
                  <Paper
                    key={seg.id}
                    p="xs"
                    radius="sm"
                    style={{
                      cursor: 'pointer',
                      background: checked ? 'var(--primary-dim)' : 'var(--bg)',
                      border: `1px solid ${checked ? 'var(--primary)' : 'var(--border)'}`,
                    }}
                    onClick={() => toggle(seg.id)}
                  >
                    <Group gap="xs">
                      <Checkbox checked={checked} onChange={() => toggle(seg.id)} onClick={(e) => e.stopPropagation()} />
                      <Text size="xs" ff="monospace" c={checked ? 'violet' : 'dimmed'}>
                        {formatWledSegLabel(seg)}
                      </Text>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
  );
}
