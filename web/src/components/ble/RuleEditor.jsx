import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import { SegmentOverrideTable } from './SegmentOverrideTable';
import { MB_SEGMENT_META } from '../../lib/ble/mbConstants';
import {
  createEmptyColorBlend,
  createEmptyColorBlendSource,
  createEmptyCondition,
  createEmptyExtract,
  createEmptyExtractTarget,
  createEmptyMatchGroup,
  createEmptyRule,
  createEmptyRuleEffect,
  createEmptyRuleTiming,
  createEmptyStartTransition,
  createEmptyStopTransition,
  createEmptyTimingParamBinding,
  isTimingDerivedSource,
  normalizeMbMapping,
  reindexRulePriorities,
  SEGMENT_FIELD_PRESETS,
  shortRuleId,
  TIMING_DERIVED_SOURCES,
  WLED_START_TRANSITIONS,
} from '../../lib/ble/mbMapping';
import {
  bytesToHex,
  computeTimingLifecycle,
  disneyPayload,
  findMatchingRule,
  hexToBytes,
  previewExtracts,
  previewPacketAgainstRules,
} from '../../lib/ble/e9Decode';
import { parseCapturePaste } from '../../lib/ble/captureImport';
import { stripCompanyId } from '../../lib/ble/wandSimClient';

const CMP_OP_OPTS = [
  { value: 'eq', label: 'eq' },
  { value: 'gt', label: 'gt' },
  { value: 'gte', label: 'gte' },
  { value: 'lt', label: 'lt' },
  { value: 'lte', label: 'lte' },
];

const BYTE_OP_OPTS = [...CMP_OP_OPTS, { value: 'maskEq', label: 'maskEq' }];

const LEAF_TYPE_OPTS = [
  { value: 'hexPrefix', label: 'hexPrefix' },
  { value: 'length', label: 'length' },
  { value: 'byte', label: 'byte' },
  { value: 'bits', label: 'bits' },
];

const TARGET_KIND_OPTS = [
  { value: 'segmentColor', label: 'segmentColor' },
  { value: 'maskColor', label: 'maskColor' },
  { value: 'segmentField', label: 'segmentField' },
  { value: 'ignore', label: 'ignore' },
];

const MASK_OPTS = MB_SEGMENT_META.map((s) => ({
  value: s.id,
  label: s.label,
  searchText: `${s.id} ${s.label}`,
}));

const COLOR_SLOT_OPTS = [
  { value: '0', label: 'col0' },
  { value: '1', label: 'col1' },
  { value: '2', label: 'col2' },
];

function hexPacketsFromPaste(raw) {
  const parsed = parseCapturePaste(raw);
  if (parsed.mode === 'empty') return [];
  if (parsed.mode === 'capture') {
    return parsed.rows
      .map((r) => stripCompanyId(r.hex))
      .filter((h) => h.length >= 4);
  }
  const hex = stripCompanyId(parsed.hex || '');
  return hex.length >= 4 ? [hex] : [];
}

/** Collapsed-by-default section used across the rule editor. */
function CollapsibleBlock({
  title,
  summary,
  defaultOpen = false,
  headerRight,
  children,
  paperProps = {},
  titleSize = 'sm',
  titleFw = 700,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Paper p="sm" withBorder bg="var(--surface2)" {...paperProps}>
      <Group justify="space-between" mb={open ? 'xs' : 0} wrap="wrap" gap="xs">
        <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <AppButton size="compact-xs" variant="default" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'}
          </AppButton>
          <Text size={titleSize} fw={titleFw} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </Text>
          {!open && summary ? (
            <Text size="xs" c="dimmed" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {summary}
            </Text>
          ) : null}
        </Group>
        {headerRight}
      </Group>
      {open ? children : null}
    </Paper>
  );
}

/** Display/edit a 0–255 value as `0xNN` hex; storage stays decimal for the firmware. */
function formatHexByte(n) {
  return `0x${(Number(n) & 0xff).toString(16).toUpperCase().padStart(2, '0')}`;
}

function HexByteInput({ value, onChange, placeholder = '0x00' }) {
  const [text, setText] = useState(() => formatHexByte(value ?? 0));

  useEffect(() => {
    setText(formatHexByte(value ?? 0));
  }, [value]);

  const commit = (raw) => {
    const cleaned = String(raw ?? '').trim().replace(/^0x/i, '');
    if (cleaned === '') {
      onChange(0);
      setText(formatHexByte(0));
      return;
    }
    if (/[^0-9a-fA-F]/.test(cleaned)) {
      setText(formatHexByte(value ?? 0));
      return;
    }
    const parsed = parseInt(cleaned, 16);
    const clamped = Number.isFinite(parsed) ? Math.min(255, Math.max(0, parsed)) : 0;
    onChange(clamped);
    setText(formatHexByte(clamped));
  };

  return (
    <TextInput
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      placeholder={placeholder}
      styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
    />
  );
}

function ConditionLeafEditor({ node, onChange, onDelete }) {
  const set = (patch) => onChange({ ...node, ...patch });
  return (
    <Paper p="xs" withBorder bg="var(--surface2)">
      <Group gap="xs" align="flex-end" wrap="wrap" mb="xs">
        <Field label="Type">
          <SearchableSelect
            value={node.type}
            onChange={(type) => onChange(createEmptyCondition(type))}
            options={LEAF_TYPE_OPTS}
            allowEmpty={false}
          />
        </Field>
        <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Delete</AppButton>
      </Group>
      {node.type === 'hexPrefix' && (
        <Field label="Hex prefix">
          <TextInput
            value={node.value || ''}
            onChange={(e) => set({ value: e.target.value.replace(/[^0-9a-fA-F]/g, '') })}
            placeholder="E100E90C"
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          {/^8301/i.test(node.value || '') && (
            <Text size="xs" c="orange" mt={4}>
              Payloads are already stripped of the 83 01 CID prefix before rules evaluate them — omit it here (e.g. use E100E905, not 8301E100E905).
            </Text>
          )}
        </Field>
      )}
      {node.type === 'length' && (
        <Group gap="xs" grow>
          <Field label="Op">
            <SearchableSelect value={node.op || 'eq'} onChange={(op) => set({ op })} options={CMP_OP_OPTS} allowEmpty={false} />
          </Field>
          <Field label="Value">
            <NumberInput value={node.value ?? 0} onChange={(v) => set({ value: parseInt(v, 10) || 0 })} min={0} />
          </Field>
        </Group>
      )}
      {node.type === 'byte' && (
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
          <Field label="Offset">
            <NumberInput value={node.offset ?? 0} onChange={(v) => set({ offset: Math.max(0, parseInt(v, 10) || 0) })} min={0} />
          </Field>
          <Field label="Op">
            <SearchableSelect value={node.op || 'eq'} onChange={(op) => set({ op })} options={BYTE_OP_OPTS} allowEmpty={false} />
          </Field>
          <Field label="Value">
            <HexByteInput
              value={node.value ?? 0}
              onChange={(value) => set({ value })}
              placeholder="0x19"
            />
          </Field>
          {node.op === 'maskEq' && (
            <Field label="Mask">
              <HexByteInput
                value={node.mask ?? 255}
                onChange={(mask) => set({ mask })}
                placeholder="0xFF"
              />
            </Field>
          )}
        </SimpleGrid>
      )}
      {node.type === 'bits' && (
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
          <Field label="Offset">
            <NumberInput value={node.offset ?? 0} onChange={(v) => set({ offset: Math.max(0, parseInt(v, 10) || 0) })} min={0} />
          </Field>
          <Field label="bitStart">
            <NumberInput value={node.bitStart ?? 0} onChange={(v) => set({ bitStart: Math.min(7, Math.max(0, parseInt(v, 10) || 0)) })} min={0} max={7} />
          </Field>
          <Field label="bitCount">
            <NumberInput value={node.bitCount ?? 1} onChange={(v) => set({ bitCount: Math.min(32, Math.max(1, parseInt(v, 10) || 1)) })} min={1} max={32} />
          </Field>
          <Field label="Op">
            <SearchableSelect value={node.op || 'eq'} onChange={(op) => set({ op })} options={CMP_OP_OPTS} allowEmpty={false} />
          </Field>
          <Field label="Value">
            <NumberInput value={node.value ?? 0} onChange={(v) => set({ value: parseInt(v, 10) || 0 })} min={0} />
          </Field>
        </SimpleGrid>
      )}
    </Paper>
  );
}

function ConditionGroupEditor({ node, onChange, onDelete, depth = 0 }) {
  const [open, setOpen] = useState(false); // collapsed by default

  if (node?.type) {
    return <ConditionLeafEditor node={node} onChange={onChange} onDelete={onDelete} />;
  }

  const children = Array.isArray(node?.children) ? node.children : [];
  const setChild = (i, next) => {
    const copy = [...children];
    copy[i] = next;
    onChange({ ...node, children: copy });
  };
  const removeChild = (i) => {
    onChange({ ...node, children: children.filter((_, j) => j !== i) });
  };

  const leafCount = children.filter((c) => c?.type).length;
  const groupCount = children.filter((c) => c && !c.type).length;
  const summaryParts = [];
  if (leafCount) summaryParts.push(`${leafCount} condition${leafCount === 1 ? '' : 's'}`);
  if (groupCount) summaryParts.push(`${groupCount} group${groupCount === 1 ? '' : 's'}`);
  const summary = summaryParts.length ? summaryParts.join(', ') : 'empty';

  return (
    <Paper
      p="sm"
      withBorder
      style={{
        marginLeft: depth ? 8 : 0,
        borderColor: node.mode === 'some' ? 'var(--mantine-color-orange-5)' : 'var(--border)',
      }}
    >
      <Group justify="space-between" mb={open ? 'xs' : 0} wrap="wrap">
        <Group gap="xs">
          <AppButton size="compact-xs" variant="default" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'}
          </AppButton>
          <Badge size="sm" variant="light" color={node.mode === 'some' ? 'orange' : 'violet'}>
            {node.mode === 'some' ? 'OR (some)' : 'AND (all)'}
          </Badge>
          {!open && (
            <Text size="xs" c="dimmed">{summary}</Text>
          )}
          {open && (
            <AppButton
              size="compact-xs"
              variant="default"
              onClick={() => onChange({ ...node, mode: node.mode === 'some' ? 'all' : 'some' })}
            >
              Toggle AND/OR
            </AppButton>
          )}
        </Group>
        {onDelete && (
          <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Delete group</AppButton>
        )}
      </Group>
      {open && (
        <>
          <Stack gap="xs">
            {children.map((child, i) => (
              <ConditionGroupEditor
                key={i}
                node={child}
                depth={depth + 1}
                onChange={(n) => setChild(i, n)}
                onDelete={() => removeChild(i)}
              />
            ))}
          </Stack>
          <Group gap="xs" mt="xs">
            <AppButton
              size="compact-xs"
              variant="default"
              onClick={() => onChange({ ...node, children: [...children, createEmptyCondition('hexPrefix')] })}
            >
              Add condition
            </AppButton>
            <AppButton
              size="compact-xs"
              variant="default"
              onClick={() => onChange({ ...node, children: [...children, createEmptyMatchGroup('all')] })}
            >
              Add nested group
            </AppButton>
          </Group>
        </>
      )}
    </Paper>
  );
}

function TargetRowEditor({ target, segmentOpts, onChange, onDelete }) {
  const setKind = (kind) => onChange(createEmptyExtractTarget(kind));
  const isMultiSeg = Array.isArray(target.segmentIds);
  return (
    <Paper p="xs" withBorder bg="var(--bg)">
      <Group justify="space-between" mb="xs">
        <Text size="xs" fw={600}>Target</Text>
        <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Remove</AppButton>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Field label="Kind">
          <SearchableSelect
            value={target.kind || 'maskColor'}
            onChange={setKind}
            options={TARGET_KIND_OPTS}
            allowEmpty={false}
          />
        </Field>
        {target.kind === 'segmentColor' && (
          <>
            <Field label="Segment mode">
              <SegmentedControl
                fullWidth
                size="xs"
                value={isMultiSeg ? 'multi' : 'single'}
                onChange={(mode) => {
                  if (mode === 'multi') {
                    const seed = target.segmentId ? [target.segmentId] : [];
                    const next = { kind: 'segmentColor', segmentIds: seed, colorSlot: target.colorSlot ?? 0 };
                    onChange(next);
                    return;
                  }
                  onChange({
                    kind: 'segmentColor',
                    segmentId: (target.segmentIds && target.segmentIds[0]) || target.segmentId || '',
                    colorSlot: target.colorSlot ?? 0,
                  });
                }}
                data={[
                  { label: 'Single', value: 'single' },
                  { label: 'Multi (pair)', value: 'multi' },
                ]}
              />
            </Field>
            {isMultiSeg ? (
              <Field label="Segments">
                <MultiSelect
                  size="xs"
                  searchable
                  data={(segmentOpts || []).map((o) => ({ value: o.value, label: o.label }))}
                  value={target.segmentIds || []}
                  onChange={(segmentIds) => onChange({
                    kind: 'segmentColor',
                    segmentIds,
                    colorSlot: target.colorSlot ?? 0,
                  })}
                  placeholder="Pick pair / group…"
                  comboboxProps={{ withinPortal: true }}
                />
              </Field>
            ) : (
              <Field label="Segment">
                <SearchableSelect
                  value={target.segmentId || ''}
                  onChange={(segmentId) => onChange({ kind: 'segmentColor', segmentId, colorSlot: target.colorSlot ?? 0 })}
                  options={segmentOpts}
                  placeholder="(pick segment)"
                  allowEmpty
                />
              </Field>
            )}
            <Field label="Color slot">
              <SearchableSelect
                value={String(target.colorSlot ?? 0)}
                onChange={(v) => onChange({
                  ...target,
                  kind: 'segmentColor',
                  colorSlot: parseInt(v, 10) || 0,
                })}
                options={COLOR_SLOT_OPTS}
                allowEmpty={false}
              />
            </Field>
          </>
        )}
        {target.kind === 'maskColor' && (
          <Field label="Mask">
            <SearchableSelect
              value={target.mask || 'all'}
              onChange={(mask) => onChange({ ...target, kind: 'maskColor', mask })}
              options={MASK_OPTS}
              allowEmpty={false}
            />
          </Field>
        )}
        {target.kind === 'segmentField' && (
          <>
            <Field label="Segment">
              <SearchableSelect
                value={target.segmentId || ''}
                onChange={(segmentId) => onChange({ ...target, kind: 'segmentField', segmentId })}
                options={segmentOpts}
                placeholder="(pick segment)"
                allowEmpty
              />
            </Field>
            <Field label="WLED field">
              <Group gap={4} mb={4} wrap="wrap">
                {SEGMENT_FIELD_PRESETS.map((p) => (
                  <AppButton
                    key={p.value}
                    size="compact-xs"
                    variant={target.field === p.value ? 'primary' : 'default'}
                    onClick={() => onChange({ ...target, kind: 'segmentField', field: p.value })}
                  >
                    {p.value}
                  </AppButton>
                ))}
              </Group>
              <TextInput
                value={target.field || ''}
                onChange={(e) => onChange({ ...target, kind: 'segmentField', field: e.target.value.trim() })}
                placeholder="sx, ix, c1… or any usermod field"
                styles={{ input: { fontFamily: 'monospace' } }}
              />
            </Field>
          </>
        )}
      </SimpleGrid>
    </Paper>
  );
}

function TimingParamBindingEditor({
  extract, segmentOpts, ruleTiming, timingModelOpts = [], onTimingChange, onEditTimingModels, onChange, onDelete,
}) {
  const set = (patch) => onChange({ ...extract, ...patch });
  const source = isTimingDerivedSource(extract.source) ? extract.source : 'timingFlashRate';
  const meta = TIMING_DERIVED_SOURCES.find((s) => s.value === source) || TIMING_DERIVED_SOURCES[0];
  const curve = extract.curve || createEmptyTimingParamBinding(source).curve;
  const target = (Array.isArray(extract.targets) && extract.targets[0])
    ? extract.targets[0]
    : { kind: 'segmentField', segmentId: '', field: meta.defaultField };
  const timingConfigured = !!(ruleTiming?.enabled && ruleTiming?.timingModelId);
  const isReciprocal = curve.type === 'reciprocal';

  const setSource = (next) => {
    const nextBinding = createEmptyTimingParamBinding(next);
    onChange({
      ...nextBinding,
      name: extract.name || nextBinding.name,
      targets: [{
        kind: 'segmentField',
        segmentId: target.segmentId || '',
        field: nextBinding.targets[0].field,
      }],
    });
  };

  const setTarget = (patch) => {
    set({
      targets: [{ ...target, kind: 'segmentField', ...patch }],
      paletteMap: false,
      source,
    });
  };

  return (
    <Paper p="xs" withBorder bg="var(--bg)">
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Text size="xs" fw={700}>Timing → param</Text>
        <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Remove</AppButton>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Field label="Timing model">
          <SearchableSelect
            value={ruleTiming?.timingModelId || ''}
            onChange={(timingModelId) => {
              onTimingChange?.({
                ...(ruleTiming || {}),
                enabled: true,
                timingModelId,
              });
            }}
            placeholder="Select timing model…"
            options={timingModelOpts}
            allowEmpty
          />
        </Field>
        <Field label="Decoded value">
          <SearchableSelect
            value={source}
            onChange={setSource}
            options={TIMING_DERIVED_SOURCES.map((s) => ({
              value: s.value,
              label: s.label,
              searchText: `${s.label} ${s.value}`,
            }))}
            allowEmpty={false}
          />
        </Field>
        {!timingConfigured && (
          <Text size="xs" c="orange" style={{ gridColumn: '1 / -1' }}>
            Pick a timing model — flash rate / on-time / final-cycle stretch come from that model&apos;s formulas. Without one, values read as 0.
            {onEditTimingModels ? (
              <>
                {' '}
                <Text
                  span
                  size="xs"
                  c="blue"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={onEditTimingModels}
                >
                  Edit timing models
                </Text>
              </>
            ) : null}
          </Text>
        )}
        <Field label="Name (optional)">
          <TextInput value={extract.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder={meta.label} />
        </Field>
        <Field label="Segment">
          <SearchableSelect
            value={target.segmentId || ''}
            onChange={(segmentId) => setTarget({ segmentId })}
            options={segmentOpts}
            placeholder="(pick segment from map)"
            allowEmpty
          />
        </Field>
        <Field label="WLED field">
          <Group gap={4} mb={4} wrap="wrap">
            {SEGMENT_FIELD_PRESETS.map((p) => (
              <AppButton
                key={p.value}
                size="compact-xs"
                variant={target.field === p.value ? 'primary' : 'default'}
                onClick={() => setTarget({ field: p.value })}
              >
                {p.value}
              </AppButton>
            ))}
          </Group>
          <TextInput
            value={target.field || ''}
            onChange={(e) => setTarget({ field: e.target.value.trim() })}
            placeholder="sx, ix, c1… or any usermod field"
            styles={{ input: { fontFamily: 'monospace' } }}
          />
        </Field>
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt="xs" mb={4}>
        Curve maps the decoded {meta.unit} value onto the field (0–255 typical). Reciprocal is for flash-rate→speed; linear for durations or unknown params.
      </Text>
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
        <Field label="Curve">
          <SearchableSelect
            value={curve.type || 'linear'}
            onChange={(type) => set({ curve: { ...curve, type } })}
            options={[
              { value: 'linear', label: 'linear' },
              { value: 'exponential', label: 'exponential' },
              { value: 'reciprocal', label: 'reciprocal (rate→param)' },
            ]}
            allowEmpty={false}
          />
        </Field>
        <Field label={`${meta.unit} min`}>
          <NumberInput
            value={curve.inMin ?? 0}
            decimalScale={2}
            onChange={(v) => set({ curve: { ...curve, inMin: Number(v) || 0 } })}
          />
        </Field>
        <Field label={`${meta.unit} max`}>
          <NumberInput
            value={curve.inMax ?? 50}
            decimalScale={2}
            onChange={(v) => set({ curve: { ...curve, inMax: Number(v) || 0 } })}
          />
        </Field>
        <Field label="outMin">
          <NumberInput value={curve.outMin ?? 0} onChange={(v) => set({ curve: { ...curve, outMin: Number(v) || 0 } })} />
        </Field>
        <Field label="outMax">
          <NumberInput value={curve.outMax ?? 255} onChange={(v) => set({ curve: { ...curve, outMax: Number(v) || 0 } })} />
        </Field>
        {curve.type === 'exponential' && (
          <Field label="exponent">
            <NumberInput value={curve.exponent ?? 2} step={0.1} onChange={(v) => set({ curve: { ...curve, exponent: Number(v) || 2 } })} />
          </Field>
        )}
        {isReciprocal && (
          <Field label="outScale">
            <NumberInput
              value={curve.outScale ?? 50}
              step={1}
              min={0.01}
              decimalScale={2}
              onChange={(v) => set({ curve: { ...curve, outScale: Number(v) || 50 } })}
            />
          </Field>
        )}
      </SimpleGrid>
    </Paper>
  );
}

function ColorBlendSourceEditor({ label, source, onChange }) {
  const src = source || createEmptyColorBlendSource();
  return (
    <Paper p="xs" withBorder bg="var(--bg)">
      <Text size="xs" fw={600} mb={4}>{label}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <Field label="Offset">
          <NumberInput
            value={src.offset ?? 0}
            onChange={(v) => onChange({ ...src, offset: Math.max(0, parseInt(v, 10) || 0) })}
            min={0}
          />
        </Field>
        <Field label="bitStart">
          <NumberInput
            value={src.bitStart ?? 0}
            onChange={(v) => onChange({ ...src, bitStart: Math.min(7, Math.max(0, parseInt(v, 10) || 0)) })}
            min={0}
            max={7}
          />
        </Field>
        <Field label="bitCount">
          <NumberInput
            value={src.bitCount ?? 8}
            onChange={(v) => onChange({ ...src, bitCount: Math.min(32, Math.max(1, parseInt(v, 10) || 1)) })}
            min={1}
            max={32}
          />
        </Field>
        <Field label="Source type">
          <SegmentedControl
            fullWidth
            size="xs"
            value={src.paletteMap === false ? 'raw' : 'palette'}
            onChange={(mode) => onChange({ ...src, paletteMap: mode === 'palette' })}
            data={[
              { label: 'Palette idx', value: 'palette' },
              { label: 'Raw', value: 'raw' },
            ]}
          />
        </Field>
      </SimpleGrid>
    </Paper>
  );
}

function ExtractRowEditor({ extract, segmentOpts, onChange, onDelete }) {
  const set = (patch) => onChange({ ...extract, ...patch, source: 'payloadBits' });
  const targets = Array.isArray(extract.targets) ? extract.targets : [];
  const curve = extract.curve || {
    type: 'linear', inMin: 0, inMax: 15, outMin: 0, outMax: 255, exponent: 2, outScale: 50,
  };
  const scale = extract.channelGroup?.scale || 'bitReplicate6to8';
  const defaultChannel = (offset) => (
    scale === 'direct8'
      ? { offset, bitStart: 0, bitCount: 8 }
      : { offset, bitStart: 1, bitCount: 6 }
  );
  const channelGroup = extract.channelGroup || {
    r: defaultChannel(8),
    g: defaultChannel(9),
    b: defaultChannel(10),
    scale: 'bitReplicate6to8',
  };
  const colorBlend = extract.colorBlend || createEmptyColorBlend();
  const isReciprocal = curve.type === 'reciprocal';
  const extractMode = extract.channelGroup
    ? 'channelGroup'
    : (extract.colorBlend
      ? 'colorBlend'
      : (extract.paletteMap ? 'palette' : 'curve'));
  const title = extract.name?.trim() ? extract.name.trim() : 'Packet extract';
  const summary = [
    extractMode === 'channelGroup'
      ? 'rgb channel group'
      : (extractMode === 'colorBlend' ? 'color blend' : `off ${extract.offset ?? 0}`),
    extractMode === 'channelGroup'
      ? (channelGroup.scale || 'bitReplicate6to8')
      : (extractMode === 'colorBlend'
        ? `ratio ${colorBlend.ratio?.mode || 'fixed'}`
        : (extractMode === 'palette' ? 'palette' : (curve.type || 'curve'))),
    `${targets.length} target${targets.length === 1 ? '' : 's'}`,
  ].join(' · ');

  const setChannel = (key, patch) => {
    const rest = {
      ...extract,
      source: 'payloadBits',
      paletteMap: false,
      channelGroup: {
        ...channelGroup,
        [key]: { ...(channelGroup[key] || defaultChannel(8)), ...patch },
      },
    };
    delete rest.curve;
    delete rest.colorBlend;
    onChange(rest);
  };

  const setExtractMode = (mode) => {
    if (mode === 'palette') {
      const rest = { ...extract, source: 'payloadBits', paletteMap: true };
      delete rest.curve;
      delete rest.channelGroup;
      delete rest.colorBlend;
      onChange(rest);
      return;
    }
    if (mode === 'channelGroup') {
      const rest = { ...extract, source: 'payloadBits', paletteMap: false };
      delete rest.curve;
      delete rest.colorBlend;
      onChange({
        ...rest,
        channelGroup: {
          r: channelGroup.r || defaultChannel(8),
          g: channelGroup.g || defaultChannel(9),
          b: channelGroup.b || defaultChannel(10),
          scale: channelGroup.scale || 'bitReplicate6to8',
        },
      });
      return;
    }
    if (mode === 'colorBlend') {
      const rest = { ...extract, source: 'payloadBits', paletteMap: false };
      delete rest.curve;
      delete rest.channelGroup;
      onChange({ ...rest, colorBlend: extract.colorBlend || createEmptyColorBlend() });
      return;
    }
    const rest = { ...extract, source: 'payloadBits', paletteMap: false, curve };
    delete rest.channelGroup;
    delete rest.colorBlend;
    onChange(rest);
  };

  const setScale = (nextScale) => {
    const bitDefaults = nextScale === 'direct8'
      ? { bitStart: 0, bitCount: 8 }
      : (nextScale === 'bitReplicate6to8' ? { bitStart: 1, bitCount: 6 } : null);
    const patchCh = (ch, fallbackOff) => ({
      ...(ch || defaultChannel(fallbackOff)),
      ...(bitDefaults || {}),
    });
    const rest = {
      ...extract,
      source: 'payloadBits',
      paletteMap: false,
      channelGroup: {
        r: patchCh(channelGroup.r, 8),
        g: patchCh(channelGroup.g, 9),
        b: patchCh(channelGroup.b, 10),
        scale: nextScale,
      },
    };
    delete rest.curve;
    delete rest.colorBlend;
    onChange(rest);
  };

  return (
    <CollapsibleBlock
      title={title}
      titleSize="xs"
      titleFw={600}
      summary={summary}
      paperProps={{ p: 'xs', bg: 'var(--surface2)' }}
      headerRight={<AppButton variant="danger" size="compact-xs" onClick={onDelete}>Delete</AppButton>}
    >
      <Text size="xs" c="dimmed" mb="xs">
        Reads bits from the packet. For flash rate / on-time → segment fields, use{' '}
        <strong>Timing → Add timing → param binding</strong> above (not this section).
      </Text>
      <Field label="Value mode">
        <SegmentedControl
          fullWidth
          value={extractMode}
          onChange={setExtractMode}
          data={[
            { label: 'Palette map', value: 'palette' },
            { label: 'Curve', value: 'curve' },
            { label: 'RGB channels', value: 'channelGroup' },
            { label: 'Color blend', value: 'colorBlend' },
          ]}
        />
      </Field>
      {extractMode !== 'channelGroup' && extractMode !== 'colorBlend' && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
          <Field label="Name">
            <TextInput value={extract.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="topLeft" />
          </Field>
          <Field label="Offset">
            <NumberInput value={extract.offset ?? 0} onChange={(v) => set({ offset: Math.max(0, parseInt(v, 10) || 0) })} min={0} />
          </Field>
          <Field label="bitStart">
            <NumberInput value={extract.bitStart ?? 0} onChange={(v) => set({ bitStart: Math.min(7, Math.max(0, parseInt(v, 10) || 0)) })} min={0} max={7} />
          </Field>
          <Field label="bitCount">
            <NumberInput value={extract.bitCount ?? 5} onChange={(v) => set({ bitCount: Math.min(32, Math.max(1, parseInt(v, 10) || 1)) })} min={1} max={32} />
          </Field>
        </SimpleGrid>
      )}
      {extractMode === 'channelGroup' && (
        <Stack gap="xs" mt="xs">
          <Field label="Name">
            <TextInput value={extract.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="e908Color" />
          </Field>
          {['r', 'g', 'b'].map((key) => {
            const ch = channelGroup[key] || defaultChannel(key === 'r' ? 8 : key === 'g' ? 9 : 10);
            return (
              <Paper key={key} p="xs" bg="var(--bg)" withBorder>
                <Text size="xs" fw={600} mb={4}>{key.toUpperCase()} channel</Text>
                <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                  <Field label="Offset">
                    <NumberInput
                      value={ch.offset ?? 0}
                      onChange={(v) => setChannel(key, { offset: Math.max(0, parseInt(v, 10) || 0) })}
                      min={0}
                    />
                  </Field>
                  <Field label="bitStart">
                    <NumberInput
                      value={ch.bitStart ?? (scale === 'direct8' ? 0 : 1)}
                      onChange={(v) => setChannel(key, { bitStart: Math.min(7, Math.max(0, parseInt(v, 10) || 0)) })}
                      min={0}
                      max={7}
                    />
                  </Field>
                  <Field label="bitCount">
                    <NumberInput
                      value={ch.bitCount ?? (scale === 'direct8' ? 8 : 6)}
                      onChange={(v) => setChannel(key, { bitCount: Math.min(32, Math.max(1, parseInt(v, 10) || 1)) })}
                      min={1}
                      max={32}
                    />
                  </Field>
                </SimpleGrid>
              </Paper>
            );
          })}
          <Field label="Scale">
            <SearchableSelect
              value={channelGroup.scale || 'bitReplicate6to8'}
              onChange={setScale}
              options={[
                { value: 'bitReplicate6to8', label: 'bitReplicate6to8 (6-bit packed)' },
                { value: 'direct8', label: 'direct8 (full-byte RGB)' },
                { value: 'none', label: 'none (pass-through)' },
              ]}
              allowEmpty={false}
            />
          </Field>
        </Stack>
      )}
      {extractMode === 'colorBlend' && (
        <Stack gap="xs" mt="xs">
          <Field label="Name">
            <TextInput value={extract.name || ''} onChange={(e) => set({ name: e.target.value })} placeholder="blendedColor" />
          </Field>
          <Text size="xs" c="dimmed">
            Static apply-time blend of two colors (not a live WLED cross-fade). Use for fixed
            in-between colors; use rule effect fx + col[0]/col[1] for animated fades.
          </Text>
          <ColorBlendSourceEditor
            label="Color A"
            source={colorBlend.a}
            onChange={(a) => set({ colorBlend: { ...colorBlend, a } })}
          />
          <ColorBlendSourceEditor
            label="Color B"
            source={colorBlend.b}
            onChange={(b) => set({ colorBlend: { ...colorBlend, b } })}
          />
          <Paper p="xs" withBorder bg="var(--bg)">
            <Text size="xs" fw={600} mb={4}>Blend ratio</Text>
            <SegmentedControl
              fullWidth
              size="xs"
              mb="xs"
              value={colorBlend.ratio?.mode === 'extract' ? 'extract' : 'fixed'}
              onChange={(mode) => {
                if (mode === 'extract') {
                  set({
                    colorBlend: {
                      ...colorBlend,
                      ratio: {
                        mode: 'extract',
                        offset: colorBlend.ratio?.offset ?? 0,
                        bitStart: colorBlend.ratio?.bitStart ?? 0,
                        bitCount: colorBlend.ratio?.bitCount ?? 8,
                      },
                    },
                  });
                  return;
                }
                set({
                  colorBlend: {
                    ...colorBlend,
                    ratio: { mode: 'fixed', value: colorBlend.ratio?.value ?? 0.5 },
                  },
                });
              }}
              data={[
                { label: 'Fixed', value: 'fixed' },
                { label: 'From payload', value: 'extract' },
              ]}
            />
            {colorBlend.ratio?.mode === 'extract' ? (
              <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
                <Field label="Offset">
                  <NumberInput
                    value={colorBlend.ratio.offset ?? 0}
                    onChange={(v) => set({
                      colorBlend: {
                        ...colorBlend,
                        ratio: { ...colorBlend.ratio, offset: Math.max(0, parseInt(v, 10) || 0) },
                      },
                    })}
                    min={0}
                  />
                </Field>
                <Field label="bitStart">
                  <NumberInput
                    value={colorBlend.ratio.bitStart ?? 0}
                    onChange={(v) => set({
                      colorBlend: {
                        ...colorBlend,
                        ratio: {
                          ...colorBlend.ratio,
                          bitStart: Math.min(7, Math.max(0, parseInt(v, 10) || 0)),
                        },
                      },
                    })}
                    min={0}
                    max={7}
                  />
                </Field>
                <Field label="bitCount">
                  <NumberInput
                    value={colorBlend.ratio.bitCount ?? 8}
                    onChange={(v) => set({
                      colorBlend: {
                        ...colorBlend,
                        ratio: {
                          ...colorBlend.ratio,
                          bitCount: Math.min(32, Math.max(1, parseInt(v, 10) || 1)),
                        },
                      },
                    })}
                    min={1}
                    max={32}
                  />
                </Field>
              </SimpleGrid>
            ) : (
              <Field label={`Ratio (${((colorBlend.ratio?.value ?? 0.5) * 100).toFixed(0)}% B)`}>
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={colorBlend.ratio?.value ?? 0.5}
                  onChange={(value) => set({
                    colorBlend: { ...colorBlend, ratio: { mode: 'fixed', value } },
                  })}
                  size="xs"
                />
              </Field>
            )}
          </Paper>
        </Stack>
      )}
      {extractMode === 'curve' && (
        <Stack gap="xs" mt="xs">
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
            <Field label="Curve">
              <SearchableSelect
                value={curve.type || 'linear'}
                onChange={(type) => set({ curve: { ...curve, type } })}
                options={[
                  { value: 'linear', label: 'linear' },
                  { value: 'exponential', label: 'exponential' },
                  { value: 'reciprocal', label: 'reciprocal (rate→param)' },
                ]}
                allowEmpty={false}
              />
            </Field>
            <Field label={isReciprocal ? 'Hz min (clamp)' : 'inMin'}>
              <NumberInput
                value={curve.inMin ?? 0}
                decimalScale={isReciprocal ? 2 : 0}
                onChange={(v) => set({ curve: { ...curve, inMin: Number(v) || 0 } })}
              />
            </Field>
            <Field label={isReciprocal ? 'Hz max (clamp)' : 'inMax'}>
              <NumberInput
                value={curve.inMax ?? 15}
                decimalScale={isReciprocal ? 2 : 0}
                onChange={(v) => set({ curve: { ...curve, inMax: Number(v) || 0 } })}
              />
            </Field>
            <Field label="outMin">
              <NumberInput value={curve.outMin ?? 0} onChange={(v) => set({ curve: { ...curve, outMin: Number(v) || 0 } })} />
            </Field>
            <Field label="outMax">
              <NumberInput value={curve.outMax ?? 255} onChange={(v) => set({ curve: { ...curve, outMax: Number(v) || 0 } })} />
            </Field>
            {curve.type === 'exponential' && (
              <Field label="exponent">
                <NumberInput value={curve.exponent ?? 2} step={0.1} onChange={(v) => set({ curve: { ...curve, exponent: Number(v) || 2 } })} />
              </Field>
            )}
            {isReciprocal && (
              <Field label="outScale">
                <NumberInput
                  value={curve.outScale ?? 50}
                  step={1}
                  min={0.01}
                  decimalScale={2}
                  onChange={(v) => set({ curve: { ...curve, outScale: Number(v) || 50 } })}
                />
              </Field>
            )}
          </SimpleGrid>
          {isReciprocal && (
            <Text size="xs" c="dimmed" lh={1.45}>
              Reciprocal treats extracted bits as a rate (Hz). For timing-model flash rate, use the Timing bindings section instead.
            </Text>
          )}
        </Stack>
      )}

      <CollapsibleBlock
        title="Targets"
        titleSize="xs"
        titleFw={600}
        summary={`${targets.length} target${targets.length === 1 ? '' : 's'}`}
        paperProps={{ p: 'xs', mt: 'sm', bg: 'var(--bg)' }}
      >
        <Stack gap="xs">
          {targets.map((t, i) => (
            <TargetRowEditor
              key={i}
              target={t}
              segmentOpts={segmentOpts}
              onChange={(next) => {
                const copy = [...targets];
                copy[i] = next;
                set({ targets: copy });
              }}
              onDelete={() => set({ targets: targets.filter((_, j) => j !== i) })}
            />
          ))}
        </Stack>
        <AppButton
          mt="xs"
          size="compact-xs"
          variant="default"
          onClick={() => set({ targets: [...targets, createEmptyExtractTarget('maskColor')] })}
        >
          Add target
        </AppButton>
      </CollapsibleBlock>
    </CollapsibleBlock>
  );
}

function RuleCard({
  rule,
  index,
  total,
  expanded,
  onToggle,
  onChange,
  onDelete,
  onDuplicate,
  onMove,
  presets,
  segmentMaps,
  timingModels = [],
  effectOptions = [],
  paletteOptions = [],
  onEditMaps,
  onEditTimingModels,
}) {
  const timing = rule.timing || createEmptyRuleTiming();
  const startTransition = rule.startTransition || createEmptyStartTransition();
  const stopTransition = rule.stopTransition || createEmptyStopTransition();
  const effect = rule.effect || createEmptyRuleEffect();
  const presetOpts = presets.map((p) => ({ value: p.id, label: p.name, searchText: p.name }));
  const mapOpts = (segmentMaps || []).map((m) => ({
    value: m.id,
    label: m.name || m.id,
    searchText: `${m.name || ''} ${m.id}`,
  }));
  const timingModelOpts = (timingModels || []).map((m) => ({
    value: m.id,
    label: m.name || m.id,
    searchText: `${m.name || ''} ${m.id}`,
  }));
  const selectedMap = (segmentMaps || []).find((m) => m.id === rule.segmentMapId) || null;
  const segmentOpts = (selectedMap?.segments || []).map((s) => ({
    value: s.id,
    label: `${s.id} · ${s.start}-${s.stop}`,
    searchText: `${s.id} ${s.start} ${s.stop}`,
  }));
  const fxOpts = (effectOptions || []).map((e) => ({
    value: String(e.id),
    label: e.name,
    searchText: `${e.id} ${e.name}`,
  }));
  const palOpts = (paletteOptions || []).map((p) => ({
    value: String(p.id),
    label: p.name,
    searchText: `${p.id} ${p.name}`,
  }));

  return (
    <AppCard p="sm" mb="xs" style={{ opacity: rule.enabled === false ? 0.65 : 1 }}>
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <AppButton size="compact-xs" variant="default" onClick={onToggle}>
            {expanded ? '▾' : '▸'}
          </AppButton>
          <Text fw={700} size="sm" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {rule.name || `Rule ${index + 1}`}
          </Text>
          <Badge size="xs" variant="outline">P{rule.priority ?? index * 10}</Badge>
          {rule.enabled === false && <Badge size="xs" color="gray">off</Badge>}
        </Group>
        <Group gap={4}>
          <AppButton size="compact-xs" variant="default" disabled={index === 0} onClick={() => onMove(-1)}>↑</AppButton>
          <AppButton size="compact-xs" variant="default" disabled={index >= total - 1} onClick={() => onMove(1)}>↓</AppButton>
          <AppButton size="compact-xs" variant="default" onClick={onDuplicate}>Duplicate</AppButton>
          <AppButton size="compact-xs" variant="danger" onClick={onDelete}>Delete</AppButton>
        </Group>
      </Group>

      {expanded && (
        <Stack gap="sm" mt="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <Field label="Name">
              <TextInput value={rule.name || ''} onChange={(e) => onChange({ ...rule, name: e.target.value })} />
            </Field>
            <Field label="Priority">
              <NumberInput
                value={rule.priority ?? index * 10}
                onChange={(v) => onChange({ ...rule, priority: parseInt(v, 10) || 0 })}
                description="Lower runs first; reorder buttons rewrite 0,10,20…"
              />
            </Field>
          </SimpleGrid>
          <Checkbox
            label="Enabled"
            checked={rule.enabled !== false}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
          />
          <Field label="Preset">
            <SearchableSelect
              value={rule.presetId || ''}
              onChange={(presetId) => onChange({ ...rule, presetId })}
              placeholder="(none — colors / fields only)"
              options={presetOpts}
              allowEmpty
            />
          </Field>
          {!rule.presetId && (
            <Stack gap="xs" mt="xs">
              <Checkbox
                label="Set a global effect (no preset)"
                checked={!!effect.enabled}
                onChange={(e) => onChange({
                  ...rule,
                  effect: { ...(rule.effect || createEmptyRuleEffect()), enabled: e.target.checked },
                })}
              />
              {effect.enabled && (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  <Field label="Effect">
                    <SearchableSelect
                      value={effect.fx >= 0 ? String(effect.fx) : ''}
                      onChange={(v) => onChange({
                        ...rule,
                        effect: { ...effect, fx: v === '' ? -1 : parseInt(v, 10) },
                      })}
                      options={fxOpts}
                      placeholder="(Solid)"
                      allowEmpty
                    />
                  </Field>
                  <Field label="Palette">
                    <SearchableSelect
                      value={effect.pal >= 0 ? String(effect.pal) : ''}
                      onChange={(v) => onChange({
                        ...rule,
                        effect: { ...effect, pal: v === '' ? -1 : parseInt(v, 10) },
                      })}
                      options={palOpts}
                      placeholder="(none)"
                      allowEmpty
                    />
                  </Field>
                  <Field label="Speed">
                    <Slider
                      min={0}
                      max={255}
                      value={effect.sx ?? 128}
                      onChange={(v) => onChange({ ...rule, effect: { ...effect, sx: v } })}
                      size="xs"
                    />
                  </Field>
                  <Field label="Intensity">
                    <Slider
                      min={0}
                      max={255}
                      value={effect.ix ?? 128}
                      onChange={(v) => onChange({ ...rule, effect: { ...effect, ix: v } })}
                      size="xs"
                    />
                  </Field>
                </SimpleGrid>
              )}
            </Stack>
          )}
          <Field label="Segment map">
            <SearchableSelect
              value={rule.segmentMapId || ''}
              onChange={(segmentMapId) => onChange({ ...rule, segmentMapId })}
              placeholder="(none)"
              options={mapOpts}
              allowEmpty
            />
          </Field>
          {onEditMaps && (
            <Stack gap={4}>
              <AppButton size="compact-xs" variant="default" onClick={onEditMaps}>
                Edit segments →
              </AppButton>
              <Text size="xs" c="dimmed">
                Geometry and map defaults live in Segment Maps. Rule segment sources (global or
                per-segment) are below.
              </Text>
            </Stack>
          )}
          {selectedMap && (
            <SegmentOverrideTable
              segments={selectedMap.segments || []}
              segmentOverrides={rule.segmentOverrides || {}}
              segmentSourceMode={rule.segmentSourceMode}
              extracts={rule.extract || []}
              effectOptions={effectOptions}
              paletteOptions={paletteOptions}
              onChange={(patch) => onChange({ ...rule, ...patch })}
            />
          )}

          <CollapsibleBlock
            title="Timing"
            summary={timing.enabled
              ? `on · hold ${timing.cooldownSec ?? 2}s${timing.timingModelId ? ` · ${timingModelOpts.find((m) => m.value === timing.timingModelId)?.label || timing.timingModelId}` : ''}`
              : 'off'}
          >
            <Text size="xs" c="dimmed" mb="xs">
              On-time comes from the packet timing byte (including final-cycle stretch from fadeBits).
              Cooldown is how long lights stay black after the stretched final cycle. Bind flash rate /
              on-time / stretch to segment fields (sx, ix, …) in the section at the bottom of this card.
            </Text>
            <Switch
              label="Use packet timing byte"
              checked={!!timing.enabled}
              onChange={(e) => onChange({
                ...rule,
                timing: { ...timing, enabled: e.target.checked },
              })}
              mb="xs"
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Field label="Byte offset">
                <NumberInput
                  value={timing.offset ?? 5}
                  onChange={(v) => onChange({
                    ...rule,
                    timing: { ...timing, offset: Math.max(0, parseInt(v, 10) || 0) },
                  })}
                  min={0}
                  disabled={!timing.enabled}
                />
              </Field>
              <Field label="Black hold / cooldown (sec)">
                <NumberInput
                  value={timing.cooldownSec ?? 2}
                  onChange={(v) => onChange({
                    ...rule,
                    timing: { ...timing, cooldownSec: Math.max(0, parseInt(v, 10) || 0) },
                  })}
                  min={0}
                  disabled={!timing.enabled}
                />
              </Field>
              <Field label="Stretch override (ms)">
                <NumberInput
                  value={timing.fadeOverrideMs ?? ''}
                  placeholder="Packet stretch"
                  onChange={(v) => {
                    const blank = v === '' || v === null || v === undefined;
                    onChange({
                      ...rule,
                      timing: {
                        ...timing,
                        fadeOverrideMs: blank ? null : Math.max(0, parseInt(v, 10) || 0),
                      },
                    });
                  }}
                  min={0}
                  disabled={!timing.enabled}
                />
              </Field>
            </SimpleGrid>
            <Field label="Timing model" mt="xs">
              <SearchableSelect
                value={timing.timingModelId || ''}
                onChange={(timingModelId) => onChange({
                  ...rule,
                  timing: { ...timing, enabled: true, timingModelId },
                })}
                placeholder="Select timing model (e.g. E9 0E strobe)…"
                options={timingModelOpts}
                allowEmpty
                disabled={!timing.enabled}
              />
            </Field>
            {onEditTimingModels && (
              <AppButton size="compact-xs" variant="default" mt={4} onClick={onEditTimingModels}>
                Edit timing models →
              </AppButton>
            )}
            <Text size="xs" c="dimmed" mt="xs" mb={4}>
              During black hold: onMatch restarts the effect; fixed ignores re-triggers
            </Text>
            <SegmentedControl
              fullWidth
              value={timing.cooldownResetMode === 'fixed' ? 'fixed' : 'onMatch'}
              onChange={(cooldownResetMode) => onChange({
                ...rule,
                timing: { ...timing, cooldownResetMode },
              })}
              disabled={!timing.enabled}
              data={[
                { label: 'onMatch', value: 'onMatch' },
                { label: 'fixed', value: 'fixed' },
              ]}
            />

            <Text size="sm" fw={700} mt="md" mb={4}>Wire timing values → segment fields</Text>
            <Text size="xs" c="dimmed" mb="xs" lh={1.45}>
              Duration (on / stretch / black hold) is controlled above. Use bindings here to push
              decoded flash rate, on-time, or final-cycle stretch through a curve into any segment
              param (sx, ix, c1–c3, o1–o3, or a custom usermod field).
            </Text>
            <Stack gap="xs">
              {(rule.extract || [])
                .map((ex, i) => ({ ex, i }))
                .filter(({ ex }) => isTimingDerivedSource(ex.source))
                .map(({ ex, i }) => (
                  <TimingParamBindingEditor
                    key={i}
                    extract={ex}
                    segmentOpts={segmentOpts}
                    ruleTiming={timing}
                    timingModelOpts={timingModelOpts}
                    onEditTimingModels={onEditTimingModels}
                    onTimingChange={(nextTiming) => onChange({
                      ...rule,
                      timing: { ...timing, ...nextTiming },
                    })}
                    onChange={(next) => {
                      const extract = [...(rule.extract || [])];
                      extract[i] = next;
                      onChange({ ...rule, extract });
                    }}
                    onDelete={() => onChange({
                      ...rule,
                      extract: (rule.extract || []).filter((_, j) => j !== i),
                    })}
                  />
                ))}
            </Stack>
            <AppButton
              mt="xs"
              size="compact-sm"
              variant="primary"
              onClick={() => onChange({
                ...rule,
                timing: { ...timing, enabled: true },
                extract: [...(rule.extract || []), createEmptyTimingParamBinding('timingFlashRate')],
              })}
            >
              Add timing → param binding
            </AppButton>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Start transition"
            summary={`${startTransition.type || 'fade'}${startTransition.type === 'instant' ? '' : ` · ${startTransition.timeMs ?? 400}ms`}`}
          >
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Field label="Type">
                <SearchableSelect
                  value={startTransition.type || 'fade'}
                  onChange={(type) => onChange({
                    ...rule,
                    startTransition: { ...startTransition, type },
                  })}
                  options={WLED_START_TRANSITIONS.map((t) => ({
                    value: t.value,
                    label: t.label,
                    searchText: `${t.label} ${t.value}`,
                  }))}
                  allowEmpty={false}
                />
              </Field>
              <Field label="timeMs">
                <NumberInput
                  value={startTransition.timeMs ?? 400}
                  onChange={(v) => onChange({
                    ...rule,
                    startTransition: { ...startTransition, timeMs: Math.max(0, parseInt(v, 10) || 0) },
                  })}
                  min={0}
                  disabled={startTransition.type === 'instant'}
                />
              </Field>
            </SimpleGrid>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Stop transition"
            summary={stopTransition.enabled
              ? `${stopTransition.type || 'fade'} · ${stopTransition.durationMode === 'custom' ? `${stopTransition.timeMs ?? 0}ms` : 'timing stretch'}`
              : 'off (plain FTB)'}
          >
            <Text size="xs" c="dimmed" mb="xs">
              How the effect transitions out to fade-to-black. Duration defaults to the timing
              byte&apos;s final-cycle stretch; choose Custom to override.
            </Text>
            <Switch
              label="Use stop transition"
              checked={!!stopTransition.enabled}
              onChange={(e) => onChange({
                ...rule,
                stopTransition: { ...stopTransition, enabled: e.target.checked },
              })}
              mb="xs"
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Field label="Type">
                <SearchableSelect
                  value={stopTransition.type || 'fade'}
                  onChange={(type) => onChange({
                    ...rule,
                    stopTransition: { ...stopTransition, enabled: true, type },
                  })}
                  options={WLED_START_TRANSITIONS.map((t) => ({
                    value: t.value,
                    label: t.label,
                    searchText: `${t.label} ${t.value}`,
                  }))}
                  allowEmpty={false}
                  disabled={!stopTransition.enabled}
                />
              </Field>
              <Field label="Duration">
                <SegmentedControl
                  fullWidth
                  value={stopTransition.durationMode === 'custom' ? 'custom' : 'timingFade'}
                  onChange={(durationMode) => onChange({
                    ...rule,
                    stopTransition: {
                      ...stopTransition,
                      enabled: true,
                      durationMode,
                      timeMs: durationMode === 'custom'
                        ? (stopTransition.timeMs ?? 400)
                        : stopTransition.timeMs,
                    },
                  })}
                  data={[
                    { value: 'timingFade', label: 'Timing stretch' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                  disabled={!stopTransition.enabled || stopTransition.type === 'instant'}
                />
              </Field>
            </SimpleGrid>
            {stopTransition.enabled && stopTransition.durationMode === 'custom'
              && stopTransition.type !== 'instant' && (
              <Field label="timeMs" mt="xs">
                <NumberInput
                  value={stopTransition.timeMs ?? 400}
                  onChange={(v) => onChange({
                    ...rule,
                    stopTransition: {
                      ...stopTransition,
                      timeMs: Math.max(0, parseInt(v, 10) || 0),
                    },
                  })}
                  min={0}
                />
              </Field>
            )}
          </CollapsibleBlock>

          <SectionHead>Match conditions</SectionHead>
          <ConditionGroupEditor
            node={rule.match || createEmptyMatchGroup('all')}
            onChange={(match) => onChange({ ...rule, match })}
          />

          <CollapsibleBlock
            title="Packet extracts"
            summary={`${(rule.extract || []).filter((ex) => !isTimingDerivedSource(ex.source)).length} extract(s)`}
          >
            <Text size="xs" c="dimmed" mb="xs" lh={1.45}>
              Pull values from packet bytes (palette colors, bit fields). Timing→param bindings
              live under the Timing section above.
            </Text>
            <Stack gap="xs">
              {(rule.extract || [])
                .map((ex, i) => ({ ex, i }))
                .filter(({ ex }) => !isTimingDerivedSource(ex.source))
                .map(({ ex, i }) => (
                  <ExtractRowEditor
                    key={i}
                    extract={ex}
                    segmentOpts={segmentOpts}
                    onChange={(next) => {
                      const extract = [...(rule.extract || [])];
                      extract[i] = next;
                      onChange({ ...rule, extract });
                    }}
                    onDelete={() => onChange({ ...rule, extract: (rule.extract || []).filter((_, j) => j !== i) })}
                  />
                ))}
            </Stack>
            <AppButton
              size="compact-sm"
              variant="default"
              mt="xs"
              onClick={() => onChange({
                ...rule,
                extract: [...(rule.extract || []), createEmptyExtract(`field${(rule.extract || []).length + 1}`)],
              })}
            >
              Add packet extract
            </AppButton>
          </CollapsibleBlock>
        </Stack>
      )}
    </AppCard>
  );
}

function LivePreview({ rules, colors, selectedRuleId, segmentMaps, timingModels }) {
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState('');
  const [packets, setPackets] = useState([]);
  const [matchMode, setMatchMode] = useState('first'); // first | all | selected

  const selectedRule = useMemo(
    () => (rules || []).find((r) => r.id === selectedRuleId) || null,
    [rules, selectedRuleId],
  );

  const modelFor = (rule) => {
    const id = rule?.timing?.timingModelId;
    if (!id) return null;
    return (timingModels || []).find((m) => m.id === id) || null;
  };

  const runPreview = () => {
    const hexes = hexPacketsFromPaste(paste);
    if (!hexes.length) {
      setStatus('Paste hex or capture rows first');
      setPackets([]);
      return;
    }
    const results = hexes.map((hex) => {
      const bytes = disneyPayload(hexToBytes(hex));
      const mapFor = (rule) => (rule?.segmentMapId
        ? (segmentMaps || []).find((m) => m.id === rule.segmentMapId) || null
        : null);

      if (matchMode === 'selected' && selectedRule) {
        const matched = selectedRule.enabled !== false
          && selectedRule.match
          && previewPacketAgainstRules(bytes, [selectedRule]).matched;
        const extracts = matched
          ? previewExtracts(bytes, selectedRule.extract || [], colors, mapFor(selectedRule), {
            rule: selectedRule,
            timingModels,
          })
          : [];
        let timing = null;
        if (matched && selectedRule.timing?.enabled && bytes.length > Number(selectedRule.timing.offset ?? 0)) {
          timing = computeTimingLifecycle(
            bytes[Number(selectedRule.timing.offset ?? 0)],
            selectedRule.timing.cooldownSec ?? 2,
            modelFor(selectedRule),
          );
        }
        return {
          hex: bytesToHex(bytes),
          matched,
          ruleName: matched ? selectedRule.name : null,
          extracts,
          timing,
        };
      }
      if (matchMode === 'all') {
        const prev = previewPacketAgainstRules(bytes, rules, {
          matchAllRules: true,
          colors,
          extractFromRule: selectedRule,
          segmentMaps,
          timingModels,
        });
        return {
          hex: prev.hex,
          matched: prev.matchingRules.length > 0,
          ruleNames: prev.matchingRules.map((m) => m.rule.name),
          extracts: selectedRule
            ? previewExtracts(bytes, selectedRule.extract || [], colors, mapFor(selectedRule), {
              rule: selectedRule,
              timingModels,
            })
            : prev.extracts,
          timing: prev.timing,
        };
      }
      const first = findMatchingRule(bytes, rules);
      const extracts = first
        ? previewExtracts(bytes, first.extract || [], colors, mapFor(first), {
          rule: first,
          timingModels,
        })
        : [];
      let timing = null;
      if (first?.timing?.enabled && bytes.length > Number(first.timing.offset ?? 0)) {
        timing = computeTimingLifecycle(
          bytes[Number(first.timing.offset ?? 0)],
          first.timing.cooldownSec ?? 2,
          modelFor(first),
        );
      }
      return {
        hex: bytesToHex(bytes),
        matched: !!first,
        ruleName: first?.name || null,
        extracts,
        timing,
      };
    });
    setPackets(results);
    const hits = results.filter((r) => r.matched).length;
    setStatus(`${results.length} packet${results.length === 1 ? '' : 's'} — ${hits} matched`);
  };

  return (
    <AppCard>
      <SectionHead>Live preview</SectionHead>
      <Text size="xs" c="dimmed" mb="xs" lh={1.45}>
        Paste capture rows or raw hex (8301 stripped automatically). Shows which rules match, extract→targets resolution, and timing lifecycle when enabled.
      </Text>
      <Textarea
        minRows={4}
        value={paste}
        onChange={(e) => setPaste(e.target.value)}
        placeholder="Paste hex or Illuma capture export…"
        styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        mb="xs"
      />
      <Group gap="xs" mb="xs" wrap="wrap">
        <AppButton size="compact-sm" variant="primary" onClick={runPreview}>Preview</AppButton>
        <SearchableSelect
          value={matchMode}
          onChange={setMatchMode}
          allowEmpty={false}
          options={[
            { value: 'first', label: 'First match (priority)' },
            { value: 'all', label: 'All matching rules' },
            { value: 'selected', label: 'Selected rule only' },
          ]}
        />
      </Group>
      {status && <Text size="xs" c="dimmed" mb="xs">{status}</Text>}
      <Stack gap="xs">
        {packets.map((p, i) => (
          <Paper key={i} p="xs" withBorder bg="var(--surface2)">
            <Group gap="xs" mb={4} wrap="wrap">
              <Badge size="xs" color={p.matched ? 'green' : 'gray'}>
                {p.matched ? 'match' : 'no match'}
              </Badge>
              {p.ruleName && <Text size="xs" fw={600}>{p.ruleName}</Text>}
              {p.ruleNames?.length > 0 && (
                <Text size="xs" fw={600}>{p.ruleNames.join(', ')}</Text>
              )}
            </Group>
            <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>{p.hex}</Text>
            {p.timing && (
              <Text size="xs" c="dimmed" mt={4}>
                timing 0x{p.timing.raw.toString(16).padStart(2, '0')}
                {' '}→ on {p.timing.onSec.toFixed(1)}s
                {' · '}stretch {p.timing.stretchSec.toFixed(1)}s
                {' · '}black hold {p.timing.cooldownSec}s
                {p.timing.extended ? ' · extended' : ''}
                {p.timing.scaler ? ' · scaler' : ''}
                {p.timing.fadeCurve === 'decelerating' ? ' · stretch≈non-linear dim' : ''}
                {p.timing.strobe
                  ? ` · strobe ${p.timing.strobe.flashRateHz.toFixed(2)} Hz → fx=${p.timing.strobe.fx} sx=${p.timing.strobe.sx}`
                  : ''}
                {p.timing.speedBucket
                  ? ` · speedBuckets ${p.timing.speedBucket.field}=${p.timing.speedBucket.value} (key=${p.timing.speedBucket.key})`
                  : ''}
              </Text>
            )}
            {(p.extracts || []).length > 0 && (
              <Stack gap={2} mt={6}>
                {p.extracts.map((ex, j) => (
                  <Stack key={j} gap={2}>
                    <Group gap="xs" wrap="wrap">
                      <Text size="xs" fw={600}>{ex.name || `ex${j}`}:</Text>
                      <Text size="xs" ff="monospace">
                        {ex.derivedValue != null
                          ? `${ex.source || 'timing'}: ${Number(ex.derivedValue).toFixed(2)} → ${typeof ex.mapped === 'number' ? ex.mapped.toFixed?.(2) ?? ex.mapped : ex.mapped}`
                          : `raw=${ex.raw}${ex.paletteIndex != null ? ` → pal ${ex.paletteIndex}` : ` → ${typeof ex.mapped === 'number' ? ex.mapped.toFixed?.(2) ?? ex.mapped : ex.mapped}`}`}
                      </Text>
                      {ex.rgb && (
                        <Paper
                          w={14}
                          h={14}
                          radius={2}
                          style={{ background: `rgb(${ex.rgb.join(',')})`, border: '1px solid var(--border)' }}
                        />
                      )}
                    </Group>
                    {(ex.targetLabels || []).map((label, k) => (
                      <Text key={k} size="xs" c="dimmed" pl="sm">→ {label}</Text>
                    ))}
                  </Stack>
                ))}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>
    </AppCard>
  );
}

export function RuleEditor({
  mb, presets = [], effectOptions = [], paletteOptions = [], onChange, onEditMaps, onEditTimingModels,
}) {
  const mapping = normalizeMbMapping(mb);
  const rules = mapping.rules || [];
  const segmentMaps = mapping.segmentMaps || [];
  const timingModels = mapping.timingModels || [];
  const [expandedId, setExpandedId] = useState(rules[0]?.id || null);

  const setRules = (nextRules, { reindex = false } = {}) => {
    const out = reindex ? reindexRulePriorities(nextRules) : nextRules;
    onChange({ ...mapping, rules: out });
  };

  const updateRule = (id, next) => {
    setRules(rules.map((r) => (r.id === id ? next : r)));
  };

  const moveRule = (index, delta) => {
    const j = index + delta;
    if (j < 0 || j >= rules.length) return;
    const copy = [...rules];
    const [item] = copy.splice(index, 1);
    copy.splice(j, 0, item);
    setRules(copy, { reindex: true });
    setExpandedId(item.id);
  };

  const duplicateRule = (rule, index) => {
    let copy;
    try {
      copy = JSON.parse(JSON.stringify(rule));
    } catch {
      copy = { ...rule };
    }
    copy.id = shortRuleId();
    copy.name = `${rule.name || `Rule ${index + 1}`} (copy)`;
    const next = [...rules];
    next.splice(index + 1, 0, copy);
    setRules(next, { reindex: true });
    setExpandedId(copy.id);
  };

  const addRule = () => {
    const rule = createEmptyRule({
      name: `Rule ${rules.length + 1}`,
      priority: rules.length * 10,
      match: {
        mode: 'all',
        children: [
          {
            mode: 'some',
            children: [
              createEmptyCondition('hexPrefix'),
            ],
          },
        ],
      },
    });
    rule.match.children[0].children[0].value = 'E100E90C';
    setRules([...rules, rule]);
    setExpandedId(rule.id);
  };

  return (
    <Stack gap="md">
      <Text size="xs" c="dimmed" lh={1.5}>
        Ordered rules evaluated on the board (lower priority first). Push with <strong>📡 Board</strong> (<code style={{ fontFamily: 'monospace' }}>set_mb_rules</code>).
      </Text>

      <Group gap="xs">
        <AppButton size="compact-sm" variant="primary" onClick={addRule}>Add rule</AppButton>
        <Text size="xs" c="dimmed">{rules.length} rule{rules.length === 1 ? '' : 's'}</Text>
      </Group>

      {rules.length === 0 && (
        <Paper p="sm" withBorder>
          <Text size="sm" c="dimmed">No rules yet. Add one, or unmatched packets use the default preset.</Text>
        </Paper>
      )}

      {rules.map((rule, index) => (
        <RuleCard
          key={rule.id}
          rule={rule}
          index={index}
          total={rules.length}
          expanded={expandedId === rule.id}
          onToggle={() => setExpandedId(expandedId === rule.id ? null : rule.id)}
          onChange={(next) => updateRule(rule.id, next)}
          onDelete={() => {
            setRules(rules.filter((r) => r.id !== rule.id), { reindex: true });
            if (expandedId === rule.id) setExpandedId(null);
          }}
          onDuplicate={() => duplicateRule(rule, index)}
          onMove={(delta) => moveRule(index, delta)}
          presets={presets}
          segmentMaps={segmentMaps}
          timingModels={timingModels}
          effectOptions={effectOptions}
          paletteOptions={paletteOptions}
          onEditMaps={onEditMaps}
          onEditTimingModels={onEditTimingModels}
        />
      ))}

      <LivePreview
        rules={rules}
        colors={mapping.colors}
        selectedRuleId={expandedId}
        segmentMaps={segmentMaps}
        timingModels={timingModels}
      />
    </Stack>
  );
}
