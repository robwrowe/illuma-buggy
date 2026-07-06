import { Button, Group, Stack, TextInput } from '@mantine/core';
import { collectAllTags } from '../../lib/tags';

export function TagFilterBar({ items, search, onSearchChange, activeTag, onActiveTagChange, placeholder }) {
  const allTags = collectAllTags(items);
  return (
    <Stack gap="xs" p="xs" style={{ borderBottom: '1px solid var(--border)' }}>
      <TextInput
        size="xs"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={placeholder || 'Search name or tags…'}
      />
      {allTags.length > 0 && (
        <Group gap={4}>
          <Button
            size="compact-xs"
            variant={!activeTag ? 'filled' : 'default'}
            onClick={() => onActiveTagChange(null)}
          >
            All
          </Button>
          {allTags.map((tag) => {
            const on = activeTag?.toLowerCase() === tag.toLowerCase();
            return (
              <Button
                key={tag}
                size="compact-xs"
                variant={on ? 'filled' : 'default'}
                onClick={() => onActiveTagChange(on ? null : tag)}
              >
                {tag}
              </Button>
            );
          })}
        </Group>
      )}
    </Stack>
  );
}
