import { useState, useMemo } from 'react';
import {
  ActionIcon,
  Box,
  Group,
  ScrollArea,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ColorCell } from '../shared/ColorCell';
import { Field } from '../shared/Field';
import { TagChipRow } from '../shared/TagChipRow';
import { TagEditor } from '../shared/TagEditor';
import { TagFilterBar } from '../shared/TagFilterBar';
import { AppButton, AppCard } from '../shared/styles';
import { duplicateTaggedName, itemMatchesTagFilter } from '../../lib/tags';
import { generateId, normalizeHex, saveColorToLibrary } from '../../lib/utils';
import { ColorCalibrationPanel } from './ColorCalibrationPanel';

export function PalettesTab({ data, update }) {
  const savedColors = data.savedColors || [];
  const [ptab, setPtab] = useState('colors');
  const [editSc, setEditSc] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const saveColor = (hex) => saveColorToLibrary(data, update, hex);

  const listItems = ptab === 'colors' ? savedColors : [];
  const filteredList = useMemo(
    () => listItems.filter(item => itemMatchesTagFilter(item, search, activeTag)),
    [listItems, search, activeTag],
  );

  const blankSavedColor = () => ({ id: generateId(), name: '', hex: '#ffffff', tags: [] });

  const saveSc = () => {
    if (!editSc.name.trim()) return alert('Enter a name');
    const hex = normalizeHex(editSc.hex);
    if (!hex) return alert('Enter a valid hex color');
    const entry = { ...editSc, name: editSc.name.trim(), hex };
    update({ savedColors: isNew ? [...savedColors, entry] : savedColors.map(c => c.id === entry.id ? entry : c) });
    setEditSc(null);
  };
  const delSc = id => {
    if (!confirm('Delete saved color?')) return;
    update({ savedColors: savedColors.filter(c => c.id !== id) });
    setEditSc(null);
  };

  const duplicateSc = (c) => {
    const copy = {
      ...c,
      id: generateId(),
      name: duplicateTaggedName(c.name),
      hex: c.hex,
      tags: [...(c.tags || [])],
    };
    update({ savedColors: [...savedColors, copy] });
    setEditSc(copy);
    setIsNew(false);
  };

  const switchTab = (t) => {
    setPtab(t);
    setEditSc(null);
    setSearch('');
    setActiveTag(null);
  };

  return (
    <Box style={{ display: 'flex', height: '100%' }}>
      <Box
        w={260}
        bg="var(--surface)"
        style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}
      >
        <Tabs value={ptab} onChange={switchTab}>
          <Tabs.List grow>
            <Tabs.Tab value="colors">Colors ({savedColors.length})</Tabs.Tab>
            <Tabs.Tab value="calibration">Calibration</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        {listItems.length > 0 && (
          <TagFilterBar items={listItems} search={search} onSearchChange={setSearch}
            activeTag={activeTag} onActiveTagChange={setActiveTag} />
        )}
        <ScrollArea style={{ flex: 1 }} p="sm">
          {ptab === 'calibration' && (
            <Text size="xs" c="dimmed" lh={1.5}>
              Tune per-channel RGB curves for BLE-extracted colors. Push via Board sync.
            </Text>
          )}
          {ptab === 'colors' && (
            <Stack gap="sm">
              <AppButton variant="primary" fullWidth size="compact-sm" onClick={() => { setEditSc(blankSavedColor()); setIsNew(true); }}>
                + New Saved Color
              </AppButton>
              {savedColors.length === 0 && (
                <Text size="xs" c="dimmed">No saved colors yet — save from any color picker or add one here.</Text>
              )}
              {savedColors.length > 0 && filteredList.length === 0 && (
                <Text size="xs" c="dimmed">No matches</Text>
              )}
              {filteredList.map(c => (
                <AppCard
                  key={c.id}
                  p="sm"
                  style={{
                    cursor: 'pointer',
                    background: editSc?.id === c.id ? 'var(--primary-dim)' : 'var(--surface)',
                  }}
                  onClick={() => { setEditSc({ ...c }); setIsNew(false); }}
                >
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <Box
                      w={28}
                      h={28}
                      style={{
                        borderRadius: 6,
                        background: c.hex,
                        border: '1px solid var(--border)',
                        flexShrink: 0,
                      }}
                    />
                    <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600}>{c.name}</Text>
                      <TagChipRow tags={c.tags} />
                      <Text size="xs" c="dimmed" ff="monospace">{c.hex}</Text>
                    </Stack>
                    <ActionIcon
                      variant="default"
                      size="sm"
                      title="Duplicate"
                      onClick={e => { e.stopPropagation(); duplicateSc(c); }}
                    >
                      ⧉
                    </ActionIcon>
                  </Group>
                </AppCard>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Box>

      {ptab === 'calibration' && (
        <ScrollArea style={{ flex: 1 }}>
          <ColorCalibrationPanel data={data} update={update} />
        </ScrollArea>
      )}

      {editSc && ptab === 'colors' && (
        <ScrollArea style={{ flex: 1 }}>
          <Stack p="lg" gap="sm">
            <Group justify="space-between" align="center">
              <Title order={4}>{isNew ? 'New Saved Color' : 'Edit Saved Color'}</Title>
              <Group gap="xs">
                {!isNew && (
                  <AppButton variant="default" size="compact-sm" onClick={() => duplicateSc(editSc)}>Duplicate</AppButton>
                )}
                {!isNew && (
                  <AppButton variant="danger" size="compact-sm" onClick={() => delSc(editSc.id)}>Delete</AppButton>
                )}
              </Group>
            </Group>
            <Field label="Name">
              <TextInput
                value={editSc.name}
                onChange={e => setEditSc({ ...editSc, name: e.target.value })}
                placeholder="e.g. Castle purple"
                autoFocus
              />
            </Field>
            <TagEditor tags={editSc.tags || []} onChange={tags => setEditSc({ ...editSc, tags })} />
            <ColorCell color={editSc.hex} savedColors={savedColors}
              onChange={hex => setEditSc({ ...editSc, hex })}
              onSaveColor={saveColor} />
            <AppButton variant="primary" mt="sm" onClick={saveSc}>Save Color</AppButton>
          </Stack>
        </ScrollArea>
      )}
    </Box>
  );
}
