import { Badge, Group } from '@mantine/core';

export function TagChipRow({ tags }) {
  if (!tags?.length) return null;
  return (
    <Group gap={4} mt={4}>
      {tags.map((tag) => (
        <Badge key={tag} size="xs" variant="outline" color="gray">
          {tag}
        </Badge>
      ))}
    </Group>
  );
}
