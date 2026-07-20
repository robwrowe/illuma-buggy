import { useMemo, useState } from 'react';
import {
  Badge,
  Checkbox,
  Group,
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
  createEmptyCondition,
  createEmptyExtract,
  createEmptyExtractTarget,
  createEmptyMatchGroup,
  createEmptyRule,
  createEmptyRuleEffect,
  createEmptyRuleTiming,
  createEmptyStartTransition,
  normalizeMbMapping,
  reindexRulePriorities,
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
            <NumberInput value={node.value ?? 0} onChange={(v) => set({ value: parseInt(v, 10) || 0 })} min={0} max={255} />
          </Field>
          {node.op === 'maskEq' && (
            <Field label="Mask">
              <NumberInput value={node.mask ?? 255} onChange={(v) => set({ mask: (parseInt(v, 10) || 0) & 0xff })} min={0} max={255} />
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

  return (
    <Paper
      p="sm"
      withBorder
      style={{
        marginLeft: depth ? 8 : 0,
        borderColor: node.mode === 'some' ? 'var(--mantine-color-orange-5)' : 'var(--border)',
      }}
    >
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Group gap="xs">
          <Badge size="sm" variant="light" color={node.mode === 'some' ? 'orange' : 'violet'}>
            {node.mode === 'some' ? 'OR (some)' : 'AND (all)'}
          </Badge>
          <AppButton
            size="compact-xs"
            variant="default"
            onClick={() => onChange({ ...node, mode: node.mode === 'some' ? 'all' : 'some' })}
          >
            Toggle AND/OR
          </AppButton>
        </Group>
        {onDelete && (
          <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Delete group</AppButton>
        )}
      </Group>
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
    </Paper>
  );
}

function TargetRowEditor({ target, segmentOpts, onChange, onDelete }) {
  const setKind = (kind) => onChange(createEmptyExtractTarget(kind));
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
            <Field label="Segment">
              <SearchableSelect
                value={target.segmentId || ''}
                onChange={(segmentId) => onChange({ ...target, kind: 'segmentColor', segmentId })}
                options={segmentOpts}
                placeholder="(pick segment)"
                allowEmpty
              />
            </Field>
            <Field label="Color slot">
              <SearchableSelect
                value={String(target.colorSlot ?? 0)}
                onChange={(v) => onChange({ ...target, kind: 'segmentColor', colorSlot: parseInt(v, 10) || 0 })}
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
            <Field label="Field">
              <TextInput
                value={target.field || ''}
                onChange={(e) => onChange({ ...target, kind: 'segmentField', field: e.target.value })}
                placeholder="sx"
                styles={{ input: { fontFamily: 'monospace' } }}
              />
            </Field>
          </>
        )}
      </SimpleGrid>
    </Paper>
  );
}

function ExtractRowEditor({ extract, segmentOpts, onChange, onDelete }) {
  const set = (patch) => onChange({ ...extract, ...patch });
  const targets = Array.isArray(extract.targets) ? extract.targets : [];
  const curve = extract.curve || { type: 'linear', inMin: 0, inMax: 15, outMin: 0, outMax: 255, exponent: 2 };

  return (
    <Paper p="xs" withBorder bg="var(--surface2)">
      <Group justify="space-between" mb="xs">
        <Text size="xs" fw={600}>Extract</Text>
        <AppButton variant="danger" size="compact-xs" onClick={onDelete}>Delete</AppButton>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
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
      <Checkbox
        mt="xs"
        label="Palette map (low 5 bits → MB color)"
        checked={!!extract.paletteMap}
        onChange={(e) => {
          const paletteMap = e.target.checked;
          if (paletteMap) {
            const rest = { ...extract };
            delete rest.curve;
            onChange({ ...rest, paletteMap: true });
          } else {
            set({ paletteMap: false, curve });
          }
        }}
      />
      {!extract.paletteMap && (
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" mt="xs">
          <Field label="Curve">
            <SearchableSelect
              value={curve.type || 'linear'}
              onChange={(type) => set({ curve: { ...curve, type } })}
              options={[
                { value: 'linear', label: 'linear' },
                { value: 'exponential', label: 'exponential' },
              ]}
              allowEmpty={false}
            />
          </Field>
          <Field label="inMin">
            <NumberInput value={curve.inMin ?? 0} onChange={(v) => set({ curve: { ...curve, inMin: parseInt(v, 10) || 0 } })} />
          </Field>
          <Field label="inMax">
            <NumberInput value={curve.inMax ?? 15} onChange={(v) => set({ curve: { ...curve, inMax: parseInt(v, 10) || 0 } })} />
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
        </SimpleGrid>
      )}

      <Text size="xs" fw={600} mt="sm" mb={4}>Targets</Text>
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
    </Paper>
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
                Geometry and map defaults live in Segment Maps. Per-rule sources are below.
              </Text>
            </Stack>
          )}
          {selectedMap && (
            <SegmentOverrideTable
              segments={selectedMap.segments || []}
              segmentOverrides={rule.segmentOverrides || {}}
              extracts={rule.extract || []}
              effectOptions={effectOptions}
              paletteOptions={paletteOptions}
              onChange={(segmentOverrides) => onChange({ ...rule, segmentOverrides })}
            />
          )}

          <Paper p="sm" withBorder bg="var(--surface2)">
            <Text size="sm" fw={700} mb="xs">Timing</Text>
            <Text size="xs" c="dimmed" mb="xs">
              On-time and fade-out come from the packet timing byte. Cooldown is how long
              lights stay black after fade-out, before restoring the previous look.
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
                  value={timing.cooldownSec ?? 10}
                  onChange={(v) => onChange({
                    ...rule,
                    timing: { ...timing, cooldownSec: Math.max(0, parseInt(v, 10) || 0) },
                  })}
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
                  timing: { ...timing, timingModelId },
                })}
                placeholder="(firmware default — E9 05/09)"
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
          </Paper>

          <Paper p="sm" withBorder bg="var(--surface2)">
            <Text size="sm" fw={700} mb="xs">Start transition</Text>
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
          </Paper>

          <SectionHead>Match conditions</SectionHead>
          <ConditionGroupEditor
            node={rule.match || createEmptyMatchGroup('all')}
            onChange={(match) => onChange({ ...rule, match })}
          />

          <SectionHead>Extracts</SectionHead>
          <Stack gap="xs">
            {(rule.extract || []).map((ex, i) => (
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
            onClick={() => onChange({
              ...rule,
              extract: [...(rule.extract || []), createEmptyExtract(`field${(rule.extract || []).length + 1}`)],
            })}
          >
            Add extract
          </AppButton>
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
          ? previewExtracts(bytes, selectedRule.extract || [], colors, mapFor(selectedRule))
          : [];
        let timing = null;
        if (matched && selectedRule.timing?.enabled && bytes.length > Number(selectedRule.timing.offset ?? 0)) {
          timing = computeTimingLifecycle(
            bytes[Number(selectedRule.timing.offset ?? 0)],
            selectedRule.timing.cooldownSec ?? 10,
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
            ? previewExtracts(bytes, selectedRule.extract || [], colors, mapFor(selectedRule))
            : prev.extracts,
          timing: prev.timing,
        };
      }
      const first = findMatchingRule(bytes, rules);
      const extracts = first
        ? previewExtracts(bytes, first.extract || [], colors, mapFor(first))
        : [];
      let timing = null;
      if (first?.timing?.enabled && bytes.length > Number(first.timing.offset ?? 0)) {
        timing = computeTimingLifecycle(
          bytes[Number(first.timing.offset ?? 0)],
          first.timing.cooldownSec ?? 10,
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
                {' · '}fade {p.timing.fadeSec.toFixed(1)}s
                {' · '}black hold {p.timing.cooldownSec}s
                {p.timing.extended ? ' · extended' : ''}
                {p.timing.scaler ? ' · scaler' : ''}
                {p.timing.fadeCurve === 'decelerating' ? ' · fade≈non-linear' : ''}
                {p.timing.strobe
                  ? ` · strobe ${p.timing.strobe.flashRateHz.toFixed(2)} Hz → fx=${p.timing.strobe.fx} sx=${p.timing.strobe.sx}`
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
                        raw={ex.raw}
                        {ex.paletteIndex != null ? ` → pal ${ex.paletteIndex}` : ` → ${typeof ex.mapped === 'number' ? ex.mapped.toFixed?.(2) ?? ex.mapped : ex.mapped}`}
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
