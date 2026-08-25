import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Group,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { testPresetOnWled } from '../../lib/ble/chunking';
import { findTriggerZone } from '../../lib/geo';
import { itemMatchesTagFilter } from '../../lib/tags';
import { useGeoPosition } from '../../hooks/useGeoPosition';
import { usePresetWled } from './usePresetWled';
import { TagFilterBar } from '../shared/TagFilterBar';
import { AppButton } from '../shared/styles';

const shotBtnStyle = {
  height: 76,
  minHeight: 76,
  padding: '6px 8px',
  whiteSpace: 'normal',
  lineHeight: 1.2,
};

const shotBtnStyles = {
  label: {
    whiteSpace: 'normal' as const,
    wordBreak: 'break-word' as const,
    overflowWrap: 'anywhere' as const,
    textAlign: 'center' as const,
    lineHeight: 1.2,
    fontSize: 12,
    fontWeight: 600,
  },
};

/** Presets relevant to a zone: primary presetId first, then tag matches on zone/park name. */
function presetsForZone(zone, presets, parks) {
  const park = zone.parkId ? (parks || []).find((p) => p.id === zone.parkId) : null;
  const needles = [zone.name, park?.name].filter(Boolean).map((s) => s.toLowerCase());
  const primary = zone.presetId ? (presets || []).find((p) => p.id === zone.presetId) : null;
  const primaryId = primary?.id;

  const tagged = (presets || []).filter((p) => {
    if (p.id === primaryId) return false;
    return (p.tags || []).some((tag) => {
      const t = String(tag).toLowerCase();
      return needles.some((n) => t.includes(n) || n.includes(t));
    });
  });

  return { primary, tagged };
}

function ShotButton({ preset, variant = 'default', firingId, onFire }) {
  return (
    <AppButton
      variant={variant}
      size="md"
      onClick={() => onFire(preset)}
      disabled={firingId === preset.id}
      style={shotBtnStyle}
      styles={shotBtnStyles}
    >
      {firingId === preset.id ? '…' : preset.name}
    </AppButton>
  );
}

function ZonePresetGroup({
  label,
  primary,
  tagged,
  collapsed,
  onToggle,
  firingId,
  onFire,
  highlight = false,
}) {
  const hasAny = primary || tagged.length > 0;

  return (
    <Box mb="sm">
      <AppButton
        type="button"
        variant="default"
        fullWidth
        size="compact-xs"
        mb={6}
        onClick={onToggle}
        styles={{ root: { justifyContent: 'flex-start' } }}
      >
        {collapsed ? '▸' : '▾'} {label}
        {highlight ? ' · here' : ''}
      </AppButton>
      {!collapsed && !hasAny && (
        <Text size="xs" c="dimmed" px="xs">
          No linked presets — tag presets with this zone or park name.
        </Text>
      )}
      {!collapsed && hasAny && (
        <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="sm">
          {primary && (
            <ShotButton preset={primary} variant="primary" firingId={firingId} onFire={onFire} />
          )}
          {tagged.map((p) => (
            <ShotButton key={p.id} preset={p} firingId={firingId} onFire={onFire} />
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}

export function ShotBoxPage({ data }) {
  const [mode, setMode] = useState('all'); // 'all' | 'near'
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState<any>(null);
  const [firingId, setFiringId] = useState<any>(null);
  const [fireError, setFireError] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, any>>({});

  const wled = usePresetWled(data, null);
  const geo = useGeoPosition({ enabled: mode === 'near' });

  const presets = data.presets || [];
  const filteredPresets = useMemo(
    () => presets.filter((p) => itemMatchesTagFilter(p, search, activeTag)),
    [presets, search, activeTag],
  );

  const nearMe = useMemo(() => {
    if (mode !== 'near' || geo.status !== 'active' || !geo.position) return null;
    const current = findTriggerZone(geo.position, data.zones || []);
    if (!current) return { kind: 'outside' };

    const currentGroup = presetsForZone(current, presets, data.parks);
    const neighbors = (data.zones || []).filter(
      (z) =>
        z.id !== current.id &&
        z.enabled &&
        ((current.parkId && z.parkId === current.parkId) || (!current.parkId && !z.parkId)),
    );

    return {
      kind: 'inside',
      current,
      currentGroup,
      neighbors: neighbors.map((z) => ({
        zone: z,
        ...presetsForZone(z, presets, data.parks),
      })),
    };
  }, [mode, geo.status, geo.position, data.zones, data.parks, presets]);

  const fire = async (preset) => {
    setFiringId(preset.id);
    setFireError('');
    try {
      const ip = wled.wledIp.trim();
      if (!ip) throw new Error('Enter a WLED IP first.');
      localStorage.setItem('wled-ip', ip);
      await testPresetOnWled(ip, preset, data);
    } catch {
      setFireError(`Could not fire "${preset.name}" — check WLED connection.`);
    } finally {
      setFiringId(null);
    }
  };

  const toggleSection = (key) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const sectionCollapsed = (key, defaultCollapsed) =>
    Object.prototype.hasOwnProperty.call(collapsedSections, key)
      ? collapsedSections[key]
      : defaultCollapsed;

  return (
    <Box
      h="100%"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <Paper
        p="sm"
        radius={0}
        bg="var(--surface)"
        style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}
      >
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <Title order={4}>🎯 Shot Box</Title>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={setMode}
            data={[
              { label: 'All presets', value: 'all' },
              { label: 'Near me', value: 'near' },
            ]}
          />
        </Group>
      </Paper>

      <Stack gap="sm" p="sm" style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {wled.wledStatus !== 'connected' && (
          <Paper p="xs" radius="md" bg="var(--surface2)" style={{ border: '1px solid var(--border)', flexShrink: 0 }}>
            <Stack gap={6}>
              <Text size="xs" c="dimmed">
                WLED not connected — enter IP and tap Go to fire presets.
              </Text>
              <Group gap={4} wrap="nowrap">
                <TextInput
                  value={wled.wledIp}
                  onChange={(e) => wled.setWledIp(e.target.value)}
                  placeholder="4.3.2.1"
                  size="xs"
                  style={{ flex: 1 }}
                  onKeyDown={(e) => e.key === 'Enter' && wled.connectWled()}
                />
                <AppButton
                  variant={wled.wledStatus === 'error' ? 'danger' : 'primary'}
                  size="compact-xs"
                  onClick={wled.connectWled}
                >
                  {wled.wledStatus === 'connecting' ? '…' : 'Go'}
                </AppButton>
              </Group>
            </Stack>
          </Paper>
        )}

        {fireError && (
          <Alert color="red" variant="light" onClose={() => setFireError('')} withCloseButton style={{ flexShrink: 0 }}>
            {fireError}
          </Alert>
        )}

        {mode === 'all' && (
          <>
            <Box style={{ flexShrink: 0 }}>
              <TagFilterBar
                items={presets}
                search={search}
                onSearchChange={setSearch}
                activeTag={activeTag}
                onActiveTagChange={setActiveTag}
              />
            </Box>
            <ScrollArea style={{ flex: 1, minHeight: 0 }}>
              {filteredPresets.length === 0 ? (
                <Text size="sm" c="dimmed" p="md">
                  No presets match.
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="sm" p={4}>
                  {filteredPresets.map((p) => (
                    <ShotButton key={p.id} preset={p} firingId={firingId} onFire={fire} />
                  ))}
                </SimpleGrid>
              )}
            </ScrollArea>
          </>
        )}

        {mode === 'near' && (
          <ScrollArea style={{ flex: 1, minHeight: 0 }}>
            {(geo.status === 'unsupported' || geo.status === 'denied') && (
              <Alert color="yellow" variant="light">
                Location access is off or unavailable — switch to All presets, or enable location for
                this site in your browser settings.
                {geo.error ? ` (${geo.error})` : ''}
              </Alert>
            )}
            {geo.status === 'error' && (
              <Alert color="red" variant="light">
                <Group gap="sm" align="center">
                  <Text size="sm" style={{ flex: 1 }}>
                    Location error{geo.error ? `: ${geo.error}` : ''}.
                  </Text>
                  <AppButton variant="default" size="compact-xs" onClick={geo.retry}>
                    Retry
                  </AppButton>
                </Group>
              </Alert>
            )}
            {(geo.status === 'requesting' || geo.status === 'idle') && (
              <Text size="sm" c="dimmed" p="md">
                Getting your location…
              </Text>
            )}
            {geo.status === 'active' && nearMe?.kind === 'outside' && (
              <Alert color="gray" variant="light">
                No zone here yet — switch to All presets.
              </Alert>
            )}
            {geo.status === 'active' && nearMe?.kind === 'inside' && (
              <Stack gap="xs" p={4}>
                <Text size="xs" c="dimmed">
                  ±{Math.round(geo.position?.accuracy || 0)}m accuracy
                </Text>
                <ZonePresetGroup
                  label={`📍 ${nearMe.current.name}`}
                  primary={nearMe.currentGroup.primary}
                  tagged={nearMe.currentGroup.tagged}
                  collapsed={sectionCollapsed(`cur-${nearMe.current.id}`, false)}
                  onToggle={() => toggleSection(`cur-${nearMe.current.id}`)}
                  firingId={firingId}
                  onFire={fire}
                  highlight
                />
                {nearMe.neighbors.length > 0 && (
                  <Text size="xs" c="dimmed" fw={700} tt="uppercase" mt="xs">
                    Also nearby
                  </Text>
                )}
                {nearMe.neighbors.map(({ zone, primary, tagged }) => (
                  <ZonePresetGroup
                    key={zone.id}
                    label={zone.name}
                    primary={primary}
                    tagged={tagged}
                    collapsed={sectionCollapsed(`n-${zone.id}`, true)}
                    onToggle={() => toggleSection(`n-${zone.id}`)}
                    firingId={firingId}
                    onFire={fire}
                  />
                ))}
              </Stack>
            )}
          </ScrollArea>
        )}
      </Stack>
    </Box>
  );
}
