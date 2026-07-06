import { useState, useMemo } from 'react';
import {
  ActionIcon,
  Box,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { ColorCell } from '../shared/ColorCell';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { SegmentBar } from '../shared/SegmentBar';
import { TagChipRow } from '../shared/TagChipRow';
import { TagEditor } from '../shared/TagEditor';
import { TagFilterBar } from '../shared/TagFilterBar';
import { AppButton, AppCard } from '../shared/styles';
import { STRIP_LED_COUNT } from '../../lib/ble/mbConstants';
import { duplicateTaggedName, itemMatchesTagFilter } from '../../lib/tags';
import { generateId, normalizeHex, saveColorToLibrary } from '../../lib/utils';
import { WLED_BLEND_MODES, buildLayoutPayload, captureSegmentFromRaw, fetchWledFullStateFromIp, formatSegLabel, isActiveSegment, parseWledStateSegments, postWledState, summarizeLayout } from '../../lib/wled/capture';

const blendModeOptions = [
  { value: '', label: '(inherit)' },
  ...WLED_BLEND_MODES.map((m) => ({ value: String(m.value), label: `${m.label} (${m.value})` })),
];

const optionalNum = (v) => (v === '' || v == null ? undefined : (typeof v === 'number' ? v : parseInt(String(v), 10)));

export function PalettesTab({ data, update }) {
  const layouts = data.customSegmentLayouts || [];
  const savedColors = data.savedColors || [];
  const [ptab, setPtab] = useState('segments');
  const [editL, setEditL] = useState(null);
  const [editSc, setEditSc] = useState(null);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTag, setActiveTag] = useState(null);
  const [wledIp, setWledIp] = useState(() => localStorage.getItem('wled-ip') || '4.3.2.1');
  const [capturing, setCapturing] = useState(false);
  const saveColor = (hex) => saveColorToLibrary(data, update, hex);

  const listItems = ptab === 'colors' ? savedColors : layouts;
  const filteredList = useMemo(
    () => listItems.filter(item => itemMatchesTagFilter(item, search, activeTag)),
    [listItems, search, activeTag],
  );

  const blankSavedColor = () => ({ id: generateId(), name: '', hex: '#ffffff', tags: [] });
  const blankLayout = () => ({
    id: generateId(), name: '', createdAt: Date.now(),
    segments: [{ id: 0, start: 0, stop: STRIP_LED_COUNT }],
  });

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

  const saveLayout = () => {
    if (!editL.name.trim()) return alert('Enter a name');
    if (!(editL.segments || []).some(isActiveSegment)) return alert('Add at least one active segment');
    update({ customSegmentLayouts: isNew ? [...layouts, editL] : layouts.map(l => l.id === editL.id ? editL : l) });
    setEditL(null);
  };
  const delLayout = id => {
    if (!confirm('Delete this segment layout?')) return;
    update({
      customSegmentLayouts: layouts.filter(l => l.id !== id),
      presets: (data.presets || []).map(p => p.segmentLayoutId === id ? { ...p, segmentLayoutId: undefined } : p),
    });
    setEditL(null);
  };

  const updateLayoutSeg = (idx, patch) => {
    setEditL(l => ({ ...l, segments: l.segments.map((s, i) => i === idx ? { ...s, ...patch } : s) }));
  };

  const captureFromWled = async () => {
    localStorage.setItem('wled-ip', wledIp.trim());
    setCapturing(true);
    try {
      const state = await fetchWledFullStateFromIp(wledIp);
      const segments = parseWledStateSegments(state).map(seg => captureSegmentFromRaw(seg, {
        effect: true, palette: true, parameters: true, color: true, segments: true,
      }));
      setEditL(l => l ? { ...l, segments } : { ...blankLayout(), segments });
    } catch (e) {
      alert(e.message || 'Capture failed');
    } finally {
      setCapturing(false);
    }
  };

  const applyLayout = async (layout) => {
    localStorage.setItem('wled-ip', wledIp.trim());
    try {
      await postWledState(wledIp, buildLayoutPayload(layout));
    } catch (e) {
      alert(e.message || 'Apply failed');
    }
  };

  const switchTab = (t) => {
    setPtab(t);
    setEditL(null);
    setEditSc(null);
    setSearch('');
    setActiveTag(null);
  };

  return (
    <Box style={{ display: 'flex', height: '100%' }}>
      {/* List panel */}
      <Box
        w={260}
        bg="var(--surface)"
        style={{ borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}
      >
        <Tabs value={ptab} onChange={switchTab}>
          <Tabs.List grow>
            <Tabs.Tab value="segments">Segments ({layouts.length})</Tabs.Tab>
            <Tabs.Tab value="colors">Colors ({savedColors.length})</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        {listItems.length > 0 && (
          <TagFilterBar items={listItems} search={search} onSearchChange={setSearch}
            activeTag={activeTag} onActiveTagChange={setActiveTag} />
        )}
        <ScrollArea style={{ flex: 1 }} p="sm">
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
          {ptab === 'segments' && (
            <Stack gap="sm">
              <Paper p="xs" bg="var(--surface2)" radius="md">
                <Stack gap={6}>
                  <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 1 }}>WLED IP</Text>
                  <TextInput
                    value={wledIp}
                    onChange={e => setWledIp(e.target.value)}
                    placeholder="4.3.2.1"
                    size="xs"
                    ff="monospace"
                  />
                </Stack>
              </Paper>
              <AppButton variant="primary" fullWidth size="compact-sm" onClick={() => { setEditL(blankLayout()); setIsNew(true); }}>
                + New Layout
              </AppButton>
              {layouts.length === 0 && (
                <Text size="xs" c="dimmed">No segment layouts yet</Text>
              )}
              {layouts.map(l => (
                <AppCard
                  key={l.id}
                  p="sm"
                  style={{
                    cursor: 'pointer',
                    background: editL?.id === l.id ? 'var(--primary-dim)' : 'var(--surface)',
                  }}
                  onClick={() => { setEditL({ ...l, segments: l.segments.map(s => ({ ...s })) }); setIsNew(false); }}
                >
                  <Text size="sm" fw={600} mb={6}>{l.name}</Text>
                  <SegmentBar segments={l.segments} />
                  <Text size="xs" c="dimmed" mt={4} ff="monospace">{summarizeLayout(l)}</Text>
                </AppCard>
              ))}
            </Stack>
          )}
        </ScrollArea>
      </Box>

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

      {/* Segment layout editor */}
      {editL && ptab === 'segments' && (
        <ScrollArea style={{ flex: 1 }}>
          <Stack p="lg" gap="sm">
            <Group justify="space-between" align="center">
              <Title order={4}>{isNew ? 'New Segment Layout' : 'Edit Segment Layout'}</Title>
              <Group gap="xs">
                {!isNew && (
                  <AppButton variant="primary" size="compact-sm" onClick={() => applyLayout(editL)}>Apply to WLED</AppButton>
                )}
                {!isNew && (
                  <AppButton variant="danger" size="compact-sm" onClick={() => delLayout(editL.id)}>Delete</AppButton>
                )}
              </Group>
            </Group>
            <Field label="Name">
              <TextInput
                value={editL.name}
                onChange={e => setEditL({ ...editL, name: e.target.value })}
                placeholder="e.g. Five corners"
                autoFocus
              />
            </Field>
            <Group gap="xs" wrap="wrap">
              <AppButton variant="default" size="compact-sm" onClick={captureFromWled} disabled={capturing}>
                {capturing ? 'Capturing…' : 'Capture from WLED'}
              </AppButton>
              {!isNew && (
                <AppButton variant="primary" size="compact-sm" onClick={() => applyLayout(editL)}>Apply to WLED</AppButton>
              )}
            </Group>
            <TagEditor tags={editL.tags || []} onChange={tags => setEditL({ ...editL, tags })} />
            {editL.segments.length > 0 && (
              <Field label="Preview"><SegmentBar segments={editL.segments} /></Field>
            )}
            <SectionHead>Segments (id, start LED, stop LED)</SectionHead>
            {editL.segments.map((seg, idx) => (
              <Box
                key={idx}
                component="details"
                open
                mb="sm"
                p="sm"
                bg="var(--surface2)"
                style={{ borderRadius: 8, border: '1px solid var(--border)' }}
              >
                <Box component="summary" style={{ cursor: 'pointer' }}>
                  <Text size="xs" fw={700}>
                    {formatSegLabel(seg)} · fx:{seg.fx ?? '-'} · pal:{seg.pal ?? '-'}
                  </Text>
                </Box>
                <SimpleGrid cols={3} spacing="xs" mt="sm">
                  <Field label="id">
                    <NumberInput
                      min={0}
                      max={31}
                      size="xs"
                      value={seg.id ?? 0}
                      onChange={v => updateLayoutSeg(idx, { id: parseInt(String(v ?? 0), 10) || 0 })}
                      hideControls
                    />
                  </Field>
                  <Field label="Start LED">
                    <NumberInput
                      min={0}
                      max={STRIP_LED_COUNT}
                      size="xs"
                      value={seg.start ?? 0}
                      onChange={v => updateLayoutSeg(idx, { start: parseInt(String(v ?? 0), 10) || 0 })}
                      hideControls
                    />
                  </Field>
                  <Field label="Stop LED">
                    <NumberInput
                      min={0}
                      max={STRIP_LED_COUNT}
                      size="xs"
                      value={seg.stop ?? 0}
                      onChange={v => updateLayoutSeg(idx, { stop: parseInt(String(v ?? 0), 10) || 0 })}
                      hideControls
                    />
                  </Field>
                  <Field label="fx">
                    <NumberInput
                      size="xs"
                      value={seg.fx ?? ''}
                      onChange={v => updateLayoutSeg(idx, { fx: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="pal">
                    <NumberInput
                      size="xs"
                      value={seg.pal ?? ''}
                      onChange={v => updateLayoutSeg(idx, { pal: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="bri">
                    <NumberInput
                      min={0}
                      max={255}
                      size="xs"
                      value={seg.bri ?? ''}
                      onChange={v => updateLayoutSeg(idx, { bri: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="sx">
                    <NumberInput
                      min={0}
                      max={255}
                      size="xs"
                      value={seg.sx ?? ''}
                      onChange={v => updateLayoutSeg(idx, { sx: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="ix">
                    <NumberInput
                      min={0}
                      max={255}
                      size="xs"
                      value={seg.ix ?? ''}
                      onChange={v => updateLayoutSeg(idx, { ix: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="c1/c2/c3">
                    <Group gap={4} wrap="nowrap">
                      {['c1', 'c2', 'c3'].map(k => (
                        <NumberInput
                          key={k}
                          min={0}
                          max={255}
                          size="xs"
                          style={{ flex: 1 }}
                          value={seg[k] ?? ''}
                          onChange={v => updateLayoutSeg(idx, { [k]: optionalNum(v) })}
                          hideControls
                        />
                      ))}
                    </Group>
                  </Field>
                  <Field label="of">
                    <NumberInput
                      size="xs"
                      value={seg.of ?? ''}
                      onChange={v => updateLayoutSeg(idx, { of: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="grp">
                    <NumberInput
                      size="xs"
                      value={seg.grp ?? ''}
                      onChange={v => updateLayoutSeg(idx, { grp: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="spc">
                    <NumberInput
                      size="xs"
                      value={seg.spc ?? ''}
                      onChange={v => updateLayoutSeg(idx, { spc: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="Blend mode">
                    <SearchableSelect
                      value={seg.bm ?? ''}
                      onChange={v => updateLayoutSeg(idx, { bm: v === '' ? undefined : parseInt(v, 10) })}
                      options={blendModeOptions}
                      allowEmpty
                      placeholder="(inherit)"
                    />
                  </Field>
                  <Field label="rev">
                    <NumberInput
                      size="xs"
                      value={seg.rev ?? ''}
                      onChange={v => updateLayoutSeg(idx, { rev: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                  <Field label="mi">
                    <NumberInput
                      size="xs"
                      value={seg.mi ?? ''}
                      onChange={v => updateLayoutSeg(idx, { mi: optionalNum(v) })}
                      hideControls
                    />
                  </Field>
                </SimpleGrid>
                <Group gap="md" mt="xs">
                  {['o1', 'o2', 'o3', 'on'].map(k => (
                    <Checkbox
                      key={k}
                      label={k}
                      size="xs"
                      checked={!!seg[k]}
                      onChange={e => updateLayoutSeg(idx, { [k]: e.target.checked })}
                    />
                  ))}
                </Group>
                {editL.segments.length > 1 && (
                  <AppButton
                    variant="danger"
                    size="compact-xs"
                    mt="xs"
                    onClick={() => setEditL({ ...editL, segments: editL.segments.filter((_, i) => i !== idx) })}
                  >
                    Remove segment
                  </AppButton>
                )}
              </Box>
            ))}
            <AppButton
              variant="default"
              fullWidth
              size="compact-sm"
              onClick={() => setEditL({
                ...editL,
                segments: [...editL.segments, {
                  id: editL.segments.length,
                  start: editL.segments[editL.segments.length - 1]?.stop ?? 0,
                  stop: STRIP_LED_COUNT,
                }],
              })}
            >
              + Add segment
            </AppButton>
            <AppButton variant="primary" onClick={saveLayout}>Save Layout</AppButton>
          </Stack>
        </ScrollArea>
      )}

      {ptab === 'segments' && !editL && (
        <Stack flex={1} align="center" justify="center" p="lg" ta="center">
          <Text size="sm" c="dimmed">
            Select a layout or click + New Layout
          </Text>
          <Text size="xs" c="dimmed" mt="xs">
            Set WLED IP and use Capture from WLED after configuring segments on the strip
          </Text>
        </Stack>
      )}
    </Box>
  );
}
