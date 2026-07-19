import { useMemo, useState } from 'react';
import {
  Badge,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import { MB_SEGMENT_META } from '../../lib/ble/mbConstants';
import {
  createEmptyCondition,
  createEmptyExtract,
  createEmptyMatchGroup,
  createEmptyRule,
  normalizeMbMapping,
  reindexRulePriorities,
} from '../../lib/ble/mbMapping';
import {
  bytesToHex,
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

function ExtractRowEditor({ extract, onChange, onDelete }) {
  const set = (patch) => onChange({ ...extract, ...patch });
  const target = extract.target || { kind: 'color', segment: 'all' };
  const setTarget = (patch) => set({ target: { ...target, ...patch } });
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
            const { curve: _c, ...rest } = extract;
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
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mt="xs">
        <Field label="Target kind">
          <SearchableSelect
            value={target.kind || 'color'}
            onChange={(kind) => {
              if (kind === 'wledField') setTarget({ kind: 'wledField', field: target.field || 'sx' });
              else setTarget({ kind: 'color', segment: target.segment || 'all' });
            }}
            options={[
              { value: 'color', label: 'color (segment)' },
              { value: 'wledField', label: 'wledField' },
            ]}
            allowEmpty={false}
          />
        </Field>
        {target.kind === 'wledField' ? (
          <Field label="WLED field">
            <TextInput
              value={target.field || ''}
              onChange={(e) => setTarget({ field: e.target.value })}
              placeholder="sx"
              styles={{ input: { fontFamily: 'monospace' } }}
            />
          </Field>
        ) : (
          <Field label="Segment">
            <SearchableSelect
              value={target.segment || 'all'}
              onChange={(segment) => setTarget({ kind: 'color', segment })}
              options={MB_SEGMENT_META.map((s) => ({ value: s.id, label: s.label, searchText: `${s.id} ${s.label}` }))}
              allowEmpty={false}
            />
          </Field>
        )}
      </SimpleGrid>
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
  layouts,
}) {
  const presetOpts = presets.map((p) => ({ value: p.id, label: p.name, searchText: p.name }));
  const layoutOpts = (layouts || []).map((l) => ({ value: l.id, label: l.name, searchText: l.name }));

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
          <Field label="Segment layout (optional)">
            <SearchableSelect
              value={rule.segmentLayoutId || ''}
              onChange={(segmentLayoutId) => onChange({ ...rule, segmentLayoutId })}
              placeholder="Active layout"
              options={layoutOpts}
              allowEmpty
            />
          </Field>

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

function LivePreview({ rules, colors, selectedRuleId }) {
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState('');
  const [packets, setPackets] = useState([]);
  const [matchMode, setMatchMode] = useState('first'); // first | all | selected

  const selectedRule = useMemo(
    () => (rules || []).find((r) => r.id === selectedRuleId) || null,
    [rules, selectedRuleId],
  );

  const runPreview = () => {
    const hexes = hexPacketsFromPaste(paste);
    if (!hexes.length) {
      setStatus('Paste hex or capture rows first');
      setPackets([]);
      return;
    }
    const results = hexes.map((hex) => {
      const bytes = disneyPayload(hexToBytes(hex));
      if (matchMode === 'selected' && selectedRule) {
        const matched = selectedRule.enabled !== false
          && selectedRule.match
          && previewPacketAgainstRules(bytes, [selectedRule]).matched;
        const extracts = matched
          ? previewExtracts(bytes, selectedRule.extract || [], colors)
          : [];
        return {
          hex: bytesToHex(bytes),
          matched,
          ruleName: matched ? selectedRule.name : null,
          extracts,
        };
      }
      if (matchMode === 'all') {
        const prev = previewPacketAgainstRules(bytes, rules, { matchAllRules: true, colors, extractFromRule: selectedRule });
        return {
          hex: prev.hex,
          matched: prev.matchingRules.length > 0,
          ruleNames: prev.matchingRules.map((m) => m.rule.name),
          extracts: selectedRule
            ? previewExtracts(bytes, selectedRule.extract || [], colors)
            : prev.extracts,
        };
      }
      const first = findMatchingRule(bytes, rules);
      const extracts = first ? previewExtracts(bytes, first.extract || [], colors) : [];
      return {
        hex: bytesToHex(bytes),
        matched: !!first,
        ruleName: first?.name || null,
        extracts,
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
        Paste capture rows or raw hex (8301 stripped automatically). Shows which rules match and extract raw→mapped values.
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
            {(p.extracts || []).length > 0 && (
              <Stack gap={2} mt={6}>
                {p.extracts.map((ex, j) => (
                  <Group key={j} gap="xs" wrap="wrap">
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
                    {ex.target?.kind === 'color' && (
                      <Text size="xs" c="dimmed">→ {ex.target.segment}</Text>
                    )}
                    {ex.target?.kind === 'wledField' && (
                      <Text size="xs" c="dimmed">→ {ex.target.field}</Text>
                    )}
                  </Group>
                ))}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>
    </AppCard>
  );
}

export function RuleEditor({ mb, presets = [], layouts = [], onChange }) {
  const mapping = normalizeMbMapping(mb);
  const rules = mapping.rules || [];
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
    // seed a useful hex prefix placeholder
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
          layouts={layouts}
        />
      ))}

      <LivePreview
        rules={rules}
        colors={mapping.colors}
        selectedRuleId={expandedId}
      />
    </Stack>
  );
}
