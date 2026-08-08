import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Group,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { testPresetOnWled } from '../../lib/ble/chunking';
import { findTriggerZone } from '../../lib/geo';
import { itemMatchesTagFilter } from '../../lib/tags';
import { useGeoPosition } from '../../hooks/useGeoPosition';
import { usePresetWled } from './usePresetWled';
import { TagFilterBar } from '../shared/TagFilterBar';
import { AppButton } from '../shared/styles';

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

function ZonePresetGroup({
  label,
  primary,
  tagged,
  collapsed,
  onToggle,
  firingId,
  onFire,
  highlight,
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
            <AppButton
              variant="primary"
              size="xl"
              onClick={() => onFire(primary)}
              disabled={firingId === primary.id}
              style={{ height: 84, whiteSpace: 'normal', lineHeight: 1.2 }}
            >
              {firingId === primary.id ? '…' : primary.name}
            </AppButton>
          )}
          {tagged.map((p) => (
            <AppButton
              key={p.id}
              variant="default"
              size="xl"
              onClick={() => onFire(p)}
              disabled={firingId === p.id}
              style={{ height: 84, whiteSpace: 'normal', lineHeight: 1.2 }}
            >
              {firingId === p.id ? '…' : p.name}
            </AppButton>
          ))}
        </SimpleGrid>
      )}
    </Box>
  );
}

export function ShotBoxModal({ open, onClose, data }) {
  const isNarrow = useMediaQuery('(max-width: 48em)');
  const [mode, setMode] = useState('all'); // 'all' | 'near'
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [firingId, setFiringId] = useState(null);
  const [fireError, setFireError] = useState('');
  const [collapsedSections, setCollapsedSections] = useState({});

  const wled = usePresetWled(data, null);
  const geo = useGeoPosition({ enabled: open && mode === 'near' });

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
    <Modal
      opened={open}
      onClose={onClose}
      fullScreen={!!isNarrow}
      size="xl"
      title={
        <Group gap="md" wrap="wrap">
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
      }
      styles={{
        body: { paddingTop: 8, height: isNarrow ? 'calc(100vh - 60px)' : undefined },
      }}
    >
      <Stack gap="sm" style={{ height: isNarrow ? '100%' : '70vh', minHeight: 0 }}>
        {wled.wledStatus !== 'connected' && (
          <Paper p="xs" radius="md" bg="var(--surface2)" style={{ border: '1px solid var(--border)' }}>
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
          <Alert color="red" variant="light" onClose={() => setFireError('')} withCloseButton>
            {fireError}
          </Alert>
        )}

        {mode === 'all' && (
          <>
            <TagFilterBar
              items={presets}
              search={search}
              onSearchChange={setSearch}
              activeTag={activeTag}
              onActiveTagChange={setActiveTag}
            />
            <ScrollArea style={{ flex: 1, minHeight: 0 }}>
              {filteredPresets.length === 0 ? (
                <Text size="sm" c="dimmed" p="md">
                  No presets match.
                </Text>
              ) : (
                <SimpleGrid cols={{ base: 2, xs: 3, sm: 4, md: 5 }} spacing="sm" p={4}>
                  {filteredPresets.map((p) => (
                    <AppButton
                      key={p.id}
                      variant="default"
                      size="xl"
                      onClick={() => fire(p)}
                      disabled={firingId === p.id}
                      style={{ height: 84, whiteSpace: 'normal', lineHeight: 1.2 }}
                    >
                      {firingId === p.id ? '…' : p.name}
                    </AppButton>
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
    </Modal>
  );
}
