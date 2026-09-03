import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Checkbox,
  ColorInput,
  Divider,
  Flex,
  Group,
  Input,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import { SegmentOverrideTable } from './SegmentOverrideTable';
import { CopyPasteButtons, RULE_CLIP, RuleClipProvider, useRuleClip } from './ruleClipboard';
import { MB_SEGMENT_META } from '../../lib/ble/mbConstants';
import {
  createEmptyColorBlend,
  createEmptyColorBlendSource,
  createEmptyColorSource,
  createEmptyColorSourceBlendEntry,
  createEmptyColorSourceBlendExtract,
  createEmptyColorSourceFixed,
  createEmptyColorSourceRgb,
  createEmptyCondition,
  createEmptyExtract,
  createEmptyExtractTarget,
  createEmptyFixedColorExtract,
  createEmptyMatchGroup,
  createEmptyFallbackDuration,
  createEmptyRule,
  createEmptyRuleEffect,
  createEmptyRuleTiming,
  createEmptyStartTransition,
  createEmptyStopTransition,
  createEmptyTimingParamBinding,
  colorSourceBlendWeightSum,
  findDuplicateColorSourceNames,
  isColorSourceBlendSource,
  isFixedColorSource,
  isTimingDerivedSource,
  normalizeAnchor,
  normalizeCustomHex,
  isFallbackColor,
  normalizeColorSource,
  normalizeColorSources,
  normalizeConditionNode,
  normalizeExtract,
  normalizeFallbackDuration,
  normalizeMbMapping,
  normalizeRuleTiming,
  normalizeSegmentOverrides,
  normalizeSegmentSourceMode,
  normalizeStartTransition,
  normalizeStopTransition,
  reindexRulePriorities,
  SEGMENT_FIELD_PRESETS,
  segmentLabel,
  shortRuleId,
  TIMING_DERIVED_SOURCES,
  WLED_START_TRANSITIONS,
} from '../../lib/ble/mbMapping';
import {
  bytesToHex,
  computeTimingLifecycle,
  disneyPayload,
  findMatchingRule,
  formatOffsetOrAnchorLabel,
  hexToBytes,
  explainRulesAgainstPacket,
  previewColorSourcesList,
  previewExtracts,
  previewPacketAgainstRules,
  resolveOffsetOrAnchor,
} from '../../lib/ble/e9Decode';
import { parseCapturePaste } from '../../lib/ble/captureImport';
import { sendHex, stripCompanyId } from '../../lib/ble/wandSimClient';
import { rgbToHex } from '../../lib/utils';
import { useNavigate } from 'react-router-dom';
import { ColorSwatch } from '../shared/ColorSwatch';
import { RulePriorityDrawer } from './RulePriorityDrawer';

const CMP_OP_OPTS = [
  { value: 'eq', label: 'eq' },
  { value: 'neq', label: 'neq' },
  { value: 'gt', label: 'gt' },
  { value: 'gte', label: 'gte' },
  { value: 'lt', label: 'lt' },
  { value: 'lte', label: 'lte' },
];

const BYTE_OP_OPTS = [...CMP_OP_OPTS, { value: 'maskEq', label: 'maskEq' }];
const BYTES_AT_OFFSET_OP_OPTS = [
  { value: 'eq', label: 'eq' },
  { value: 'neq', label: 'neq' },
];

const LEAF_TYPE_OPTS = [
  { value: 'hexPrefix', label: 'hexPrefix' },
  { value: 'length', label: 'byte length' },
  { value: 'byte', label: 'byte' },
  { value: 'bits', label: 'bits' },
  { value: 'byteCompare', label: 'byteCompare' },
  { value: 'bytesAtOffset', label: 'bytesAtOffset' },
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
    return parsed.rows.map((r) => stripCompanyId(r.hex)).filter((h) => h.length >= 4);
  }
  // Multi-line plain hex list — never collapse to the first line only.
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (lines.length > 1) {
    const hexes = lines
      .map((l) => stripCompanyId(String(l).replace(/[^0-9a-fA-F]/g, '')))
      .filter((h) => h.length >= 4);
    if (hexes.length > 1) return hexes;
  }
  const hex = stripCompanyId(parsed.hex || '');
  return hex.length >= 4 ? [hex] : [];
}

/** Collapsed-by-default section used across the rule editor. */
function CollapsibleBlock({
  title,
  summary,
  defaultOpen = false,
  headerRight = undefined,
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
          <Text
            size={titleSize}
            fw={titleFw}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
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

function HexByteInput({ value, onChange, placeholder = '0x00', ...rest }) {
  const [text, setText] = useState(() => formatHexByte(value ?? 0));

  useEffect(() => {
    setText(formatHexByte(value ?? 0));
  }, [value]);

  const commit = (raw) => {
    const cleaned = String(raw ?? '')
      .trim()
      .replace(/^0x/i, '');
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
      {...rest}
    />
  );
}

/**
 * Drop-in replacement for a bare "Offset" NumberInput field. Toggles between
 * absolute offset and marker-anchor mode. `node` must have `.offset` and optionally `.anchor`.
 * `onPatch(partialNode)` merges into the parent node (same convention as `set()` callers).
 * When `showAnchorExtras` is true (default), anchor mode also exposes fallbackValue + requireAnchor.
 * `allowColorFallback` lets fallbackValue be either 0–255 or a #rrggbb color.
 */
function OffsetOrAnchorField({
  node,
  onPatch,
  label = 'Offset',
  disabled = false,
  showAnchorExtras = true,
  allowColorFallback = true,
}) {
  const mode = node?.anchor ? 'anchor' : 'offset';
  const anchor = node?.anchor || {
    byte: '0F',
    occurrence: 1,
    searchFrom: 0,
    searchLen: 0,
    deltaBytes: 0,
  };
  const fallbackIsColor = allowColorFallback && isFallbackColor(node?.fallbackValue);
  const fallbackMode = fallbackIsColor ? 'color' : 'number';

  const setMode = (next) => {
    if (next === 'offset') {
      onPatch({ anchor: null, fallbackValue: 0, requireAnchor: false });
    } else {
      onPatch({
        anchor: normalizeAnchor(anchor) || anchor,
        fallbackValue: fallbackIsColor
          ? normalizeCustomHex(node?.fallbackValue) || '#000000'
          : Number.isFinite(Number(node?.fallbackValue))
            ? Number(node.fallbackValue)
            : 0,
        requireAnchor: !!node?.requireAnchor,
      });
    }
  };
  const patchAnchor = (partial) => onPatch({ anchor: normalizeAnchor({ ...anchor, ...partial }) });

  const setFallbackMode = (next) => {
    if (next === 'color') {
      onPatch({ fallbackValue: normalizeCustomHex(node?.fallbackValue) || '#000000' });
    } else {
      onPatch({ fallbackValue: 0 });
    }
  };

  return (
    <>
      <Group align="flex-end" justify="space-between" gap="xs">
        <Stack gap={0} justify="flex-start" align="flex-start">
          <Input.Label size="xs">{label}</Input.Label>
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={setMode}
            disabled={disabled}
            data={[
              { value: 'offset', label: 'Fixed' },
              { value: 'anchor', label: 'Anchor' },
            ]}
          />
        </Stack>
        {mode === 'offset' && (
          <NumberInput
            label="Index"
            size="xs"
            value={node?.offset ?? 0}
            onChange={(v) => onPatch({ offset: Math.max(0, parseInt(String(v), 10) || 0) })}
            min={0}
            disabled={disabled}
            flex={1}
          />
        )}
        {mode !== 'offset' && (
          <>
            <HexByteInput
              label="Marker Byte"
              size="xs"
              value={parseInt(anchor.byte || '0F', 16)}
              onChange={(v) => patchAnchor({ byte: v.toString(16).padStart(2, '0') })}
              placeholder="0x0F"
              flex={1}
            />

            <NumberInput
              label={anchor.fromEnd ? 'Occurrence (from end)' : 'Occurrence'}
              size="xs"
              min={1}
              value={anchor.occurrence ?? 1}
              onChange={(v) =>
                patchAnchor({ occurrence: Math.max(1, parseInt(String(v), 10) || 1) })
              }
              disabled={disabled}
              flex={1}
            />

            <Stack gap={0} justify="flex-start" align="flex-start">
              <Input.Label size="xs">Search</Input.Label>
              <SegmentedControl
                size="xs"
                value={anchor.fromEnd ? 'rev' : 'fwd'}
                onChange={(v) => patchAnchor({ fromEnd: v === 'rev' })}
                disabled={disabled}
                data={[
                  { value: 'fwd', label: 'Start → end' },
                  { value: 'rev', label: 'End → start' },
                ]}
              />
            </Stack>

            <NumberInput
              label="Search from"
              size="xs"
              min={0}
              value={anchor.searchFrom ?? 0}
              onChange={(v) =>
                patchAnchor({ searchFrom: Math.max(0, parseInt(String(v), 10) || 0) })
              }
              disabled={disabled}
              flex={1}
            />

            <NumberInput
              label="Search length (0 = all)"
              size="xs"
              min={0}
              value={anchor.searchLen ?? 0}
              onChange={(v) =>
                patchAnchor({ searchLen: Math.max(0, parseInt(String(v), 10) || 0) })
              }
              disabled={disabled}
              flex={1}
            />

            <NumberInput
              label="Δ bytes after match"
              size="xs"
              value={anchor.deltaBytes ?? 0}
              onChange={(v) => patchAnchor({ deltaBytes: parseInt(String(v), 10) || 0 })}
              disabled={disabled}
              flex={1}
            />
          </>
        )}
      </Group>

      {mode !== 'offset' && showAnchorExtras && (
        <Group justify="flex-start">
          <Stack gap={0} justify="flex-start" align="flex-start">
            <Input.Label size="xs">Fallback</Input.Label>
            <Input.Description size="xs">If marker is missing</Input.Description>
          </Stack>

          <Switch
            size="xs"
            label="Fail rule match if marker not found"
            checked={!!node?.requireAnchor}
            onChange={(e) => onPatch({ requireAnchor: e.currentTarget.checked })}
            disabled={disabled}
          />

          {allowColorFallback && (
            <SegmentedControl
              size="xs"
              value={fallbackMode}
              onChange={setFallbackMode}
              disabled={disabled}
              data={[
                { value: 'number', label: 'Number' },
                { value: 'color', label: 'Color' },
              ]}
            />
          )}

          {fallbackMode === 'color' ? (
            <ColorInput
              size="xs"
              format="hex"
              value={normalizeCustomHex(node?.fallbackValue) || '#000000'}
              onChange={(v) => onPatch({ fallbackValue: normalizeCustomHex(v) || '#000000' })}
              disabled={disabled}
              swatches={['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff']}
            />
          ) : (
            <NumberInput
              size="xs"
              min={0}
              max={255}
              value={Number.isFinite(Number(node?.fallbackValue)) ? Number(node.fallbackValue) : 0}
              onChange={(v) =>
                onPatch({
                  fallbackValue: Math.max(0, Math.min(255, parseInt(String(v), 10) || 0)),
                })
              }
              disabled={disabled}
            />
          )}
        </Group>
      )}
    </>
  );
}

function ConditionEnabledToggle({ node, onChange }) {
  return (
    <Checkbox
      size="xs"
      label="Enabled"
      checked={node.enabled !== false}
      onChange={(e) => {
        if (e.currentTarget.checked) {
          const { enabled: _drop, ...rest } = node;
          onChange(rest);
        } else {
          onChange({ ...node, enabled: false });
        }
      }}
    />
  );
}

function preserveConditionMeta(next, prev) {
  const name = typeof prev?.name === 'string' ? prev.name.trim() : '';
  let out = next;
  if (name) out = { ...out, name };
  if (prev?.enabled === false) out = { ...out, enabled: false };
  return out;
}

/** Local typing; writes through on blur/Enter so each keystroke doesn't normalize+persist the mapping. */
function DeferredTextInput({ value, onCommit, ...rest }) {
  const committed = value ?? '';
  const [text, setText] = useState(committed);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setText(committed);
  }, [committed]);

  const commit = (raw) => {
    const next = String(raw ?? '');
    setText(next);
    if (next === committed) return;
    onCommit(next);
  };

  return (
    <TextInput
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={(e) => {
        focusedRef.current = false;
        commit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      {...rest}
    />
  );
}

function ConditionNameField({ node, onChange, ...rest }) {
  const nodeRef = useRef(node);
  nodeRef.current = node;
  return (
    <DeferredTextInput
      flex={1}
      value={node.name || ''}
      label="Name (optional)"
      placeholder="e.g. TL/BL same color"
      size="xs"
      onCommit={(next) => {
        const current = nodeRef.current;
        if (next.trim()) onChange({ ...current, name: next });
        else {
          const { name: _drop, ...restNode } = current;
          onChange(restNode);
        }
      }}
      {...rest}
    />
  );
}

function ByteCompareOperandField({ label, operand, onPatch }) {
  return (
    <>
      <Divider label={label} />
      <OffsetOrAnchorField node={operand} onPatch={onPatch} showAnchorExtras={false} />
      <Group gap="xs" grow align="flex-end">
        <NumberInput
          label="Bit Start"
          size="xs"
          flex={1}
          value={operand?.bitStart ?? 0}
          onChange={(v) =>
            onPatch({
              bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)),
            })
          }
          min={0}
          max={7}
        />

        <NumberInput
          label="Bit Count"
          size="xs"
          flex={1}
          value={operand?.bitCount ?? 8}
          onChange={(v) =>
            onPatch({
              bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 8)),
            })
          }
          min={1}
          max={32}
        />
      </Group>
    </>
  );
}

function ConditionLeafEditor({ node, onChange, onDelete, onDuplicate, onPasteAfter }) {
  const { copyKind, hasKind, takeKind } = useRuleClip();
  const [clipMsg, setClipMsg] = useState('');
  const flash = (msg) => {
    setClipMsg(msg);
    window.setTimeout(() => setClipMsg(''), 2000);
  };
  const set = (patch) => onChange({ ...node, ...patch });
  const canPaste = hasKind(RULE_CLIP.condition);

  const handleCopy = async () => {
    try {
      await copyKind(RULE_CLIP.condition, normalizeConditionNode(node));
      flash('Copied');
    } catch {
      flash('Copy failed');
    }
  };
  const handlePasteReplace = () => {
    const pasted = takeKind(RULE_CLIP.condition);
    if (!pasted) {
      flash('Nothing to paste');
      return;
    }
    onChange(normalizeConditionNode(pasted));
    flash('Replaced');
  };
  const handlePasteAfter = () => {
    if (!onPasteAfter) return;
    const pasted = takeKind(RULE_CLIP.condition);
    if (!pasted) {
      flash('Nothing to paste');
      return;
    }
    onPasteAfter(normalizeConditionNode(pasted));
    flash('Pasted after');
  };

  return (
    <Paper
      p="xs"
      withBorder
      bg="var(--surface2)"
      style={{ opacity: node.enabled === false ? 0.55 : 1 }}
    >
      <Group gap="xs" align="flex-end" justify="space-between" wrap="wrap" mb="xs">
        <SearchableSelect
          label="Type"
          value={node.type}
          onChange={(type) => onChange(preserveConditionMeta(createEmptyCondition(type), node))}
          options={LEAF_TYPE_OPTS}
          allowEmpty={false}
          size="xs"
        />

        <ConditionNameField node={node} onChange={onChange} />
        <ConditionEnabledToggle node={node} onChange={onChange} />

        <AppButton size="xs" variant="default" onClick={handleCopy}>
          Copy
        </AppButton>
        <AppButton size="xs" variant="default" disabled={!canPaste} onClick={handlePasteReplace}>
          Paste
        </AppButton>
        {onPasteAfter && (
          <AppButton size="xs" variant="default" disabled={!canPaste} onClick={handlePasteAfter}>
            Paste after
          </AppButton>
        )}
        {onDuplicate && (
          <AppButton size="xs" variant="default" onClick={onDuplicate}>
            Duplicate
          </AppButton>
        )}
        {onDelete && (
          <AppButton variant="danger" size="xs" onClick={onDelete}>
            Delete
          </AppButton>
        )}
        {clipMsg ? (
          <Text size="xs" c="dimmed">
            {clipMsg}
          </Text>
        ) : null}
      </Group>
      {node.type === 'hexPrefix' && (
        <>
          <TextInput
            label="Hex Prefix"
            size="xs"
            flex={1}
            value={node.value || ''}
            onChange={(e) => set({ value: e.target.value.replace(/[^0-9a-fA-F]/g, '') })}
            placeholder="E100E90C"
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          {/^8301/i.test(node.value || '') && (
            <Text size="xs" c="orange" mt={4}>
              Payloads are already stripped of the 83 01 CID prefix before rules evaluate them —
              omit it here (e.g. use E100E905, not 8301E100E905).
            </Text>
          )}
        </>
      )}
      {node.type === 'length' && (
        <Stack gap={4}>
          <OffsetOrAnchorField node={node} onPatch={(p) => set(p)} showAnchorExtras={false} />
          <Group gap="xs" grow>
            <SearchableSelect
              label="Op"
              size="xs"
              flex={1}
              value={node.op || 'eq'}
              onChange={(op) => set({ op })}
              options={CMP_OP_OPTS}
              allowEmpty={false}
            />

            <NumberInput
              label="Byte length"
              size="xs"
              flex={1}
              value={node.value ?? 0}
              onChange={(v) => set({ value: Math.max(0, parseInt(String(v), 10) || 0) })}
              min={0}
            />
          </Group>
          <Text size="xs" c="dimmed">
            Counts remaining bytes from the offset (or resolved anchor) through the end of the
            payload after 8301 is stripped. Fixed offset 0 is the full payload. Anchor E9 with Δ 0
            is “bytes from E9 through the tail,” so prefixed and stripped captures share one length.
          </Text>
        </Stack>
      )}
      {node.type === 'byte' && (
        <Stack gap="xs">
          <OffsetOrAnchorField node={node} onPatch={(p) => set(p)} showAnchorExtras={false} />
          <Group gap="xs">
            <SearchableSelect
              label="Op"
              size="xs"
              value={node.op || 'eq'}
              onChange={(op) => set({ op })}
              options={BYTE_OP_OPTS}
              allowEmpty={false}
              flex={1}
            />

            <HexByteInput
              value={node.value ?? 0}
              onChange={(value) => set({ value })}
              placeholder="0x19"
              label="Value"
              size="xs"
              flex={1}
            />
            {node.op === 'maskEq' && (
              <HexByteInput
                value={node.mask ?? 255}
                onChange={(mask) => set({ mask })}
                placeholder="0xFF"
                label="Mask"
                size="xs"
                flex={1}
              />
            )}
          </Group>
        </Stack>
      )}
      {node.type === 'bits' && (
        <Stack gap="xs">
          <OffsetOrAnchorField node={node} onPatch={(p) => set(p)} showAnchorExtras={false} />
          <Group flex="xs">
            <NumberInput
              label="Bit Start"
              size="xs"
              flex={1}
              value={node.bitStart ?? 0}
              onChange={(v) =>
                set({ bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)) })
              }
              min={0}
              max={7}
            />

            <NumberInput
              label="Bit Count"
              size="xs"
              flex={1}
              value={node.bitCount ?? 1}
              onChange={(v) =>
                set({ bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)) })
              }
              min={1}
              max={32}
            />

            <SearchableSelect
              label="Op"
              size="xs"
              flex={1}
              value={node.op || 'eq'}
              onChange={(op) => set({ op })}
              options={CMP_OP_OPTS}
              allowEmpty={false}
            />

            <NumberInput
              label="Value"
              size="xs"
              flex={1}
              value={node.value ?? 0}
              onChange={(v) => set({ value: parseInt(String(v), 10) || 0 })}
              min={0}
            />
          </Group>
        </Stack>
      )}
      {node.type === 'byteCompare' && (
        <Stack gap="xs">
          <ByteCompareOperandField
            label="Left"
            operand={node.left}
            onPatch={(p) => set({ left: { ...node.left, ...p } })}
          />

          <ByteCompareOperandField
            label="Right"
            operand={node.right}
            onPatch={(p) => set({ right: { ...node.right, ...p } })}
          />

          <Divider size="md" />
          <SearchableSelect
            label="Op"
            size="xs"
            value={node.op || 'eq'}
            onChange={(op) => set({ op })}
            options={CMP_OP_OPTS}
            allowEmpty={false}
          />
        </Stack>
      )}
      {node.type === 'bytesAtOffset' && (
        <Stack gap="xs">
          <OffsetOrAnchorField node={node} onPatch={(p) => set(p)} showAnchorExtras={false} />
          <Group gap="xs" grow>
            <SearchableSelect
              label="Op"
              size="xs"
              flex={1}
              value={node.op || 'eq'}
              onChange={(op) => set({ op })}
              options={BYTES_AT_OFFSET_OP_OPTS}
              allowEmpty={false}
            />

            <TextInput
              label="Bytes (hex)"
              size="xs"
              flex={1}
              value={node.value || ''}
              onChange={(e) => set({ value: e.target.value.replace(/[^0-9a-fA-F]/g, '') })}
              placeholder="307B"
              styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
            />
          </Group>
          <Checkbox
            label="Scan / contains (from offset to end of payload)"
            description="Off: match only at the exact offset. On: look for this sequence anywhere from the offset through the tail."
            checked={!!node.scan}
            onChange={(e) => set({ scan: e.target.checked })}
          />
          <Text size="xs" c="dimmed">
            {node.scan
              ? 'eq finds the sequence somewhere in the tail; neq means it never appears. Anchor E9 with Δ 0 (or 1) + scan is “307B anywhere after E9,” covering both E90B (+10) and E90E (+13).'
              : 'eq requires payload[offset..] to equal these bytes; neq is the inverse. E.g. "307B" at offset N checks 0x30 then 0x7B.'}
          </Text>
        </Stack>
      )}
    </Paper>
  );
}

function ConditionGroupEditor({
  node,
  onChange,
  onDelete = undefined,
  onDuplicate = undefined,
  onPasteAfter = undefined,
  depth = 0,
}) {
  const [open, setOpen] = useState(false); // collapsed by default
  const { copyKind, hasKind, takeKind } = useRuleClip();
  const [clipMsg, setClipMsg] = useState('');
  const flash = (msg) => {
    setClipMsg(msg);
    window.setTimeout(() => setClipMsg(''), 2000);
  };
  const canPaste = hasKind(RULE_CLIP.condition);

  if (node?.type) {
    return (
      <ConditionLeafEditor
        node={node}
        onChange={onChange}
        onDelete={onDelete}
        onDuplicate={onDuplicate}
        onPasteAfter={onPasteAfter}
      />
    );
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
  const insertAfter = (i, next) => {
    const copy = [...children];
    copy.splice(i + 1, 0, next);
    onChange({ ...node, children: copy });
  };
  const duplicateChild = (i) => {
    insertAfter(i, structuredClone(children[i]));
  };

  const handleCopy = async () => {
    try {
      await copyKind(RULE_CLIP.condition, normalizeConditionNode(node));
      flash('Copied');
    } catch {
      flash('Copy failed');
    }
  };
  const handlePasteReplace = () => {
    const pasted = takeKind(RULE_CLIP.condition);
    if (!pasted) {
      flash('Nothing to paste');
      return;
    }
    onChange(normalizeConditionNode(pasted));
    flash('Replaced');
  };
  const handlePasteSibling = () => {
    if (!onPasteAfter) return;
    const pasted = takeKind(RULE_CLIP.condition);
    if (!pasted) {
      flash('Nothing to paste');
      return;
    }
    onPasteAfter(normalizeConditionNode(pasted));
    flash('Pasted after');
  };
  const handlePasteChild = () => {
    const pasted = takeKind(RULE_CLIP.condition);
    if (!pasted) {
      flash('Nothing to paste');
      return;
    }
    onChange({ ...node, children: [...children, normalizeConditionNode(pasted)] });
    flash('Pasted into group');
  };

  const leafCount = children.filter((c) => c?.type).length;
  const groupCount = children.filter((c) => c && !c.type).length;
  const summaryParts = [];
  if (leafCount) summaryParts.push(`${leafCount} condition${leafCount === 1 ? '' : 's'}`);
  if (groupCount) summaryParts.push(`${groupCount} group${groupCount === 1 ? '' : 's'}`);
  const summary = summaryParts.length ? summaryParts.join(', ') : 'empty';
  const displayName = typeof node.name === 'string' ? node.name.trim() : '';
  const disabled = node.enabled === false;

  return (
    <Paper
      p="sm"
      withBorder
      style={{
        marginLeft: depth ? 8 : 0,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <Group justify="space-between" mb={open ? 'xs' : 0} wrap="wrap">
        <Group gap="xs">
          <AppButton size="compact-xs" variant="default" onClick={() => setOpen((v) => !v)}>
            {open ? '▾' : '▸'}
          </AppButton>
          <Badge size="sm" variant={node.mode === 'some' ? 'filled' : 'light'}>
            {node.mode === 'some' ? 'OR (some)' : 'AND (all)'}
          </Badge>
          {disabled && (
            <Badge size="sm" color="gray" variant="light">
              off
            </Badge>
          )}
          {!open && displayName && (
            <Text size="xs" fw={600}>
              {displayName}
            </Text>
          )}
          {!open && (
            <Text size="xs" c="dimmed">
              {summary}
            </Text>
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
          <ConditionEnabledToggle node={node} onChange={onChange} />
        </Group>
        <Group gap="xs">
          <AppButton size="compact-xs" variant="default" onClick={handleCopy}>
            Copy
          </AppButton>
          <AppButton
            size="compact-xs"
            variant="default"
            disabled={!canPaste}
            onClick={handlePasteReplace}
          >
            Paste
          </AppButton>
          {onPasteAfter && (
            <AppButton
              size="compact-xs"
              variant="default"
              disabled={!canPaste}
              onClick={handlePasteSibling}
            >
              Paste after
            </AppButton>
          )}
          {onDuplicate && (
            <AppButton size="compact-xs" variant="default" onClick={onDuplicate}>
              Duplicate
            </AppButton>
          )}
          {onDelete && (
            <AppButton variant="danger" size="compact-xs" onClick={onDelete}>
              Delete group
            </AppButton>
          )}
          {clipMsg ? (
            <Text size="xs" c="dimmed">
              {clipMsg}
            </Text>
          ) : null}
        </Group>
      </Group>
      {open && (
        <>
          <ConditionNameField
            node={node}
            onChange={onChange}
            style={{ paddingBottom: 'var(--mantine-spacing-md)' }}
          />
          <Stack gap="xs">
            {children.map((child, i) => (
              <ConditionGroupEditor
                key={i}
                node={child}
                depth={depth + 1}
                onChange={(n) => setChild(i, n)}
                onDelete={() => removeChild(i)}
                onDuplicate={() => duplicateChild(i)}
                onPasteAfter={(pasted) => insertAfter(i, pasted)}
              />
            ))}
          </Stack>
          <Group gap="xs" mt="xs">
            <AppButton
              size="compact-xs"
              variant="default"
              onClick={() =>
                onChange({ ...node, children: [...children, createEmptyCondition('hexPrefix')] })
              }
            >
              Add condition
            </AppButton>
            <AppButton
              size="compact-xs"
              variant="default"
              onClick={() =>
                onChange({ ...node, children: [...children, createEmptyMatchGroup('all')] })
              }
            >
              Add nested group
            </AppButton>
            <AppButton
              size="compact-xs"
              variant="default"
              disabled={!canPaste}
              onClick={handlePasteChild}
            >
              Paste into group
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
        <Text size="xs" fw={600}>
          Target
        </Text>
        <AppButton variant="danger" size="compact-xs" onClick={onDelete}>
          Remove
        </AppButton>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <SearchableSelect
          label="Kind"
          size="xs"
          flex={1}
          value={target.kind || 'maskColor'}
          onChange={setKind}
          options={TARGET_KIND_OPTS}
          allowEmpty={false}
        />
        {target.kind === 'segmentColor' && (
          <>
            <Input.Wrapper size="xs" label="Segment mode">
              <SegmentedControl
                fullWidth
                size="xs"
                value={isMultiSeg ? 'multi' : 'single'}
                onChange={(mode) => {
                  if (mode === 'multi') {
                    const seed = target.segmentId ? [target.segmentId] : [];
                    const next = {
                      kind: 'segmentColor',
                      segmentIds: seed,
                      colorSlot: target.colorSlot ?? 0,
                    };
                    onChange(next);
                    return;
                  }
                  onChange({
                    kind: 'segmentColor',
                    segmentId:
                      (target.segmentIds && target.segmentIds[0]) || target.segmentId || '',
                    colorSlot: target.colorSlot ?? 0,
                  });
                }}
                data={[
                  { label: 'Single', value: 'single' },
                  { label: 'Multi (pair)', value: 'multi' },
                ]}
              />
            </Input.Wrapper>
            {isMultiSeg ? (
              <MultiSelect
                label="Segments"
                size="xs"
                flex={1}
                searchable
                data={(segmentOpts || []).map((o) => ({ value: o.value, label: o.label }))}
                value={target.segmentIds || []}
                onChange={(segmentIds) =>
                  onChange({
                    kind: 'segmentColor',
                    segmentIds,
                    colorSlot: target.colorSlot ?? 0,
                  })
                }
                placeholder="Pick pair / group…"
                comboboxProps={{ withinPortal: true }}
              />
            ) : (
              <SearchableSelect
                label="Segment"
                size="xs"
                flex={1}
                value={target.segmentId || ''}
                onChange={(segmentId) =>
                  onChange({ kind: 'segmentColor', segmentId, colorSlot: target.colorSlot ?? 0 })
                }
                options={segmentOpts}
                placeholder="(pick segment)"
                allowEmpty
              />
            )}

            <SearchableSelect
              label="Color Slot"
              size="xs"
              flex={1}
              value={String(target.colorSlot ?? 0)}
              onChange={(v) =>
                onChange({
                  ...target,
                  kind: 'segmentColor',
                  colorSlot: parseInt(String(v), 10) || 0,
                })
              }
              options={COLOR_SLOT_OPTS}
              allowEmpty={false}
            />
          </>
        )}
        {target.kind === 'maskColor' && (
          <SearchableSelect
            label="Mask"
            size="xs"
            flex={1}
            value={target.mask || 'all'}
            onChange={(mask) => onChange({ ...target, kind: 'maskColor', mask })}
            options={MASK_OPTS}
            allowEmpty={false}
          />
        )}
        {target.kind === 'segmentField' && (
          <>
            <SearchableSelect
              label="Segment"
              size="xs"
              flex={1}
              value={target.segmentId || ''}
              onChange={(segmentId) => onChange({ ...target, kind: 'segmentField', segmentId })}
              options={segmentOpts}
              placeholder="(pick segment)"
              allowEmpty
            />
            <Input.Wrapper size="xs" label="WLED field">
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
                size="xs"
                flex={1}
                value={target.field || ''}
                onChange={(e) =>
                  onChange({ ...target, kind: 'segmentField', field: e.target.value.trim() })
                }
                placeholder="sx, ix, c1… or any usermod field"
                styles={{ input: { fontFamily: 'monospace' } }}
              />
            </Input.Wrapper>
          </>
        )}
      </SimpleGrid>
    </Paper>
  );
}

function TimingParamBindingEditor({
  extract,
  segmentOpts,
  ruleTiming,
  timingModelOpts = [],
  onTimingChange,
  onEditTimingModels,
  onChange,
  onDelete,
}) {
  const set = (patch) => onChange({ ...extract, ...patch });
  const source = isTimingDerivedSource(extract.source) ? extract.source : 'timingFlashRate';
  const meta = TIMING_DERIVED_SOURCES.find((s) => s.value === source) || TIMING_DERIVED_SOURCES[0];
  const curve = extract.curve || createEmptyTimingParamBinding(source).curve;
  const target =
    Array.isArray(extract.targets) && extract.targets[0]
      ? extract.targets[0]
      : { kind: 'segmentField', segmentId: '', field: meta.defaultField };
  const timingConfigured = !!(ruleTiming?.enabled && ruleTiming?.timingModelId);
  const isReciprocal = curve.type === 'reciprocal';

  const setSource = (next) => {
    const nextBinding = createEmptyTimingParamBinding(next);
    onChange({
      ...nextBinding,
      name: extract.name || nextBinding.name,
      targets: [
        {
          kind: 'segmentField',
          segmentId: target.segmentId || '',
          field: nextBinding.targets[0].field,
        },
      ],
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
        <Text size="xs" fw={700}>
          Timing → param
        </Text>
        <Group gap="xs">
          <CopyPasteButtons
            kind={RULE_CLIP.timingParamBinding}
            getData={() => normalizeExtract(extract)}
            onPaste={(data) => onChange(normalizeExtract(data))}
          />
          <AppButton variant="danger" size="compact-xs" onClick={onDelete}>
            Remove
          </AppButton>
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        <SearchableSelect
          label="Timing Model"
          size="xs"
          flex={1}
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

        <SearchableSelect
          label="Decoded Value"
          size="xs"
          flex={1}
          value={source}
          onChange={setSource}
          options={TIMING_DERIVED_SOURCES.map((s) => ({
            value: s.value,
            label: s.label,
            searchText: `${s.label} ${s.value}`,
          }))}
          allowEmpty={false}
        />

        {!timingConfigured && (
          <Text size="xs" c="orange" style={{ gridColumn: '1 / -1' }}>
            Pick a timing model — flash rate / on-time / final-cycle stretch come from that
            model&apos;s formulas. Without one, values read as 0.
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

        <TextInput
          label="Name (optional)"
          size="xs"
          flex={1}
          value={extract.name || ''}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={meta.label}
        />

        <SearchableSelect
          label="Segment"
          size="xs"
          flex={1}
          value={target.segmentId || ''}
          onChange={(segmentId) => setTarget({ segmentId })}
          options={segmentOpts}
          placeholder="(pick segment from map)"
          allowEmpty
        />

        <Input.Wrapper size="xs" label="WLED field">
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
            size="xs"
            flex={1}
            value={target.field || ''}
            onChange={(e) => setTarget({ field: e.target.value.trim() })}
            placeholder="sx, ix, c1… or any usermod field"
            styles={{ input: { fontFamily: 'monospace' } }}
          />
        </Input.Wrapper>
      </SimpleGrid>
      <Text size="xs" c="dimmed" mt="xs" mb={4}>
        Curve maps the decoded {meta.unit} value onto the field (0–255 typical). Reciprocal is for
        flash-rate→speed; linear for durations or unknown params.
      </Text>
      <Flex justify="space-between" align="flex-end" gap="xs">
        <SearchableSelect
          label="Curve"
          size="xs"
          flex={1}
          value={curve.type || 'linear'}
          onChange={(type) => set({ curve: { ...curve, type } })}
          options={[
            { value: 'linear', label: 'linear' },
            { value: 'exponential', label: 'exponential' },
            { value: 'reciprocal', label: 'reciprocal (rate→param)' },
          ]}
          allowEmpty={false}
        />

        <NumberInput
          label={`${meta.unit} (min)`}
          size="xs"
          flex={1}
          value={curve.inMin ?? 0}
          decimalScale={2}
          onChange={(v) => set({ curve: { ...curve, inMin: Number(v) || 0 } })}
        />

        <NumberInput
          label={`${meta.unit} (max)`}
          size="xs"
          flex={1}
          value={curve.inMax ?? 50}
          decimalScale={2}
          onChange={(v) => set({ curve: { ...curve, inMax: Number(v) || 0 } })}
        />

        <NumberInput
          label="Out (min)"
          size="xs"
          flex={1}
          value={curve.outMin ?? 0}
          onChange={(v) => set({ curve: { ...curve, outMin: Number(v) || 0 } })}
        />

        <NumberInput
          label="Out (max)"
          size="xs"
          flex={1}
          value={curve.outMax ?? 255}
          onChange={(v) => set({ curve: { ...curve, outMax: Number(v) || 0 } })}
        />

        {curve.type === 'exponential' && (
          <NumberInput
            label="Exponent"
            size="xs"
            flex={1}
            value={curve.exponent ?? 2}
            step={0.1}
            onChange={(v) => set({ curve: { ...curve, exponent: Number(v) || 2 } })}
          />
        )}
        {isReciprocal && (
          <NumberInput
            label="Out (Scale)"
            size="xs"
            flex={1}
            value={curve.outScale ?? 50}
            step={1}
            min={0.01}
            decimalScale={2}
            onChange={(v) => set({ curve: { ...curve, outScale: Number(v) || 50 } })}
          />
        )}
      </Flex>
    </Paper>
  );
}

function ChannelGroupFields({ channelGroup, onChange }) {
  const cg = channelGroup || {
    r: { offset: 8, bitStart: 0, bitCount: 8 },
    g: { offset: 9, bitStart: 0, bitCount: 8 },
    b: { offset: 10, bitStart: 0, bitCount: 8 },
    scale: 'direct8',
  };
  const setChannel = (key, patch) => {
    onChange({
      ...cg,
      [key]: { ...(cg[key] || { offset: 0, bitStart: 0, bitCount: 8 }), ...patch },
    });
  };
  return (
    <Stack gap="xs">
      {['r', 'g', 'b'].map((key) => {
        const ch = cg[key] || { offset: 0, bitStart: 0, bitCount: 8 };
        return (
          <Paper key={key} p="xs" bg="var(--bg)" withBorder>
            <Text size="xs" fw={600} mb={4}>
              {key.toUpperCase()} channel
            </Text>
            <Stack gap="xs">
              <OffsetOrAnchorField node={ch} onPatch={(p) => setChannel(key, p)} />
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                <NumberInput
                  label="Bit Start"
                  size="xs"
                  flex={1}
                  value={ch.bitStart ?? 0}
                  onChange={(v) =>
                    setChannel(key, {
                      bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)),
                    })
                  }
                  min={0}
                  max={7}
                />

                <NumberInput
                  label="Bit Count"
                  size="xs"
                  flex={1}
                  value={ch.bitCount ?? 8}
                  onChange={(v) =>
                    setChannel(key, {
                      bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)),
                    })
                  }
                  min={1}
                  max={32}
                />
              </SimpleGrid>
            </Stack>
          </Paper>
        );
      })}

      <SearchableSelect
        label="Scale"
        size="xs"
        flex={1}
        value={cg.scale || 'direct8'}
        onChange={(scale) => onChange({ ...cg, scale })}
        options={[
          { value: 'direct8', label: 'direct8 (full-byte RGB)' },
          { value: 'bitReplicate6to8', label: 'bitReplicate6to8 (6-bit packed)' },
          { value: 'none', label: 'none (pass-through)' },
        ]}
        allowEmpty={false}
      />
    </Stack>
  );
}

function normalizeHexInput(v) {
  if (typeof v !== 'string') return null;
  const raw = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[1];
    const g = raw[2];
    const b = raw[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function FixedHexField({ value, onChange, label = 'Color', ...rest }) {
  // Mantine ColorInput is controlled and calls onChange on every keystroke —
  // must accept partial input (e.g. "0") or the field snaps back to value.
  return (
    <ColorInput
      label={label}
      format="hex"
      value={value || '#ffffff'}
      onChange={(v) => {
        const hex = normalizeHexInput(v);
        onChange(hex ?? (typeof v === 'string' ? v : '#ffffff'));
      }}
      swatches={[
        '#ff0000',
        '#ff4400',
        '#ff8800',
        '#ffcc00',
        '#ffff00',
        '#aaff00',
        '#00ff00',
        '#00ff88',
        '#00ffff',
        '#0088ff',
        '#0044ff',
        '#6600ff',
        '#aa00ff',
        '#ff00ff',
        '#ff0088',
        '#ffffff',
        '#888888',
        '#000000',
      ]}
      swatchesPerRow={9}
      styles={{ input: { fontFamily: 'monospace' } }}
      {...rest}
    />
  );
}

function ColorSourceRowEditor({ source, usedNames, onChange, onDelete }) {
  const src = source || createEmptyColorSource();
  const nameTrim = (src.name || '').trim();
  const isDup = nameTrim && usedNames.filter((n) => n === nameTrim).length > 1;
  const kind = src.kind === 'rgb' ? 'rgb' : src.kind === 'fixed' ? 'fixed' : 'palette';
  return (
    <Paper p="xs" withBorder bg="var(--surface2)">
      <Group justify="space-between" mb="xs">
        <Text size="xs" fw={600}>
          Color source
        </Text>
        <Group gap="xs">
          <CopyPasteButtons
            kind={RULE_CLIP.colorSource}
            getData={() => normalizeColorSource(src)}
            onPaste={(data) => onChange(normalizeColorSource(data))}
          />
          <AppButton variant="danger" size="compact-xs" onClick={onDelete}>
            Delete
          </AppButton>
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mb="xs">
        <TextInput
          label="Name"
          size="xs"
          flex={1}
          value={src.name || ''}
          onChange={(e) => onChange({ ...src, name: e.target.value })}
          placeholder="innerColor"
          error={isDup ? 'Duplicate name' : undefined}
          styles={{ input: { fontFamily: 'monospace' } }}
        />

        <Input.Wrapper size="xs" label="Kind">
          <SegmentedControl
            fullWidth
            size="xs"
            value={kind}
            onChange={(next) => {
              if (next === 'rgb') {
                onChange(createEmptyColorSourceRgb({ name: src.name || '' }));
                return;
              }
              if (next === 'fixed') {
                onChange(
                  createEmptyColorSourceFixed({
                    name: src.name || '',
                    value: src.value || '#ffffff',
                  }),
                );
                return;
              }
              onChange(createEmptyColorSource({ name: src.name || '', kind: 'palette' }));
            }}
            data={[
              { label: 'Fixed', value: 'fixed' },
              { label: 'Palette', value: 'palette' },
              { label: 'RGB', value: 'rgb' },
            ]}
          />
        </Input.Wrapper>
      </SimpleGrid>
      {kind === 'fixed' ? (
        <FixedHexField
          value={src.value || '#ffffff'}
          onChange={(value) => onChange({ ...src, kind: 'fixed', value })}
          size="xs"
        />
      ) : kind === 'rgb' ? (
        <ChannelGroupFields
          channelGroup={src.channelGroup}
          onChange={(channelGroup) => onChange({ ...src, kind: 'rgb', channelGroup })}
        />
      ) : (
        <Stack gap="xs">
          <OffsetOrAnchorField node={src} onPatch={(p) => onChange({ ...src, ...p })} />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <NumberInput
              label="Bit Start"
              size="xs"
              flex={1}
              value={src.bitStart ?? 0}
              onChange={(v) =>
                onChange({
                  ...src,
                  bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)),
                })
              }
              min={0}
              max={7}
            />

            <NumberInput
              label="Bit Count"
              size="xs"
              flex={1}
              value={src.bitCount ?? 8}
              onChange={(v) =>
                onChange({
                  ...src,
                  bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)),
                })
              }
              min={1}
              max={32}
            />
          </SimpleGrid>
        </Stack>
      )}
    </Paper>
  );
}

function ColorSourcesEditor({ sources, onChange }) {
  const list = Array.isArray(sources) ? sources : [];
  const usedNames = list.map((s) => (s.name || '').trim()).filter(Boolean);
  const dups = findDuplicateColorSourceNames(list);
  return (
    <CollapsibleBlock
      title="Color sources"
      summary={list.length ? `${list.length} named` : 'none'}
      headerRight={
        <CopyPasteButtons
          kind={RULE_CLIP.colorSources}
          getData={() => normalizeColorSources(list)}
          onPaste={(data) => onChange(normalizeColorSources(data))}
        />
      }
    >
      <Text size="xs" c="dimmed" mb="xs" lh={1.45}>
        Define fixed, palette, or packet-RGB colors once on this rule, then reference them by name
        in &quot;Named blend&quot; extracts (N-way weighted mixes per segment).
      </Text>
      {dups.length > 0 && (
        <Text size="xs" c="red" mb="xs" fw={600}>
          Duplicate source names must be fixed before these can be used reliably: {dups.join(', ')}
        </Text>
      )}
      <Stack gap="xs">
        {list.map((src, i) => (
          <ColorSourceRowEditor
            key={i}
            source={src}
            usedNames={usedNames}
            onChange={(next) => {
              const copy = [...list];
              copy[i] = next;
              onChange(copy);
            }}
            onDelete={() => onChange(list.filter((_, j) => j !== i))}
          />
        ))}
      </Stack>
      <AppButton
        size="compact-sm"
        variant="default"
        mt="xs"
        onClick={() => {
          const base = `color${list.length + 1}`;
          let name = base;
          let n = 2;
          const taken = new Set(usedNames);
          while (taken.has(name)) {
            name = `${base}_${n++}`;
          }
          onChange([...list, createEmptyColorSource({ name })]);
        }}
      >
        Add color source
      </AppButton>
    </CollapsibleBlock>
  );
}

function ColorBlendSourceEditor({ label, source, onChange }) {
  const src = source || createEmptyColorBlendSource();
  const kind =
    src.kind === 'fixed' ? 'fixed' : src.kind === 'rgb' || src.channelGroup ? 'rgb' : 'palette';
  return (
    <Paper p="xs" withBorder bg="var(--bg)">
      <Text size="xs" fw={600} mb={4}>
        {label}
      </Text>
      <Input.Wrapper size="xs" label="Source" mb="xs">
        <SegmentedControl
          fullWidth
          size="xs"
          value={kind}
          onChange={(next) => {
            if (next === 'fixed') {
              onChange({ kind: 'fixed', value: src.value || '#ffffff' });
              return;
            }
            if (next === 'rgb') {
              onChange({
                kind: 'rgb',
                paletteMap: false,
                channelGroup: src.channelGroup || {
                  r: { offset: src.offset ?? 8, bitStart: 0, bitCount: 8 },
                  g: { offset: (src.offset ?? 8) + 1, bitStart: 0, bitCount: 8 },
                  b: { offset: (src.offset ?? 8) + 2, bitStart: 0, bitCount: 8 },
                  scale: 'direct8',
                },
              });
              return;
            }
            onChange({
              kind: 'palette',
              offset: src.offset ?? 0,
              bitStart: src.bitStart ?? 0,
              bitCount: src.bitCount ?? 8,
              paletteMap: true,
            });
          }}
          data={[
            { label: 'Fixed', value: 'fixed' },
            { label: 'Palette', value: 'palette' },
            { label: 'RGB', value: 'rgb' },
          ]}
        />
      </Input.Wrapper>
      {kind === 'fixed' ? (
        <FixedHexField
          value={src.value || '#ffffff'}
          onChange={(value) => onChange({ kind: 'fixed', value })}
        />
      ) : kind === 'rgb' ? (
        <ChannelGroupFields
          channelGroup={src.channelGroup}
          onChange={(channelGroup) => onChange({ kind: 'rgb', paletteMap: false, channelGroup })}
        />
      ) : (
        <Stack gap="xs">
          <OffsetOrAnchorField
            node={src}
            onPatch={(p) => onChange({ ...src, kind: 'palette', ...p })}
          />
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
            <NumberInput
              label="Bit Start"
              size="xs"
              flex={1}
              value={src.bitStart ?? 0}
              onChange={(v) =>
                onChange({
                  ...src,
                  kind: 'palette',
                  bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)),
                })
              }
              min={0}
              max={7}
            />

            <NumberInput
              label="Bit Count"
              size="xs"
              flex={1}
              value={src.bitCount ?? 8}
              onChange={(v) =>
                onChange({
                  ...src,
                  kind: 'palette',
                  bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)),
                })
              }
              min={1}
              max={32}
            />

            <Input.Wrapper size="xs" label="Map">
              <SegmentedControl
                fullWidth
                size="xs"
                value={src.paletteMap === false ? 'raw' : 'palette'}
                onChange={(mode) =>
                  onChange({ ...src, kind: 'palette', paletteMap: mode === 'palette' })
                }
                data={[
                  { label: 'Palette idx', value: 'palette' },
                  { label: 'Raw gray', value: 'raw' },
                ]}
              />
            </Input.Wrapper>
          </SimpleGrid>
        </Stack>
      )}
    </Paper>
  );
}

function ExtractRowEditor({ extract, segmentOpts, colorSourceOpts = [], onChange, onDelete }) {
  // Do not stomp `source` here — mode-defining fields are owned by setExtractMode /
  // setChannel / setScale. Forcing payloadBits on every plain-field edit mis-routes
  // namedSource / colorSourceBlend extracts and interacts badly with stale paletteMap.
  const set = (patch) => onChange({ ...extract, ...patch });
  const targets = Array.isArray(extract.targets) ? extract.targets : [];
  const curve = extract.curve || {
    type: 'linear',
    inMin: 0,
    inMax: 15,
    outMin: 0,
    outMax: 255,
    exponent: 2,
    outScale: 50,
  };
  const scale = extract.channelGroup?.scale || 'bitReplicate6to8';
  const defaultChannel = (offset) =>
    scale === 'direct8'
      ? { offset, bitStart: 0, bitCount: 8 }
      : { offset, bitStart: 1, bitCount: 6 };
  const channelGroup = extract.channelGroup || {
    r: defaultChannel(8),
    g: defaultChannel(9),
    b: defaultChannel(10),
    scale: 'bitReplicate6to8',
  };
  const colorBlend = extract.colorBlend || createEmptyColorBlend();
  const blend = Array.isArray(extract.blend) ? extract.blend : [createEmptyColorSourceBlendEntry()];
  const isReciprocal = curve.type === 'reciprocal';
  const isSingleSourcePassthrough =
    isColorSourceBlendSource(extract.source) &&
    Array.isArray(extract.blend) &&
    extract.blend.length === 1;
  const extractMode = isSingleSourcePassthrough
    ? 'namedSource'
    : isColorSourceBlendSource(extract.source)
      ? 'colorSourceBlend'
      : isFixedColorSource(extract.source)
        ? 'fixedColor'
        : extract.channelGroup
          ? 'channelGroup'
          : extract.colorBlend
            ? 'colorBlend'
            : extract.paletteMap
              ? 'palette'
              : 'curve';
  const blendWeightSum = colorSourceBlendWeightSum(blend);
  const blendWeightOk = Math.abs(blendWeightSum - 100) < 0.5;
  const title = extract.name?.trim() ? extract.name.trim() : 'Packet extract';
  const summary = [
    extractMode === 'fixedColor'
      ? extract.value || '#ffffff'
      : extractMode === 'namedSource'
        ? `→ ${extract.blend?.[0]?.source || '(none)'}`
        : extractMode === 'channelGroup'
          ? 'rgb channel group'
          : extractMode === 'colorSourceBlend'
            ? 'named blend'
            : extractMode === 'colorBlend'
              ? 'color blend'
              : formatOffsetOrAnchorLabel(extract),
    extractMode === 'fixedColor'
      ? 'hard-coded'
      : extractMode === 'namedSource'
        ? 'named source'
        : extractMode === 'channelGroup'
          ? channelGroup.scale || 'bitReplicate6to8'
          : extractMode === 'colorSourceBlend'
            ? `${blend.length} src · ${blendWeightSum.toFixed(0)}%`
            : extractMode === 'colorBlend'
              ? `ratio ${colorBlend.ratio?.mode || 'fixed'}`
              : extractMode === 'palette'
                ? 'palette'
                : curve.type || 'curve',
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
    delete rest.blend;
    onChange(rest);
  };

  const setExtractMode = (mode) => {
    if (mode === 'fixedColor') {
      const rest = createEmptyFixedColorExtract(extract.name || '');
      onChange({
        ...rest,
        name: extract.name || '',
        value: extract.value || rest.value,
        targets:
          Array.isArray(extract.targets) && extract.targets.length ? extract.targets : rest.targets,
      });
      return;
    }
    if (mode === 'palette') {
      const rest = { ...extract, source: 'payloadBits', paletteMap: true };
      delete rest.curve;
      delete rest.channelGroup;
      delete rest.colorBlend;
      delete rest.blend;
      delete rest.value;
      onChange(rest);
      return;
    }
    if (mode === 'channelGroup') {
      const rest = { ...extract, source: 'payloadBits', paletteMap: false };
      delete rest.curve;
      delete rest.colorBlend;
      delete rest.blend;
      delete rest.value;
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
      delete rest.blend;
      delete rest.value;
      onChange({ ...rest, colorBlend: extract.colorBlend || createEmptyColorBlend() });
      return;
    }
    if (mode === 'namedSource') {
      const rest = createEmptyColorSourceBlendExtract(extract.name || '');
      onChange({
        ...rest,
        name: extract.name || '',
        source: 'colorSourceBlend',
        targets:
          Array.isArray(extract.targets) && extract.targets.length ? extract.targets : rest.targets,
        blend: [
          {
            source: (Array.isArray(extract.blend) && extract.blend[0]?.source) || '',
            weightPct: 100,
          },
        ],
      });
      return;
    }
    if (mode === 'colorSourceBlend') {
      const rest = createEmptyColorSourceBlendExtract(extract.name || '');
      // Single-entry blends render as "Named source"; promote to two slots so the
      // multi-source Named blend UI can stay selected.
      let nextBlend =
        Array.isArray(extract.blend) && extract.blend.length ? extract.blend : rest.blend;
      if (nextBlend.length === 1) {
        nextBlend = [...nextBlend, createEmptyColorSourceBlendEntry({ weightPct: 0 })];
      }
      onChange({
        ...rest,
        name: extract.name || '',
        targets:
          Array.isArray(extract.targets) && extract.targets.length ? extract.targets : rest.targets,
        blend: nextBlend,
      });
      return;
    }
    const rest = { ...extract, source: 'payloadBits', paletteMap: false, curve };
    delete rest.channelGroup;
    delete rest.colorBlend;
    delete rest.blend;
    delete rest.value;
    onChange(rest);
  };

  const setScale = (nextScale) => {
    const bitDefaults =
      nextScale === 'direct8'
        ? { bitStart: 0, bitCount: 8 }
        : nextScale === 'bitReplicate6to8'
          ? { bitStart: 1, bitCount: 6 }
          : null;
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
    delete rest.blend;
    onChange(rest);
  };

  return (
    <CollapsibleBlock
      title={title}
      titleSize="xs"
      titleFw={600}
      summary={summary}
      paperProps={{ p: 'xs', bg: 'var(--surface2)' }}
      headerRight={
        <Group gap="xs">
          <CopyPasteButtons
            kind={RULE_CLIP.packetExtract}
            getData={() => normalizeExtract(extract)}
            onPaste={(data) => onChange(normalizeExtract(data))}
          />
          <AppButton variant="danger" size="compact-xs" onClick={onDelete}>
            Delete
          </AppButton>
        </Group>
      }
    >
      <Text size="xs" c="dimmed" mb="xs">
        Hard-code a color, or read bits from the packet. For flash rate / on-time → segment fields,
        use <strong>Timing → Add timing → param binding</strong> above (not this section).
      </Text>
      <Input.Wrapper size="xs" label="Value mode">
        <SegmentedControl
          fullWidth
          value={extractMode}
          onChange={setExtractMode}
          data={[
            { label: 'Fixed', value: 'fixedColor' },
            { label: 'Palette', value: 'palette' },
            { label: 'Curve', value: 'curve' },
            { label: 'RGB', value: 'channelGroup' },
            { label: 'Named source', value: 'namedSource' },
            { label: 'Blend', value: 'colorBlend' },
            { label: 'Named blend', value: 'colorSourceBlend' },
          ]}
        />
      </Input.Wrapper>
      {extractMode === 'fixedColor' && (
        <Stack gap="xs" mt="xs">
          <TextInput
            label="Name"
            size="xs"
            flex={1}
            value={extract.name || ''}
            onChange={(e) => onChange({ ...extract, source: 'fixedColor', name: e.target.value })}
            placeholder="solidPurple"
          />

          <FixedHexField
            value={extract.value || '#ffffff'}
            onChange={(value) => onChange({ ...extract, source: 'fixedColor', value })}
          />
        </Stack>
      )}
      {extractMode === 'namedSource' && (
        <Stack gap="xs" mt="xs">
          <TextInput
            label="Name"
            size="xs"
            flex={1}
            value={extract.name || ''}
            onChange={(e) =>
              onChange({
                ...extract,
                source: 'colorSourceBlend',
                name: e.target.value,
                blend: [{ source: extract.blend?.[0]?.source || '', weightPct: 100 }],
              })
            }
            placeholder="topLeftColor"
          />

          {!colorSourceOpts.length && (
            <Text size="xs" c="orange">
              No color sources defined yet — add one under &quot;Color sources&quot; above.
            </Text>
          )}

          <SearchableSelect
            label="Source"
            size="xs"
            flex={1}
            value={extract.blend?.[0]?.source || ''}
            onChange={(value) =>
              onChange({
                ...extract,
                source: 'colorSourceBlend',
                blend: [{ source: value || '', weightPct: 100 }],
              })
            }
            options={colorSourceOpts}
            placeholder="Choose a named color source"
            allowEmpty
          />
        </Stack>
      )}
      {extractMode !== 'channelGroup' &&
        extractMode !== 'colorBlend' &&
        extractMode !== 'colorSourceBlend' &&
        extractMode !== 'fixedColor' &&
        extractMode !== 'namedSource' && (
          <Stack gap="xs" mt="xs">
            <TextInput
              label="Name"
              size="xs"
              flex={1}
              value={extract.name || ''}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="topLeft"
            />

            <OffsetOrAnchorField node={extract} onPatch={(p) => set(p)} />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <NumberInput
                label="Bit Start"
                size="xs"
                flex={1}
                value={extract.bitStart ?? 0}
                onChange={(v) =>
                  set({ bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)) })
                }
                min={0}
                max={7}
              />

              <NumberInput
                label="Bit Count"
                size="xs"
                flex={1}
                value={extract.bitCount ?? 5}
                onChange={(v) =>
                  set({ bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)) })
                }
                min={1}
                max={32}
              />
            </SimpleGrid>
          </Stack>
        )}
      {extractMode === 'channelGroup' && (
        <Stack gap="xs" mt="xs">
          <TextInput
            label="Name"
            size="xs"
            flex={1}
            value={extract.name || ''}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="e908Color"
          />

          {['r', 'g', 'b'].map((key) => {
            const ch = channelGroup[key] || defaultChannel(key === 'r' ? 8 : key === 'g' ? 9 : 10);
            return (
              <Paper key={key} p="xs" bg="var(--bg)" withBorder>
                <Text size="xs" fw={600} mb={4}>
                  {key.toUpperCase()} channel
                </Text>
                <Stack gap="xs">
                  <OffsetOrAnchorField node={ch} onPatch={(p) => setChannel(key, p)} />
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                    <NumberInput
                      label="Bit Start"
                      size="xs"
                      flex={1}
                      value={ch.bitStart ?? (scale === 'direct8' ? 0 : 1)}
                      onChange={(v) =>
                        setChannel(key, {
                          bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)),
                        })
                      }
                      min={0}
                      max={7}
                    />

                    <NumberInput
                      label="Bit Count"
                      size="xs"
                      flex={1}
                      value={ch.bitCount ?? (scale === 'direct8' ? 8 : 6)}
                      onChange={(v) =>
                        setChannel(key, {
                          bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)),
                        })
                      }
                      min={1}
                      max={32}
                    />
                  </SimpleGrid>
                </Stack>
              </Paper>
            );
          })}

          <SearchableSelect
            label="Scale"
            size="xs"
            flex={1}
            value={channelGroup.scale || 'bitReplicate6to8'}
            onChange={setScale}
            options={[
              { value: 'bitReplicate6to8', label: 'bitReplicate6to8 (6-bit packed)' },
              { value: 'direct8', label: 'direct8 (full-byte RGB)' },
              { value: 'none', label: 'none (pass-through)' },
            ]}
            allowEmpty={false}
          />
        </Stack>
      )}
      {extractMode === 'colorSourceBlend' && (
        <Stack gap="xs" mt="xs">
          <TextInput
            label="Name"
            size="xs"
            flex={1}
            value={extract.name || ''}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="centerBlend"
          />

          <Text size="xs" c="dimmed" lh={1.45}>
            Weighted mix of named rule color sources. Add sources in the Color sources section
            above. Single entry at 100% is a pass-through.
          </Text>
          {!colorSourceOpts.length && (
            <Text size="xs" c="orange">
              No named color sources on this rule yet.
            </Text>
          )}
          <Text size="xs" fw={600} c={blendWeightOk ? 'dimmed' : 'orange'}>
            Total: {blendWeightSum.toFixed(0)}% — should be 100%
            {blendWeightOk ? '' : ' (firmware will normalize)'}
          </Text>
          <Stack gap="xs">
            {blend.map((entry, i) => (
              <Group key={i} gap="xs" align="flex-end" wrap="wrap">
                <SearchableSelect
                  label="Source"
                  size="xs"
                  flex={1}
                  value={entry.source || ''}
                  onChange={(source) => {
                    const next = [...blend];
                    next[i] = { ...next[i], source };
                    set({ source: 'colorSourceBlend', blend: next, paletteMap: false });
                  }}
                  options={colorSourceOpts}
                  placeholder="(pick source)"
                  allowEmpty
                />

                <NumberInput
                  label="Weight %"
                  size="xs"
                  flex={1}
                  value={entry.weightPct ?? 0}
                  onChange={(v) => {
                    const next = [...blend];
                    next[i] = { ...next[i], weightPct: Math.max(0, Number(v) || 0) };
                    set({ source: 'colorSourceBlend', blend: next, paletteMap: false });
                  }}
                  min={0}
                  max={1000}
                />

                <AppButton
                  size="compact-xs"
                  variant="danger"
                  onClick={() => {
                    const next = blend.filter((_, j) => j !== i);
                    set({
                      source: 'colorSourceBlend',
                      blend: next.length ? next : [createEmptyColorSourceBlendEntry()],
                      paletteMap: false,
                    });
                  }}
                >
                  Delete
                </AppButton>
              </Group>
            ))}
          </Stack>
          <AppButton
            size="compact-xs"
            variant="default"
            onClick={() =>
              set({
                source: 'colorSourceBlend',
                blend: [...blend, createEmptyColorSourceBlendEntry({ weightPct: 0 })],
                paletteMap: false,
              })
            }
          >
            Add source
          </AppButton>
        </Stack>
      )}
      {extractMode === 'colorBlend' && (
        <Stack gap="xs" mt="xs">
          <TextInput
            label="Name"
            size="xs"
            flex={1}
            value={extract.name || ''}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="blendedColor"
          />

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
            <Text size="xs" fw={600} mb={4}>
              Blend ratio
            </Text>
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
              <Stack gap="xs">
                <OffsetOrAnchorField
                  node={colorBlend.ratio}
                  allowColorFallback={false}
                  onPatch={(p) =>
                    set({
                      colorBlend: {
                        ...colorBlend,
                        ratio: { ...colorBlend.ratio, ...p },
                      },
                    })
                  }
                />
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  <NumberInput
                    label="Bit Start"
                    size="xs"
                    flex={1}
                    value={colorBlend.ratio.bitStart ?? 0}
                    onChange={(v) =>
                      set({
                        colorBlend: {
                          ...colorBlend,
                          ratio: {
                            ...colorBlend.ratio,
                            bitStart: Math.min(7, Math.max(0, parseInt(String(v), 10) || 0)),
                          },
                        },
                      })
                    }
                    min={0}
                    max={7}
                  />

                  <NumberInput
                    label="Bit Count"
                    size="xs"
                    flex={1}
                    value={colorBlend.ratio.bitCount ?? 8}
                    onChange={(v) =>
                      set({
                        colorBlend: {
                          ...colorBlend,
                          ratio: {
                            ...colorBlend.ratio,
                            bitCount: Math.min(32, Math.max(1, parseInt(String(v), 10) || 1)),
                          },
                        },
                      })
                    }
                    min={1}
                    max={32}
                  />
                </SimpleGrid>
              </Stack>
            ) : (
              <Slider
                label={`Ratio (${((colorBlend.ratio?.value ?? 0.5) * 100).toFixed(0)}% B)`}
                size="md"
                flex={1}
                min={0}
                max={1}
                step={0.01}
                value={colorBlend.ratio?.value ?? 0.5}
                onChange={(value) =>
                  set({
                    colorBlend: { ...colorBlend, ratio: { mode: 'fixed', value } },
                  })
                }
              />
            )}
          </Paper>
        </Stack>
      )}
      {extractMode === 'curve' && (
        <Stack gap="xs" mt="xs">
          <SearchableSelect
            label="Curve"
            size="xs"
            flex={1}
            value={curve.type || 'linear'}
            onChange={(type) => set({ curve: { ...curve, type } })}
            options={[
              { value: 'linear', label: 'linear' },
              { value: 'exponential', label: 'exponential' },
              { value: 'reciprocal', label: 'reciprocal (rate→param)' },
            ]}
            allowEmpty={false}
          />
          <SimpleGrid cols={{ base: 2, sm: 2 }} spacing="xs">
            <NumberInput
              label={isReciprocal ? 'Hz min (clamp)' : 'In (min)'}
              size="xs"
              flex={1}
              value={curve.inMin ?? 0}
              decimalScale={isReciprocal ? 2 : 0}
              onChange={(v) => set({ curve: { ...curve, inMin: Number(v) || 0 } })}
            />

            <NumberInput
              label={isReciprocal ? 'Hz max (clamp)' : 'In (max)'}
              size="xs"
              flex={1}
              value={curve.inMax ?? 15}
              decimalScale={isReciprocal ? 2 : 0}
              onChange={(v) => set({ curve: { ...curve, inMax: Number(v) || 0 } })}
            />

            <NumberInput
              label="Out (min)"
              size="xs"
              flex={1}
              value={curve.outMin ?? 0}
              onChange={(v) => set({ curve: { ...curve, outMin: Number(v) || 0 } })}
            />

            <NumberInput
              label="Out"
              size="xs"
              flex={1}
              value={curve.outMax ?? 255}
              onChange={(v) => set({ curve: { ...curve, outMax: Number(v) || 0 } })}
            />

            {curve.type === 'exponential' && (
              <NumberInput
                label="Exponent"
                size="xs"
                flex={1}
                value={curve.exponent ?? 2}
                step={0.1}
                onChange={(v) => set({ curve: { ...curve, exponent: Number(v) || 2 } })}
              />
            )}
            {isReciprocal && (
              <NumberInput
                label="Out Scale"
                size="xs"
                flex={1}
                value={curve.outScale ?? 50}
                step={1}
                min={0.01}
                decimalScale={2}
                onChange={(v) => set({ curve: { ...curve, outScale: Number(v) || 50 } })}
              />
            )}
          </SimpleGrid>
          {isReciprocal && (
            <Text size="xs" c="dimmed" lh={1.45}>
              Reciprocal treats extracted bits as a rate (Hz). For timing-model flash rate, use the
              Timing bindings section instead.
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
  const fallbackDuration = rule.fallbackDuration || createEmptyFallbackDuration();
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
    label: segmentLabel(s),
    searchText: `${s.name || ''} ${s.id} ${s.start} ${s.stop}`,
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
          <Badge size="xs" variant="outline">
            P{rule.priority ?? index * 10}
          </Badge>
          {rule.enabled === false && (
            <Badge size="xs" color="gray">
              off
            </Badge>
          )}
        </Group>
        <Group gap={4}>
          <AppButton
            size="compact-xs"
            variant="default"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </AppButton>
          <AppButton
            size="compact-xs"
            variant="default"
            disabled={index >= total - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </AppButton>
          <AppButton size="compact-xs" variant="default" onClick={onDuplicate}>
            Duplicate
          </AppButton>
          <AppButton size="compact-xs" variant="danger" onClick={onDelete}>
            Delete
          </AppButton>
        </Group>
      </Group>

      {expanded && (
        <Stack gap="sm" mt="sm">
          <Group gap="xs" justify="space-between" align="flex-end">
            <DeferredTextInput
              label="Name"
              flex={1}
              value={rule.name || ''}
              onCommit={(name) => onChange({ ...rule, name })}
            />
            <NumberInput
              label="Priority"
              flex={1}
              value={rule.priority ?? index * 10}
              onChange={(v) => onChange({ ...rule, priority: parseInt(String(v), 10) || 0 })}
              description="Lower runs first; reorder buttons rewrite 0,10,20…"
            />
          </Group>

          <Divider label="Match Conditions" />
          <ConditionGroupEditor
            node={rule.match || createEmptyMatchGroup('all')}
            onChange={(match) => onChange({ ...rule, match })}
          />
          <Divider label="Properties" />

          <Checkbox
            label="Enabled"
            checked={rule.enabled !== false}
            onChange={(e) => onChange({ ...rule, enabled: e.target.checked })}
          />
          <Checkbox
            label="Ignore lower-priority rules while active"
            description="Until this rule finishes cooldown and restores, other rules with worse priority (higher number) cannot fire. Exact re-match of this rule still works."
            checked={!!rule.ignoreLowerPriority}
            onChange={(e) => onChange({ ...rule, ignoreLowerPriority: e.target.checked })}
          />
          <Checkbox
            label="Ignore all other rules while active"
            description="Until this rule finishes cooldown and restores, no other rule can fire. Exact re-match of this rule still works."
            checked={!!rule.ignoreAllOtherRules}
            onChange={(e) => onChange({ ...rule, ignoreAllOtherRules: e.target.checked })}
          />
          <Checkbox
            label="Report as unmatched when applied"
            description="Still runs the rule (e.g. fade to black), but also emits an unmatched packet event for capture / Sheets."
            checked={!!rule.reportAsUnmatched}
            onChange={(e) => onChange({ ...rule, reportAsUnmatched: e.target.checked })}
          />
          <SearchableSelect
            label="Preset"
            size="xs"
            flex={1}
            value={rule.presetId || ''}
            onChange={(presetId) => onChange({ ...rule, presetId })}
            placeholder="(none — colors / fields only)"
            options={presetOpts}
            allowEmpty
          />
          {!rule.presetId && (
            <Stack gap="xs">
              <Checkbox
                label="Set a global effect (no preset)"
                checked={!!effect.enabled}
                onChange={(e) =>
                  onChange({
                    ...rule,
                    effect: {
                      ...(rule.effect || createEmptyRuleEffect()),
                      enabled: e.target.checked,
                    },
                  })
                }
              />
              {effect.enabled && (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  <SearchableSelect
                    label="Effect"
                    size="xs"
                    flex={1}
                    value={effect.fx >= 0 ? String(effect.fx) : ''}
                    onChange={(v) =>
                      onChange({
                        ...rule,
                        effect: { ...effect, fx: v === '' ? -1 : parseInt(String(v), 10) },
                      })
                    }
                    options={fxOpts}
                    placeholder="(Solid)"
                    allowEmpty
                  />

                  <SearchableSelect
                    label="Palette"
                    size="xs"
                    flex={1}
                    value={effect.pal >= 0 ? String(effect.pal) : ''}
                    onChange={(v) =>
                      onChange({
                        ...rule,
                        effect: { ...effect, pal: v === '' ? -1 : parseInt(String(v), 10) },
                      })
                    }
                    options={palOpts}
                    placeholder="(none)"
                    allowEmpty
                  />

                  <Slider
                    label="Speed"
                    size="md"
                    flex={1}
                    min={0}
                    max={255}
                    value={effect.sx ?? 128}
                    onChange={(v) => onChange({ ...rule, effect: { ...effect, sx: v } })}
                  />

                  <Slider
                    label="Intensity"
                    size="md"
                    flex={1}
                    min={0}
                    max={255}
                    value={effect.ix ?? 128}
                    onChange={(v) => onChange({ ...rule, effect: { ...effect, ix: v } })}
                  />
                </SimpleGrid>
              )}
            </Stack>
          )}

          <SearchableSelect
            label="Segment Map"
            size="xs"
            flex={1}
            value={rule.segmentMapId || ''}
            onChange={(segmentMapId) => onChange({ ...rule, segmentMapId })}
            placeholder="(none)"
            options={mapOpts}
            allowEmpty
          />

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
              headerActions={
                <CopyPasteButtons
                  kind={RULE_CLIP.segmentSources}
                  getData={() => ({
                    segmentOverrides: normalizeSegmentOverrides(rule.segmentOverrides || {}),
                    segmentSourceMode: normalizeSegmentSourceMode(rule.segmentSourceMode),
                  })}
                  onPaste={(data) =>
                    onChange({
                      ...rule,
                      segmentOverrides: normalizeSegmentOverrides(data?.segmentOverrides),
                      segmentSourceMode: normalizeSegmentSourceMode(data?.segmentSourceMode),
                    })
                  }
                />
              }
            />
          )}

          <CollapsibleBlock
            title="Timing"
            summary={
              timing.enabled
                ? `on · hold ${timing.cooldownSec ?? 2}s${timing.timingModelId ? ` · ${timingModelOpts.find((m) => m.value === timing.timingModelId)?.label || timing.timingModelId}` : ''}`
                : 'off'
            }
            headerRight={
              <CopyPasteButtons
                kind={RULE_CLIP.timing}
                getData={() => ({
                  timing: normalizeRuleTiming(timing),
                  bindings: (rule.extract || [])
                    .filter((ex) => isTimingDerivedSource(ex.source))
                    .map((ex) => normalizeExtract(ex)),
                })}
                onPaste={(data) => {
                  const wrapped =
                    data && typeof data === 'object' && ('timing' in data || 'bindings' in data);
                  const nextTiming = normalizeRuleTiming(wrapped ? data.timing : data);
                  if (!wrapped) {
                    onChange({ ...rule, timing: nextTiming });
                    return;
                  }
                  const bindings = (Array.isArray(data.bindings) ? data.bindings : [])
                    .map((ex) => normalizeExtract(ex))
                    .filter((ex) => isTimingDerivedSource(ex.source));
                  const packetOnes = (rule.extract || []).filter(
                    (ex) => !isTimingDerivedSource(ex.source),
                  );
                  onChange({
                    ...rule,
                    timing: nextTiming,
                    extract: [...packetOnes, ...bindings],
                  });
                }}
              />
            }
          >
            <Text size="xs" c="dimmed" mb="xs">
              On-time comes from the packet timing byte (including final-cycle stretch from
              fadeBits). Cooldown is how long lights stay black after the stretched final cycle.
              Bind flash rate / on-time / stretch to segment fields (sx, ix, …) in the section at
              the bottom of this card.
            </Text>
            <Switch
              label="Use packet timing byte"
              checked={!!timing.enabled}
              onChange={(e) =>
                onChange({
                  ...rule,
                  timing: { ...timing, enabled: e.target.checked },
                })
              }
              mb="xs"
            />
            <Stack gap="xs">
              <OffsetOrAnchorField
                label="Byte offset"
                node={timing}
                disabled={!timing.enabled}
                allowColorFallback={false}
                onPatch={(p) =>
                  onChange({
                    ...rule,
                    timing: { ...timing, ...p },
                  })
                }
              />

              <NumberInput
                label="Black Hold"
                description="Cooldown (sec)"
                size="xs"
                flex={1}
                value={timing.cooldownSec ?? 2}
                onChange={(v) =>
                  onChange({
                    ...rule,
                    timing: { ...timing, cooldownSec: Math.max(0, parseInt(String(v), 10) || 0) },
                  })
                }
                min={0}
                disabled={!timing.enabled}
              />

              <NumberInput
                label="Stretch Override (ms)"
                size="xs"
                flex={1}
                value={timing.fadeOverrideMs ?? ''}
                placeholder="Packet stretch"
                onChange={(v) => {
                  const blank = v === '' || v === null || v === undefined;
                  onChange({
                    ...rule,
                    timing: {
                      ...timing,
                      fadeOverrideMs: blank ? null : Math.max(0, parseInt(String(v), 10) || 0),
                    },
                  });
                }}
                min={0}
                disabled={!timing.enabled}
              />
            </Stack>

            <SearchableSelect
              label="Timing Model"
              size="xs"
              flex={1}
              mt="xs"
              value={timing.timingModelId || ''}
              onChange={(timingModelId) =>
                onChange({
                  ...rule,
                  timing: { ...timing, enabled: true, timingModelId },
                })
              }
              placeholder="Select timing model (e.g. E9 0E strobe)…"
              options={timingModelOpts}
              allowEmpty
              disabled={!timing.enabled}
            />

            {timing.enabled &&
              timing.timingModelId &&
              !timingModelOpts.some((m) => m.value === timing.timingModelId) && (
                <Text size="xs" c="orange" mt={4}>
                  Timing model &quot;{timing.timingModelId}&quot; is missing from Timing Models —
                  on-time still runs with firmware defaults; speed buckets / strobe will not apply.
                  Pick another model or recreate the deleted one.
                </Text>
              )}
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
              onChange={(cooldownResetMode) =>
                onChange({
                  ...rule,
                  timing: { ...timing, cooldownResetMode },
                })
              }
              disabled={!timing.enabled}
              data={[
                { label: 'onMatch', value: 'onMatch' },
                { label: 'fixed', value: 'fixed' },
              ]}
            />

            <Text size="sm" fw={700} mt="md" mb={4}>
              Wire timing values → segment fields
            </Text>
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
                    onTimingChange={(nextTiming) =>
                      onChange({
                        ...rule,
                        timing: { ...timing, ...nextTiming },
                      })
                    }
                    onChange={(next) => {
                      const extract = [...(rule.extract || [])];
                      extract[i] = next;
                      onChange({ ...rule, extract });
                    }}
                    onDelete={() =>
                      onChange({
                        ...rule,
                        extract: (rule.extract || []).filter((_, j) => j !== i),
                      })
                    }
                  />
                ))}
            </Stack>
            <AppButton
              mt="xs"
              size="compact-sm"
              variant="primary"
              onClick={() =>
                onChange({
                  ...rule,
                  timing: { ...timing, enabled: true },
                  extract: [
                    ...(rule.extract || []),
                    createEmptyTimingParamBinding('timingFlashRate'),
                  ],
                })
              }
            >
              Add timing → param binding
            </AppButton>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Fallback duration"
            summary={
              fallbackDuration.enabled
                ? `on · ${fallbackDuration.onSec ?? 10}s${fallbackDuration.fadeSec ? ` · fade ${fallbackDuration.fadeSec}s` : ''}`
                : 'off'
            }
            headerRight={
              <CopyPasteButtons
                kind={RULE_CLIP.fallbackDuration}
                getData={() => normalizeFallbackDuration(fallbackDuration)}
                onPaste={(data) =>
                  onChange({
                    ...rule,
                    fallbackDuration: normalizeFallbackDuration(data),
                  })
                }
              />
            }
          >
            <Text size="xs" c="dimmed" mb="xs">
              Used when Timing is disabled — lets an unhandled/undecoded opcode still return to
              normal after a fixed duration instead of staying on indefinitely. When Timing is
              enabled, the packet timing byte always wins.
            </Text>
            <Switch
              label="Use fallback duration"
              checked={!!fallbackDuration.enabled}
              onChange={(e) =>
                onChange({
                  ...rule,
                  fallbackDuration: { ...fallbackDuration, enabled: e.target.checked },
                })
              }
              mb="xs"
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <NumberInput
                label="On Duration (sec)"
                size="xs"
                flex={1}
                value={fallbackDuration.onSec ?? 10}
                onChange={(v) =>
                  onChange({
                    ...rule,
                    fallbackDuration: {
                      ...fallbackDuration,
                      onSec: Math.max(0, Number(v) || 0),
                    },
                  })
                }
                min={0}
                step={0.5}
                decimalScale={2}
                disabled={!fallbackDuration.enabled}
              />

              <NumberInput
                label="Fade Duration (sec)"
                size="xs"
                flex={1}
                value={fallbackDuration.fadeSec ?? 0}
                onChange={(v) =>
                  onChange({
                    ...rule,
                    fallbackDuration: {
                      ...fallbackDuration,
                      fadeSec: Math.max(0, Number(v) || 0),
                    },
                  })
                }
                min={0}
                step={0.1}
                decimalScale={2}
                disabled={!fallbackDuration.enabled}
              />

              <NumberInput
                label="Cooldown (sec)"
                size="xs"
                flex={1}
                value={fallbackDuration.cooldownSec ?? ''}
                placeholder="inherit from timing / 2s default"
                onChange={(v) => {
                  const blank = v === '' || v === null || v === undefined;
                  onChange({
                    ...rule,
                    fallbackDuration: {
                      ...fallbackDuration,
                      cooldownSec: blank ? null : Math.max(0, Number(v) || 0),
                    },
                  });
                }}
                min={0}
                step={0.5}
                decimalScale={2}
                disabled={!fallbackDuration.enabled}
              />
            </SimpleGrid>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Start transition"
            summary={`${startTransition.type || 'fade'}${startTransition.type === 'instant' ? '' : ` · ${startTransition.timeMs ?? 400}ms`}`}
            headerRight={
              <CopyPasteButtons
                kind={RULE_CLIP.startTransition}
                getData={() => normalizeStartTransition(startTransition)}
                onPaste={(data) =>
                  onChange({
                    ...rule,
                    startTransition: normalizeStartTransition(data),
                  })
                }
              />
            }
          >
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <SearchableSelect
                label="Type"
                size="xs"
                flex={1}
                value={startTransition.type || 'fade'}
                onChange={(type) =>
                  onChange({
                    ...rule,
                    startTransition: { ...startTransition, type },
                  })
                }
                options={WLED_START_TRANSITIONS.map((t) => ({
                  value: t.value,
                  label: t.label,
                  searchText: `${t.label} ${t.value}`,
                }))}
                allowEmpty={false}
              />

              <NumberInput
                label="Time (ms)"
                size="xs"
                flex={1}
                value={startTransition.timeMs ?? 400}
                onChange={(v) =>
                  onChange({
                    ...rule,
                    startTransition: {
                      ...startTransition,
                      timeMs: Math.max(0, parseInt(String(v), 10) || 0),
                    },
                  })
                }
                min={0}
                disabled={startTransition.type === 'instant'}
              />
            </SimpleGrid>
          </CollapsibleBlock>

          <CollapsibleBlock
            title="Stop transition"
            summary={
              stopTransition.enabled
                ? `${stopTransition.type || 'fade'} · ${stopTransition.durationMode === 'custom' ? `${stopTransition.timeMs ?? 0}ms` : 'timing stretch'}`
                : 'off (plain FTB)'
            }
            headerRight={
              <CopyPasteButtons
                kind={RULE_CLIP.stopTransition}
                getData={() => normalizeStopTransition(stopTransition)}
                onPaste={(data) =>
                  onChange({
                    ...rule,
                    stopTransition: normalizeStopTransition(data),
                  })
                }
              />
            }
          >
            <Text size="xs" c="dimmed" mb="xs">
              How the effect transitions out to fade-to-black. Duration defaults to the timing
              byte&apos;s final-cycle stretch; choose Custom to override.
            </Text>
            <Switch
              label="Use stop transition"
              checked={!!stopTransition.enabled}
              onChange={(e) =>
                onChange({
                  ...rule,
                  stopTransition: { ...stopTransition, enabled: e.target.checked },
                })
              }
              mb="xs"
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <SearchableSelect
                label="Type"
                size="xs"
                flex={1}
                value={stopTransition.type || 'fade'}
                onChange={(type) =>
                  onChange({
                    ...rule,
                    stopTransition: { ...stopTransition, enabled: true, type },
                  })
                }
                options={WLED_START_TRANSITIONS.map((t) => ({
                  value: t.value,
                  label: t.label,
                  searchText: `${t.label} ${t.value}`,
                }))}
                allowEmpty={false}
                disabled={!stopTransition.enabled}
              />
              <Input.Wrapper size="xs" label="Duration">
                <SegmentedControl
                  size="xs"
                  flex={1}
                  fullWidth
                  value={stopTransition.durationMode === 'custom' ? 'custom' : 'timingFade'}
                  onChange={(durationMode) =>
                    onChange({
                      ...rule,
                      stopTransition: {
                        ...stopTransition,
                        enabled: true,
                        durationMode,
                        timeMs:
                          durationMode === 'custom'
                            ? (stopTransition.timeMs ?? 400)
                            : stopTransition.timeMs,
                      },
                    })
                  }
                  data={[
                    { value: 'timingFade', label: 'Timing stretch' },
                    { value: 'custom', label: 'Custom' },
                  ]}
                  disabled={!stopTransition.enabled || stopTransition.type === 'instant'}
                />
              </Input.Wrapper>
            </SimpleGrid>
            {stopTransition.enabled &&
              stopTransition.durationMode === 'custom' &&
              stopTransition.type !== 'instant' && (
                <NumberInput
                  label="Time (MS)"
                  size="xs"
                  flex={1}
                  mt="xs"
                  value={stopTransition.timeMs ?? 400}
                  onChange={(v) =>
                    onChange({
                      ...rule,
                      stopTransition: {
                        ...stopTransition,
                        timeMs: Math.max(0, parseInt(String(v), 10) || 0),
                      },
                    })
                  }
                  min={0}
                />
              )}
          </CollapsibleBlock>

          <ColorSourcesEditor
            sources={rule.colorSources || []}
            onChange={(colorSources) => onChange({ ...rule, colorSources })}
          />

          <CollapsibleBlock
            title="Packet extracts"
            summary={`${(rule.extract || []).filter((ex) => !isTimingDerivedSource(ex.source)).length} extract(s)`}
            headerRight={
              <CopyPasteButtons
                kind={RULE_CLIP.packetExtracts}
                getData={() =>
                  (rule.extract || [])
                    .filter((ex) => !isTimingDerivedSource(ex.source))
                    .map((ex) => normalizeExtract(ex))
                }
                onPaste={(data) => {
                  const pasted = (Array.isArray(data) ? data : [])
                    .map((ex) => normalizeExtract(ex))
                    .filter((ex) => !isTimingDerivedSource(ex.source));
                  const timingOnes = (rule.extract || []).filter((ex) =>
                    isTimingDerivedSource(ex.source),
                  );
                  onChange({ ...rule, extract: [...timingOnes, ...pasted] });
                }}
              />
            }
          >
            <Text size="xs" c="dimmed" mb="xs" lh={1.45}>
              Pull values from packet bytes (palette colors, bit fields). Timing→param bindings live
              under the Timing section above.
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
                    colorSourceOpts={(rule.colorSources || [])
                      .map((s) => (s.name || '').trim())
                      .filter(Boolean)
                      .map((name) => ({ value: name, label: name, searchText: name }))}
                    onChange={(next) => {
                      const extract = [...(rule.extract || [])];
                      extract[i] = next;
                      onChange({ ...rule, extract });
                    }}
                    onDelete={() =>
                      onChange({ ...rule, extract: (rule.extract || []).filter((_, j) => j !== i) })
                    }
                  />
                ))}
            </Stack>
            <AppButton
              size="compact-sm"
              variant="default"
              mt="xs"
              onClick={() =>
                onChange({
                  ...rule,
                  extract: [
                    ...(rule.extract || []),
                    createEmptyExtract(`field${(rule.extract || []).length + 1}`),
                  ],
                })
              }
            >
              Add packet extract
            </AppButton>
          </CollapsibleBlock>
        </Stack>
      )}
    </AppCard>
  );
}

function formatExtractValueLabel(ex) {
  if (!ex) return '';
  if (ex.rgb) {
    const hex = rgbToHex(ex.rgb[0], ex.rgb[1], ex.rgb[2]);
    if (ex.paletteIndex != null) return `pal ${ex.paletteIndex} · ${hex}`;
    if (ex.source === 'timingFlashRate') return `${Number(ex.mapped).toFixed(2)} Hz`;
    if (ex.source === 'timingOnSec' || ex.source === 'timingFadeSec') {
      return `${Number(ex.mapped).toFixed(2)}s`;
    }
    if (typeof ex.mapped === 'number' && ex.mapped !== 0 && !Number.isInteger(ex.mapped)) {
      return `${ex.mapped}`;
    }
    return hex;
  }
  if (ex.paletteIndex != null) return `pal ${ex.paletteIndex}`;
  if (ex.source === 'timingFlashRate') return `${Number(ex.mapped ?? ex.raw).toFixed(2)} Hz`;
  if (ex.source === 'timingOnSec' || ex.source === 'timingFadeSec') {
    return `${Number(ex.mapped ?? ex.raw).toFixed(2)}s`;
  }
  if (ex.mapped != null && ex.mapped !== ex.raw) return `raw ${ex.raw} → ${ex.mapped}`;
  return `raw ${ex.raw}`;
}

function formatPreviewStatus(p) {
  if (!p.matched) return 'no rule';
  if (p.reportedUnmatched) return 'reported unmatched';
  return 'match';
}

function formatPreviewExtractsCell(p) {
  const parts = [];
  for (const cs of p.colorSources || []) {
    const hex = cs.rgb ? rgbToHex(cs.rgb[0], cs.rgb[1], cs.rgb[2]) : '#000000';
    parts.push(`${cs.name || 'color'} ${hex}`);
  }
  for (const ex of p.extracts || []) {
    parts.push(`${ex.name || 'ex'} · ${formatExtractValueLabel(ex)}`);
  }
  return parts.length ? parts.join('; ') : '—';
}

function formatPreviewTimingCell(p) {
  if (!p.timing) return '—';
  let s = `on ${p.timing.onSec.toFixed(1)}s`;
  if (p.timing.stretchSec > 0) s += ` · fade ${p.timing.stretchSec.toFixed(1)}s`;
  if (p.timing.scaler) s += ' · 3×';
  if (p.timing.extended) s += ' · ext';
  return s;
}

function tsvCell(value) {
  return String(value ?? '')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '; ');
}

/** TSV of coverage-preview table columns (no Wand Lab actions). */
function previewRowsToTsv(rows, { debug = false } = {}) {
  const headers = ['#', 'Status', 'Pri', 'Rule', 'Hex (payload)', 'Colors / extracts', 'Timing'];
  if (debug) headers.push('Debug');
  const body = (rows || []).map((p) => {
    const row = [
      String(p.rowIdx + 1),
      formatPreviewStatus(p),
      p.matched && p.priority != null ? String(p.priority) : '—',
      p.matched ? p.ruleName || '(unnamed)' : '—',
      p.hex || '',
      formatPreviewExtractsCell(p),
      formatPreviewTimingCell(p),
    ];
    if (debug) {
      row.push((p.debugLines || []).map((l) => l.summary).join(' | ') || '—');
    }
    return row;
  });
  return [headers, ...body].map((row) => row.map(tsvCell).join('\t')).join('\n');
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (!ok) throw new Error('copy failed');
  }
}

/** Compact color + extract readout for coverage preview rows. */
function PreviewPacketExtracts({ colorSources = [], extracts = [] }) {
  const hasColors = (colorSources || []).length > 0;
  const hasExtracts = (extracts || []).length > 0;
  if (!hasColors && !hasExtracts) {
    return (
      <Text size="xs" c="dimmed">
        —
      </Text>
    );
  }
  return (
    <Stack gap={4}>
      {hasColors && (
        <Group gap={6} wrap="wrap">
          {(colorSources || []).map((cs) => {
            const hex = cs.rgb ? rgbToHex(cs.rgb[0], cs.rgb[1], cs.rgb[2]) : '#000000';
            return (
              <Group key={`cs-${cs.name}`} gap={4} wrap="nowrap">
                <ColorSwatch colors={[hex]} size={12} />
                <Text size="xs" ff="monospace">
                  {cs.name || 'color'} {hex}
                </Text>
              </Group>
            );
          })}
        </Group>
      )}
      {(extracts || []).map((ex, i) => {
        const hex = ex.rgb ? rgbToHex(ex.rgb[0], ex.rgb[1], ex.rgb[2]) : null;
        return (
          <Group key={`ex-${ex.name || i}`} gap={6} wrap="nowrap" align="flex-start">
            {hex ? (
              <Box mt={2}>
                <ColorSwatch colors={[hex]} size={12} />
              </Box>
            ) : (
              <Box w={12} />
            )}
            <Text size="xs" ff="monospace" style={{ flex: 1, lineHeight: 1.35 }}>
              <Text span fw={600}>
                {ex.name || `ex${i}`}
              </Text>
              {' · '}
              {formatExtractValueLabel(ex)}
            </Text>
          </Group>
        );
      })}
    </Stack>
  );
}

function ruleOptionLabel(rule, index) {
  const name = typeof rule?.name === 'string' ? rule.name.trim() : '';
  return name || `Rule ${index + 1}`;
}

function matchingIdsForRow(p) {
  if (Array.isArray(p?.matchingRuleIds) && p.matchingRuleIds.length) return p.matchingRuleIds;
  return p?.ruleId ? [p.ruleId] : [];
}

function LivePreview({ rules, colors, selectedRuleId, segmentMaps, timingModels, simIp = '' }) {
  const navigate = useNavigate();
  const [paste, setPaste] = useState('');
  const [status, setStatus] = useState('');
  const [packets, setPackets] = useState<any[]>([]);
  const [matchMode, setMatchMode] = useState('first'); // first | all | selected
  const [unmatchedOnly, setUnmatchedOnly] = useState(false);
  const [matchedRuleFilter, setMatchedRuleFilter] = useState<string[]>([]);
  const [debugMode, setDebugMode] = useState(false);
  const [debugRuleFilter, setDebugRuleFilter] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState('');
  const [sendingRow, setSendingRow] = useState<any>(null);

  const selectedRule = useMemo(
    () => (rules || []).find((r) => r.id === selectedRuleId) || null,
    [rules, selectedRuleId],
  );

  useEffect(() => {
    const ids = new Set((rules || []).map((r) => r.id).filter(Boolean));
    setMatchedRuleFilter((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
    setDebugRuleFilter((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [rules]);

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
      setCopyStatus('');
      return;
    }
    const results = hexes.map((hex, rowIdx) => {
      const bytes = disneyPayload(hexToBytes(hex));
      const mapFor = (rule) =>
        rule?.segmentMapId
          ? (segmentMaps || []).find((m) => m.id === rule.segmentMapId) || null
          : null;
      const debugLines = explainRulesAgainstPacket(
        bytes,
        matchMode === 'selected' && selectedRule ? [selectedRule] : rules,
        { allRules: matchMode === 'all' },
      );

      if (matchMode === 'selected' && selectedRule) {
        const matched =
          selectedRule.enabled !== false &&
          selectedRule.match &&
          previewPacketAgainstRules(bytes, [selectedRule]).matched;
        const reportedUnmatched = matched && !!selectedRule.reportAsUnmatched;
        const extracts = matched
          ? previewExtracts(bytes, selectedRule.extract || [], colors, mapFor(selectedRule), {
              rule: selectedRule,
              timingModels,
            })
          : [];
        const colorSources = matched
          ? previewColorSourcesList(selectedRule.colorSources || [], bytes, colors)
          : [];
        let timing = null;
        if (matched && selectedRule.timing?.enabled) {
          const tOff = resolveOffsetOrAnchor(bytes, selectedRule.timing, 5);
          if (tOff >= 0 && tOff < bytes.length) {
            timing = computeTimingLifecycle(
              bytes[tOff],
              selectedRule.timing.cooldownSec ?? 2,
              modelFor(selectedRule),
            );
          }
        }
        return {
          rowIdx,
          hex: bytesToHex(bytes),
          matched,
          reportedUnmatched,
          ruleId: matched ? selectedRule.id : null,
          ruleName: matched ? selectedRule.name : null,
          matchingRuleIds: matched && selectedRule.id ? [selectedRule.id] : [],
          priority: matched ? selectedRule.priority : null,
          extracts,
          colorSources,
          timing,
          debugLines,
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
        const extractRule = selectedRule || prev.matchedRule;
        const topRule = prev.matchingRules[0]?.rule;
        return {
          rowIdx,
          hex: prev.hex,
          matched: prev.matchingRules.length > 0,
          reportedUnmatched: prev.matchingRules.length > 0 && !!topRule?.reportAsUnmatched,
          ruleId: topRule?.id || null,
          ruleName: prev.matchingRules.map((m) => m.rule.name).join(', ') || null,
          ruleNames: prev.matchingRules.map((m) => m.rule.name),
          matchingRuleIds: prev.matchingRules.map((m) => m.rule.id).filter(Boolean),
          priority: topRule?.priority ?? null,
          extracts: extractRule
            ? previewExtracts(bytes, extractRule.extract || [], colors, mapFor(extractRule), {
                rule: extractRule,
                timingModels,
              })
            : [],
          colorSources: extractRule
            ? previewColorSourcesList(extractRule.colorSources || [], bytes, colors)
            : [],
          timing: prev.timing,
          debugLines,
        };
      }
      const first = findMatchingRule(bytes, rules);
      const reportedUnmatched = !!first && !!first.reportAsUnmatched;
      const extracts = first
        ? previewExtracts(bytes, first.extract || [], colors, mapFor(first), {
            rule: first,
            timingModels,
          })
        : [];
      const colorSources = first
        ? previewColorSourcesList(first.colorSources || [], bytes, colors)
        : [];
      let timing = null;
      if (first?.timing?.enabled) {
        const tOff = resolveOffsetOrAnchor(bytes, first.timing, 5);
        if (tOff >= 0 && tOff < bytes.length) {
          timing = computeTimingLifecycle(
            bytes[tOff],
            first.timing.cooldownSec ?? 2,
            modelFor(first),
          );
        }
      }
      return {
        rowIdx,
        hex: bytesToHex(bytes),
        matched: !!first,
        reportedUnmatched,
        ruleId: first?.id || null,
        ruleName: first?.name || null,
        matchingRuleIds: first?.id ? [first.id] : [],
        priority: first?.priority ?? null,
        extracts,
        colorSources,
        timing,
        debugLines,
      };
    });
    setPackets(results);
    setCopyStatus('');
    const hits = results.filter((r) => r.matched && !r.reportedUnmatched).length;
    const reported = results.filter((r) => r.reportedUnmatched).length;
    const misses = results.length - hits - reported;
    setStatus(
      `${results.length} packet${results.length === 1 ? '' : 's'} — ${hits} matched, ` +
        `${reported} reported unmatched, ${misses} unmatched`,
    );
  };

  const unmatchedPackets = useMemo(
    () => packets.filter((p) => !p.matched || p.reportedUnmatched),
    [packets],
  );

  const ruleFilterOptions = useMemo(
    () =>
      (rules || [])
        .map((r, i) => ({
          value: r.id,
          label: ruleOptionLabel(r, i),
        }))
        .filter((o) => o.value),
    [rules],
  );

  const matchedRuleOptions = useMemo(() => {
    const counts = new Map();
    for (const p of packets) {
      for (const id of matchingIdsForRow(p)) {
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    return ruleFilterOptions.map((o) => ({
      value: o.value,
      label: `${o.label} (${counts.get(o.value) || 0})`,
    }));
  }, [packets, ruleFilterOptions]);

  const visiblePackets = useMemo(() => {
    let rows = unmatchedOnly ? unmatchedPackets : packets;
    if (matchedRuleFilter.length) {
      const want = new Set(matchedRuleFilter);
      rows = rows.filter((p) => matchingIdsForRow(p).some((id) => want.has(id)));
    }
    return rows;
  }, [packets, unmatchedPackets, unmatchedOnly, matchedRuleFilter]);

  const tablePackets = useMemo(() => {
    if (!debugMode || !debugRuleFilter.length) return visiblePackets;
    const want = new Set(debugRuleFilter);
    const subset = (rules || []).filter((r) => want.has(r.id));
    return visiblePackets.map((p) => {
      const bytes = disneyPayload(hexToBytes(p.hex));
      const debugLines = subset.flatMap((rule) =>
        explainRulesAgainstPacket(bytes, [rule], { allRules: true, onlyRuleId: rule.id }),
      );
      return { ...p, debugLines };
    });
  }, [visiblePackets, debugMode, debugRuleFilter, rules]);

  const copyUnmatched = async ({ unique = false } = {}) => {
    if (!unmatchedPackets.length) {
      setCopyStatus('No unmatched codes to copy');
      return;
    }
    let hexes = unmatchedPackets.map((p) => p.hex);
    if (unique) hexes = [...new Set(hexes)];
    try {
      await copyTextToClipboard(hexes.join('\n'));
      setCopyStatus(
        unique
          ? `Copied ${hexes.length} unique unmatched hex`
          : `Copied ${hexes.length} unmatched hex`,
      );
    } catch {
      setCopyStatus('Clipboard copy failed');
    }
  };

  const copyPreviewTable = async () => {
    if (!tablePackets.length) {
      setCopyStatus('No preview rows to copy');
      return;
    }
    try {
      await copyTextToClipboard(previewRowsToTsv(tablePackets, { debug: debugMode }));
      setCopyStatus(
        `Copied ${tablePackets.length} preview row${tablePackets.length === 1 ? '' : 's'} as TSV`,
      );
    } catch {
      setCopyStatus('Clipboard copy failed');
    }
  };

  const sendPacketToWandLab = async (p) => {
    const ip = (simIp || '').trim();
    if (!ip) {
      setCopyStatus('Set Wand Lab simulator IP first (Wand Lab tab)');
      return;
    }
    const payload = hexToBytes(p.hex);
    if (!payload.length) {
      setCopyStatus('Empty payload');
      return;
    }
    setSendingRow(p.rowIdx);
    setCopyStatus('');
    try {
      await sendHex(ip, payload);
      setCopyStatus(`Sent row ${p.rowIdx + 1} (${payload.length} bytes) → ${ip}`);
    } catch (e) {
      setCopyStatus(e.message || 'Send failed — is WandSim on WiFi?');
    } finally {
      setSendingRow(null);
    }
  };

  const openPacketInWandLab = (p) => {
    navigate('/wandlab/bytes', {
      state: {
        loadHex: p.hex,
        presetKey: 'rule-preview',
      },
    });
  };

  return (
    <AppCard p="sm">
      <SectionHead>Rule coverage preview</SectionHead>
      <Text size="xs" c="dimmed" mb="xs" lh={1.45}>
        Paste a list of hex / capture rows (8301 stripped automatically). Preview which rule each
        packet would hit under the current rule set, and copy any that have no match. After Preview,
        filter rows to packets that matched specific rule(s), and with Debug on, limit the debug
        column to selected rule(s).
        {!simIp?.trim() && <> Simulator IP is empty — set it on the Wand Lab tab to enable Send.</>}
      </Text>

      <Stack gap="xs">
        <Textarea
          minRows={4}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={
            'E100E90500090EE5B0\n8301e100e90e00010fbda0…\nor paste Illuma / Sheets capture rows'
          }
          styles={{ input: { fontFamily: 'monospace', fontSize: 11 } }}
        />
        <Group gap="xs" wrap="wrap">
          <AppButton size="xs" variant="primary" onClick={runPreview}>
            Preview
          </AppButton>
          <SearchableSelect
            value={matchMode}
            onChange={setMatchMode}
            allowEmpty={false}
            size="xs"
            options={[
              { value: 'first', label: 'First match (priority)' },
              { value: 'all', label: 'All matching rules' },
              { value: 'selected', label: 'Selected rule only' },
            ]}
          />
          <Checkbox
            size="xs"
            label="Unmatched only"
            checked={unmatchedOnly}
            disabled={!packets.length}
            onChange={(e) => setUnmatchedOnly(e.currentTarget.checked)}
          />
          <MultiSelect
            size="xs"
            searchable
            clearable
            placeholder="Matched rule(s)…"
            data={matchedRuleOptions}
            value={matchedRuleFilter}
            onChange={setMatchedRuleFilter}
            disabled={!packets.length}
            miw={220}
            maw={340}
            title="Show only packets that matched these rules (OR). In First match mode this is the winning rule; use All matching rules to include lower-priority hits."
            comboboxProps={{ withinPortal: true, zIndex: 1100 }}
            nothingFoundMessage="No rules"
          />
          <Checkbox
            size="xs"
            label="Debug"
            checked={debugMode}
            onChange={(e) => setDebugMode(e.currentTarget.checked)}
          />
          {debugMode && (
            <MultiSelect
              size="xs"
              searchable
              clearable
              placeholder="Debug rule(s)…"
              data={ruleFilterOptions}
              value={debugRuleFilter}
              onChange={setDebugRuleFilter}
              disabled={!packets.length}
              miw={220}
              maw={340}
              title="Limit the Debug column to these rules. Shows pass/fail even if another rule won first."
              comboboxProps={{ withinPortal: true, zIndex: 1100 }}
              nothingFoundMessage="No rules"
            />
          )}
          <AppButton
            size="xs"
            variant="default"
            disabled={!unmatchedPackets.length}
            onClick={() => copyUnmatched({ unique: false })}
          >
            Copy unmatched ({unmatchedPackets.length})
          </AppButton>
          <AppButton
            size="xs"
            variant="default"
            disabled={!unmatchedPackets.length}
            onClick={() => copyUnmatched({ unique: true })}
          >
            Copy unique unmatched
          </AppButton>
          <AppButton
            size="xs"
            variant="default"
            disabled={!tablePackets.length}
            onClick={copyPreviewTable}
          >
            Copy table
          </AppButton>
        </Group>

        <Divider size="md" />

        {status && (
          <Text size="xs" c="dimmed" mt="xs">
            {status}
            {(unmatchedOnly || matchedRuleFilter.length) && packets.length > 0
              ? ` — showing ${visiblePackets.length}`
              : ''}
          </Text>
        )}
        {copyStatus && (
          <Text size="xs" c="teal">
            {copyStatus}
          </Text>
        )}

        {packets.length > 0 && (
          <Table.ScrollContainer minWidth={980}>
            <Table striped highlightOnHover withTableBorder withColumnBorders fz="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={40}>#</Table.Th>
                  <Table.Th w={130}>Status</Table.Th>
                  <Table.Th w={70}>Pri</Table.Th>
                  <Table.Th>Rule</Table.Th>
                  <Table.Th>Hex (payload)</Table.Th>
                  <Table.Th miw={220}>Colors / extracts</Table.Th>
                  <Table.Th w={160}>Timing</Table.Th>
                  {debugMode && <Table.Th miw={280}>Debug</Table.Th>}
                  <Table.Th w={150}>Wand Lab</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {tablePackets.map((p) => (
                  <Table.Tr
                    key={p.rowIdx}
                    style={
                      !p.matched || p.reportedUnmatched
                        ? {
                            background:
                              'color-mix(in srgb, var(--mantine-color-orange-filled) 10%, transparent)',
                          }
                        : undefined
                    }
                  >
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {p.rowIdx + 1}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={!p.matched ? 'orange' : p.reportedUnmatched ? 'yellow' : 'green'}
                      >
                        {!p.matched
                          ? 'no rule'
                          : p.reportedUnmatched
                            ? 'reported unmatched'
                            : 'match'}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" c="dimmed">
                        {p.matched && p.priority != null ? p.priority : '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {p.matched ? (
                        <Text size="xs" fw={600}>
                          {p.ruleName || '(unnamed)'}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {p.hex}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <PreviewPacketExtracts colorSources={p.colorSources} extracts={p.extracts} />
                    </Table.Td>
                    <Table.Td>
                      {p.timing ? (
                        <Text size="xs" c="dimmed" ff="monospace">
                          on {p.timing.onSec.toFixed(1)}s
                          {p.timing.stretchSec > 0
                            ? ` · fade ${p.timing.stretchSec.toFixed(1)}s`
                            : ''}
                          {p.timing.scaler ? ' · 3×' : ''}
                          {p.timing.extended ? ' · ext' : ''}
                        </Text>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    {debugMode && (
                      <Table.Td>
                        {(p.debugLines || []).length ? (
                          <Stack gap={2}>
                            {p.debugLines.map((line, i) => (
                              <Text
                                key={`${p.rowIdx}-dbg-${i}`}
                                size="xs"
                                ff="monospace"
                                c={line.ok ? 'teal' : 'orange'}
                                style={{ lineHeight: 1.35 }}
                              >
                                {line.summary}
                              </Text>
                            ))}
                          </Stack>
                        ) : (
                          <Text size="xs" c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <AppButton
                          size="compact-xs"
                          variant="primary"
                          disabled={!simIp?.trim() || sendingRow != null}
                          loading={sendingRow === p.rowIdx}
                          onClick={() => sendPacketToWandLab(p)}
                          title={
                            simIp?.trim()
                              ? `Send to ${simIp.trim()}`
                              : 'Set simulator IP on Wand Lab first'
                          }
                        >
                          Send
                        </AppButton>
                        <AppButton
                          size="compact-xs"
                          variant="default"
                          onClick={() => openPacketInWandLab(p)}
                          title="Open Wand Lab Bytes tab with this packet"
                        >
                          Edit
                        </AppButton>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {tablePackets.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={debugMode ? 9 : 8}>
                      <Text size="xs" c="dimmed">
                        {matchedRuleFilter.length && unmatchedOnly
                          ? 'No unmatched packets among the selected rule(s).'
                          : matchedRuleFilter.length
                            ? 'No packets match the selected rule(s).'
                            : unmatchedOnly
                              ? 'No unmatched packets in this paste.'
                              : 'No packets to show.'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </AppCard>
  );
}

export function RuleEditor({
  mb,
  presets = [],
  effectOptions = [],
  paletteOptions = [],
  onChange,
  onEditMaps,
  onEditTimingModels,
  simIp = '',
}) {
  const mapping = useMemo(() => normalizeMbMapping(mb), [mb]);
  const rules = mapping.rules || [];
  const segmentMaps = mapping.segmentMaps || [];
  const timingModels = mapping.timingModels || [];
  const [expandedId, setExpandedId] = useState(rules[0]?.id || null);
  const [reorderOpen, setReorderOpen] = useState(false);

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
            children: [createEmptyCondition('hexPrefix')],
          },
        ],
      },
    });
    rule.match.children[0].children[0].value = 'E100E90C';
    setRules([...rules, rule]);
    setExpandedId(rule.id);
  };

  return (
    <RuleClipProvider>
      <Stack gap="md">
        <LivePreview
          rules={rules}
          colors={mapping.colors}
          selectedRuleId={expandedId}
          segmentMaps={segmentMaps}
          timingModels={timingModels}
          simIp={simIp}
        />

        <Group justify="space-between">
          <Group gap="xs">
            <AppButton size="compact-sm" variant="primary" onClick={addRule}>
              Add rule
            </AppButton>
            <AppButton size="compact-sm" variant="default" onClick={() => setReorderOpen(true)}>
              Reorder / bulk priority
            </AppButton>
            <Text size="xs" c="dimmed">
              {rules.length} rule{rules.length === 1 ? '' : 's'}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            Ordered rules evaluated on the board (lower priority first). Push with{' '}
            <strong>📡 Board</strong> (<code style={{ fontFamily: 'monospace' }}>set_mb_rules</code>
            ).
          </Text>
        </Group>

        {rules.length === 0 && (
          <Paper p="sm" withBorder>
            <Text size="sm" c="dimmed">
              No rules yet. Add one, or unmatched packets use the default preset.
            </Text>
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
              setRules(
                rules.filter((r) => r.id !== rule.id),
                { reindex: true },
              );
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

        {reorderOpen && (
          <RulePriorityDrawer
            rules={rules}
            onChange={(next) => {
              setRules(next);
            }}
            onClose={() => setReorderOpen(false)}
          />
        )}
      </Stack>
    </RuleClipProvider>
  );
}
