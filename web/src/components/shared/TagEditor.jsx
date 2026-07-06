import { useState, useEffect } from 'react';
import { Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { TAG_SUGGESTIONS, parseTagsInput, tagsToInput } from '../../lib/tags';

export function TagEditor({ tags, onChange, label }) {
  const [text, setText] = useState(tagsToInput(tags));
  useEffect(() => { setText(tagsToInput(tags)); }, [tags]);
  const commit = (raw) => {
    const next = parseTagsInput(raw);
    onChange(next);
    setText(tagsToInput(next));
  };
  const addSuggestion = (tag) => {
    if ((tags || []).some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    onChange([...(tags || []), tag].sort((a, b) => a.localeCompare(b)));
  };
  const unused = TAG_SUGGESTIONS.filter((sug) => !(tags || []).some((t) => t.toLowerCase() === sug.toLowerCase()));
  return (
    <Stack gap="xs" mb="sm">
      <Text size="sm" fw={600} c="dimmed">{label || 'Tags'}</Text>
      <Text size="xs" c="dimmed">Comma-separated — park, franchise, season, etc.</Text>
      <TextInput
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(text); }}
        placeholder="Magic Kingdom, Marvel, …"
      />
      {(tags || []).length > 0 && (
        <Group gap={6}>
          {tags.map((tag) => (
            <Button key={tag} size="compact-xs" variant="light" onClick={() => onChange(tags.filter((t) => t !== tag))}>
              {tag} ×
            </Button>
          ))}
        </Group>
      )}
      {unused.length > 0 && (
        <Group gap={4}>
          {unused.slice(0, 12).map((tag) => (
            <Button key={tag} size="compact-xs" variant="default" onClick={() => addSuggestion(tag)}>
              + {tag}
            </Button>
          ))}
        </Group>
      )}
    </Stack>
  );
}
