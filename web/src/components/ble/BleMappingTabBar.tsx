import { Button, Group } from '@mantine/core';

export function BleMappingTabBar({ active, onChange }) {
  const tabs = [
    { id: 'rules', label: 'Rules' },
    { id: 'segmentMaps', label: 'Segment Maps' },
    { id: 'timingModels', label: 'Timing Models' },
    { id: 'show', label: 'Show Mode' },
    { id: 'colors', label: 'BLE Colors' },
    { id: 'general', label: 'General' },
  ];
  return (
    <Group gap="xs" wrap="wrap">
      {tabs.map((t) => (
        <Button
          key={t.id}
          size="compact-sm"
          variant={active === t.id ? 'filled' : 'light'}
          color="violet"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </Button>
      ))}
    </Group>
  );
}
