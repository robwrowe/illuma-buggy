import { ActionIcon, Box, Group, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { TagChipRow } from '../shared/TagChipRow';
import { TagFilterBar } from '../shared/TagFilterBar';
import { AppButton } from '../shared/styles';

export function PresetListPanel({
  presets,
  filteredPresets,
  selectedId,
  segmentMaps,
  search,
  onSearchChange,
  activeTag,
  onActiveTagChange,
  wledIp,
  onWledIpChange,
  wledStatus,
  wledEffectsCount,
  wledPalettesCount,
  onConnectWled,
  onNew,
  onSelect,
  onDuplicate,
  onTest,
}) {
  return (
    <Box
      w={320}
      bg="var(--surface)"
      style={{
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <Group
        justify="space-between"
        align="center"
        px="sm"
        py="xs"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Text fw={700} size="sm">
          Presets ({presets.length})
        </Text>
        <AppButton variant="primary" size="compact-xs" onClick={onNew}>
          + New
        </AppButton>
      </Group>

      <Paper
        p="xs"
        radius={0}
        bg="var(--surface2)"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <Stack gap={6}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }}>
            WLED Connect
          </Text>
          <Group gap={4} wrap="nowrap">
            <TextInput
              value={wledIp}
              onChange={(e) => onWledIpChange(e.target.value)}
              placeholder="192.168.x.x or 4.3.2.1"
              size="xs"
              style={{ flex: 1 }}
              onKeyDown={(e) => e.key === 'Enter' && onConnectWled()}
            />
            <AppButton
              variant={wledStatus === 'connected' ? 'success' : 'primary'}
              size="compact-xs"
              onClick={onConnectWled}
              style={{ whiteSpace: 'nowrap' }}
            >
              {wledStatus === 'connecting'
                ? '…'
                : wledStatus === 'connected'
                  ? '✓'
                  : wledStatus === 'error'
                    ? '✕'
                    : 'Go'}
            </AppButton>
          </Group>
          {wledStatus === 'connected' && (
            <Text size="xs" c="green">
              {wledEffectsCount} effects · {wledPalettesCount} palettes loaded
            </Text>
          )}
          {wledStatus === 'error' && (
            <Text size="xs" c="red">
              Connection failed — check IP and network
            </Text>
          )}
        </Stack>
      </Paper>

      <TagFilterBar
        items={presets}
        search={search}
        onSearchChange={onSearchChange}
        activeTag={activeTag}
        onActiveTagChange={onActiveTagChange}
      />

      <ScrollArea style={{ flex: 1 }}>
        {presets.length === 0 && (
          <Text p="md" size="sm" c="dimmed">
            No presets yet.
          </Text>
        )}
        {presets.length > 0 && filteredPresets.length === 0 && (
          <Text p="md" size="sm" c="dimmed">
            No matches.
          </Text>
        )}
        {filteredPresets.map((p) => (
          <Box
            key={p.id}
            onClick={() => onSelect(p)}
            p="sm"
            style={{
              borderBottom: '1px solid var(--border)',
              cursor: 'pointer',
              background: selectedId === p.id ? 'var(--primary-dim)' : 'transparent',
            }}
          >
            <Group gap={6} wrap="nowrap" align="flex-start">
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Text fw={600} size="sm">
                  {p.name}
                </Text>
                <TagChipRow tags={p.tags} />
                <Text size="xs" c="dimmed">
                  {p.global?.fxName || '—'} · {p.global?.palName || '—'}
                  {p.segmentMapId &&
                    (() => {
                      const map = segmentMaps.find((m) => m.id === p.segmentMapId);
                      return map ? ` · ${map.name}` : ' · map';
                    })()}
                </Text>
              </Stack>
              <ActionIcon
                variant="default"
                size="sm"
                title="Duplicate"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicate(p);
                }}
              >
                ⧉
              </ActionIcon>
              <ActionIcon
                variant="filled"
                size="sm"
                title="Test on strip"
                onClick={(e) => {
                  e.stopPropagation();
                  onTest(p);
                }}
              >
                ▶
              </ActionIcon>
            </Group>
          </Box>
        ))}
      </ScrollArea>
    </Box>
  );
}
