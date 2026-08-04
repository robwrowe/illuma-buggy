import { Checkbox, SimpleGrid, Slider } from '@mantine/core';
import { Field } from '../../shared/Field';

const PARAM_SLIDERS = [
  { k: 'sx', label: 'Speed', max: 255 },
  { k: 'ix', label: 'Intensity', max: 255 },
  { k: 'c1', label: 'Custom 1', max: 255 },
  { k: 'c2', label: 'Custom 2', max: 255 },
  { k: 'c3', label: 'Custom 3', max: 31 },
];

const PARAM_OPTS = [
  { k: 'o1', label: 'Option 1' },
  { k: 'o2', label: 'Option 2' },
  { k: 'o3', label: 'Option 3' },
];

export function PresetParamsTab({ sel, setGlobal }) {
  return (
    <SimpleGrid cols={2} spacing="md">
      {PARAM_SLIDERS.map(({ k, label, max }) => (
        <Field key={k} label={`${label}: ${sel.global[k] ?? 128}`}>
          <Slider
            min={0}
            max={max}
            value={sel.global[k] ?? 128}
            onChange={(v) => setGlobal(k, v)}
            size="xs"
          />
        </Field>
      ))}
      {PARAM_OPTS.map(({ k, label }) => (
        <Field key={k} label={label}>
          <Checkbox
            checked={sel.global[k] || false}
            onChange={(e) => setGlobal(k, e.target.checked)}
          />
        </Field>
      ))}
    </SimpleGrid>
  );
}
