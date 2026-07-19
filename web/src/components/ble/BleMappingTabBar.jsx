import { Button, Group } from '@mantine/core';

export function BleMappingTabBar({ active, onChange }) {
  const tabs = [
    { id: 'device', label: 'Device' },
    { id: 'rules', label: 'Rules' },
    { id: 'segmentMaps', label: 'Segment Maps' },
    { id: 'sw', label: 'Starlight' },
    { id: 'mb', label: 'MagicBand' },
    { id: 'show', label: 'Show Mode' },
    { id: 'colors', label: 'MB Colors' },
    { id: 'segments', label: 'Segments' },
    { id: 'general', label: 'General' },
  ];
  return (
    <Group gap={4} mb="md" pb="xs" style={{ borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      {tabs.map((t) => (
        <Button
          key={t.id}
          size="compact-sm"
          variant={active === t.id ? 'light' : 'default'}
          color={active === t.id ? 'violet' : 'gray'}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </Group>
  );
}
