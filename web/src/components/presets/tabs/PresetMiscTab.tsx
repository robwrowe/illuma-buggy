import { Checkbox, Group, Stack, Text } from '@mantine/core';
import { TagEditor } from '../../shared/TagEditor';

export function PresetMiscTab({ sel, setSel, setMemory, zones }) {
  return (
    <Stack gap="sm" maw={520}>
      <Text size="sm" fw={600}>Tags</Text>
      <TagEditor tags={sel.tags || []} onChange={(tags) => setSel({ ...sel, tags })} />

      <Text size="sm" fw={600} mt="md">Recall memory</Text>
      <Text size="sm" c="dimmed" lh={1.5}>
        When global recall is &quot;memory&quot;, only checked properties are applied from this preset.
        Use Import from WLED to snapshot the live strip and optionally sync these flags.
        Segment recall is also editable on the Segments tab.
      </Text>
      {Object.keys(sel.memory).map((k) => (
        <Group
          key={k}
          justify="space-between"
          align="center"
          py="xs"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <Text size="sm" tt="capitalize">{k}</Text>
          <Checkbox
            checked={sel.memory[k]}
            onChange={(e) => setMemory(k, e.target.checked)}
          />
        </Group>
      ))}

      <Text size="xs" c="dimmed" mt="md">Zone assignments using this preset:</Text>
      {(zones || []).filter((z) => z.presetId === sel.id).map((z) => (
        <Text key={z.id} size="sm" c="var(--primary)" py={2}>📍 {z.name}</Text>
      ))}
    </Stack>
  );
}
