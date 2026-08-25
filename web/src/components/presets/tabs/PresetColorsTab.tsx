import { Group, Stack, Text, TextInput } from '@mantine/core';
import { ColorCell } from '../../shared/ColorCell';
import { AppButton } from '../../shared/styles';
import { generateId } from '../../../lib/utils';

export function PresetColorsTab({ sel, setSel }) {
  const library = sel.colorLibrary || [];

  const setLibrary = (next) => setSel((s) => ({ ...s, colorLibrary: next }));

  const addColor = () => {
    setLibrary([
      ...library,
      { id: generateId(), name: '', hex: '#ffffff' },
    ]);
  };

  const updateEntry = (id, patch) => {
    setLibrary(library.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const removeEntry = (id) => {
    setLibrary(library.filter((c) => c.id !== id));
  };

  const usageCount = (id) => {
    let n = 0;
    (sel.global?.colorRefs || []).forEach((ref) => {
      if (ref?.mode === 'swatch' && ref.swatchId === id) n += 1;
    });
    Object.values(sel.segmentOverrides || {}).forEach((ov: any) => {
      (ov?.colors || []).forEach((c) => {
        if (c?.mode === 'swatch' && c.swatchId === id) n += 1;
      });
    });
    return n;
  };

  return (
    <Stack gap="sm" maw={520}>
      <Text size="sm" c="dimmed" lh={1.5}>
        Named colors for this preset. Use them from Global Effect and segment color overrides
        so you don&apos;t re-enter the same hex in multiple places.
      </Text>

      {library.length === 0 && (
        <Text size="sm" c="dimmed">No colors yet — add one below.</Text>
      )}

      {library.map((entry) => {
        const used = usageCount(entry.id);
        return (
          <Group key={entry.id} gap="sm" align="flex-start" wrap="nowrap">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 6,
                flexShrink: 0,
                marginTop: 4,
                background: entry.hex,
                border: '1px solid var(--border)',
              }}
            />
            <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
              <TextInput
                size="sm"
                value={entry.name}
                onChange={(e) => updateEntry(entry.id, { name: e.target.value })}
                placeholder="Name (optional)"
              />
              <ColorCell
                color={entry.hex}
                onChange={(hex) => updateEntry(entry.id, { hex })}
              />
              {used > 0 && (
                <Text size="xs" c="dimmed">Used in {used} place{used === 1 ? '' : 's'}</Text>
              )}
            </Stack>
            <AppButton
              type="button"
              variant="danger"
              size="compact-xs"
              onClick={() => removeEntry(entry.id)}
            >
              Delete
            </AppButton>
          </Group>
        );
      })}

      <AppButton
        type="button"
        variant="default"
        size="compact-sm"
        onClick={addColor}
        style={{ alignSelf: 'flex-start' }}
      >
        + Add color
      </AppButton>
    </Stack>
  );
}
