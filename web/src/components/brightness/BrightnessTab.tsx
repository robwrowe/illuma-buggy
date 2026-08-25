import { Group, NumberInput, ScrollArea, Stack, Text, Title } from '@mantine/core';
import { Field } from '../shared/Field';
import { DEFAULT_DATA } from '../../lib/utils';

export function BrightnessTab({ data, update }) {
  const bc = data.brightnessConfig || DEFAULT_DATA.brightnessConfig;
  const set = (key, val) => update({ brightnessConfig: { ...bc, [key]: val } });
  return (
    <ScrollArea h="100%">
      <Stack p="md" gap="md" maw={520}>
        <Title order={3}>Brightness</Title>
        {[
          { k: 'daytime', label: 'Daytime', hint: 'Sun above threshold (0–255)' },
          { k: 'nighttime', label: 'Nighttime', hint: 'Sun below threshold (0–255)' },
          { k: 'indoor', label: 'Indoor', hint: 'Inside indoor zones (0–255)' },
          { k: 'solarThresholdDeg', label: 'Solar threshold (°)', hint: 'Elevation for day/night switch' },
          { k: 'transitionMinutes', label: 'Transition (min)', hint: 'Ramp duration at threshold' },
        ].map(({ k, label, hint }) => (
          <Field key={k} label={label}>
            <Group gap="md" align="center">
              <NumberInput
                min={0}
                max={k.includes('Deg') ? 90 : k.includes('Minutes') ? 120 : 255}
                value={bc[k]}
                onChange={(v) => set(k, Number(v) || 0)}
                w={80}
                styles={{ input: { textAlign: 'right' } }}
              />
              <Text size="xs" c="dimmed">{hint}</Text>
            </Group>
          </Field>
        ))}
      </Stack>
    </ScrollArea>
  );
}
