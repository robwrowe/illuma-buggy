import { useMemo, useRef, useState } from 'react';
import { Box, Button, Group, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { SearchableSelect } from '../shared/SearchableSelect';
import {
  TIMING_BYTE_BIT_PRESET,
  bitGroupsOverlap,
  bitPatternToParamDetail,
  decodeBitGroupValue,
  encodeBitGroupValue,
} from '../../lib/ble/byteAnalyzer';
import { byteToBitString, payloadToShowHex } from '../../lib/ble/wandSimClient';
import { observe } from '../../lib/ble/waveClassifierClient';
import { useWaveClassifierBackend } from '../../lib/ble/useWaveClassifierBackend';
import { WaveClassifierObserveResults } from './WaveClassifierObserveResults';

const BIT_ORDER = [7, 6, 5, 4, 3, 2, 1, 0];
const GROUP_COLORS = ['cyan', 'lime', 'pink', 'indigo', 'red', 'violet', 'grape', 'teal'];

function groupColor(i) {
  return GROUP_COLORS[i % GROUP_COLORS.length];
}

function rangeLabel(bitStart, bitCount) {
  if (bitCount <= 0) return '—';
  if (bitCount === 1) return `b${bitStart}`;
  return `b${bitStart + bitCount - 1}:${bitStart}`;
}

function bitsToBinary(value, bitCount) {
  return (Number(value) >>> 0).toString(2).padStart(Math.max(1, bitCount), '0');
}

function groupForBit(groups, bitIdx) {
  return groups.findIndex((g) => {
    const start = Number(g.bitStart) || 0;
    const count = Number(g.bitCount) || 0;
    return bitIdx >= start && bitIdx < start + count;
  });
}

/**
 * Interactive 8-bit grid with named contiguous groups.
 * @param {{ byteValue: number, groups: object[], onGroupsChange: function, showTimingPreset?: boolean, patterns?: object[], onPatternsChange?: function }} props
 */
export function BitGridEditor({
  byteValue,
  groups = [],
  onGroupsChange,
  showTimingPreset = true,
  patterns = [],
  onPatternsChange,
  payloadBytes = null,
  byteIndex = null,
  tailIndex = null,
}) {
  const value = Number(byteValue) & 0xff;
  const bitStr = byteToBitString(value);
  const [drag, setDrag] = useState<any>(null); // { start, end } bit indices (0-7, not display order)
  const [nameDraft, setNameDraft] = useState('');
  const [error, setError] = useState('');
  const [patternId, setPatternId] = useState(patterns[0]?.id || '');
  const [saveName, setSaveName] = useState('');
  const dragging = useRef(false);
  const wc = useWaveClassifierBackend();
  const [observing, setObserving] = useState(false);
  const [observeReports, setObserveReports] = useState([]);
  const [observeReportCsv, setObserveReportCsv] = useState('');

  const selected = useMemo(() => {
    if (!drag) return null;
    const lo = Math.min(drag.start, drag.end);
    const hi = Math.max(drag.start, drag.end);
    return { bitStart: lo, bitCount: hi - lo + 1 };
  }, [drag]);

  const beginDrag = (bitIdx, shift) => {
    setError('');
    if (shift && drag) {
      setDrag((d) => ({ start: d.start, end: bitIdx }));
      return;
    }
    dragging.current = true;
    setDrag({ start: bitIdx, end: bitIdx });
  };

  const extendDrag = (bitIdx) => {
    if (!dragging.current) return;
    setDrag((d) => (d ? { ...d, end: bitIdx } : d));
  };

  const endDrag = () => {
    dragging.current = false;
  };

  const addGroup = () => {
    if (!selected || selected.bitCount <= 0) {
      setError('Select a contiguous bit range first');
      return;
    }
    if (bitGroupsOverlap(groups, selected)) {
      setError('Range overlaps an existing group — a bit can only belong to one group');
      return;
    }
    const name = nameDraft.trim() || `bits${selected.bitStart}`;
    onGroupsChange?.([...groups, { ...selected, name }]);
    setNameDraft('');
    setError('');
    setDrag(null);
  };

  const removeGroup = (idx) => {
    onGroupsChange?.(groups.filter((_, i) => i !== idx));
  };

  const applyTiming = () => {
    onGroupsChange?.(TIMING_BYTE_BIT_PRESET.map((g) => ({ ...g })));
    setError('');
  };

  const applyPattern = () => {
    const pat = patterns.find((p) => p.id === patternId);
    if (!pat) {
      setError('Pick a saved pattern first');
      return;
    }
    onGroupsChange?.(bitPatternToParamDetail(pat).groups);
    setError('');
  };

  const savePattern = () => {
    const name = saveName.trim();
    if (!name) {
      setError('Name the pattern before saving');
      return;
    }
    if (!groups.length) {
      setError('Define at least one group before saving');
      return;
    }
    const next = [
      ...patterns,
      { id: `pat-${Date.now()}`, name, groups: groups.map((g) => ({ ...g })) },
    ];
    onPatternsChange?.(next);
    setSaveName('');
    setPatternId(next[next.length - 1].id);
    setError('');
  };

  const sweepGroup = groups.length === 1 ? groups[0] : null;
  const sweepValueCount = sweepGroup ? (1 << (Number(sweepGroup.bitCount) || 1)) : 0;
  const canSweep = !!(
    sweepGroup
    && sweepValueCount <= 10
    && Array.isArray(payloadBytes)
    && payloadBytes.length
    && Number.isInteger(byteIndex)
    && byteIndex >= 0
    && byteIndex < payloadBytes.length
  );
  const sweepDisabledReason = !wc.available
    ? wc.disabledTip
    : groups.length !== 1
      ? 'Select a single bit-group to sweep'
      : sweepValueCount > 10
        ? `This group has ${sweepValueCount} values — use the CLI build-batch path for large sweeps`
        : !canSweep
          ? 'No full payload is loaded for this byte — open a capture row cell'
          : '';

  const handleSweepObserve = async () => {
    if (!canSweep || !wc.available || !sweepGroup) return;
    const bitCount = Number(sweepGroup.bitCount) || 1;
    const max = (1 << bitCount) - 1;
    const payloads = [];
    for (let v = 0; v <= max; v++) {
      const next = [...payloadBytes];
      next[byteIndex] = encodeBitGroupValue(next[byteIndex], sweepGroup.bitStart, bitCount, v);
      payloads.push({
        hex_full: payloadToShowHex(next).toUpperCase(),
        label: `0x${v.toString(16).padStart(2, '0')}`,
        tail_index: tailIndex,
      });
    }
    setObserving(true);
    try {
      const res = await observe(wc.baseUrl, { payloads, hold_ms: 4000 });
      const reports = (res?.reports || []).map((r, i) => ({
        ...r,
        sweep_value: payloads[i]?.label,
        effect_label: payloads[i]?.label,
      }));
      setObserveReports(reports);
      setObserveReportCsv(res?.report_csv || '');
    } catch (e) {
      setError(e.message || 'Sweep observe failed');
    } finally {
      setObserving(false);
    }
  };

  const patternOpts = patterns.map((p) => ({
    value: p.id,
    label: p.name || p.id,
    searchText: p.name || p.id,
  }));

  return (
    <Stack gap={6} onMouseLeave={endDrag} onMouseUp={endDrag}>
      <Box
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, 1fr)',
          gap: 2,
          userSelect: 'none',
        }}
      >
        {BIT_ORDER.map((bitIdx) => (
          <Text key={`l${bitIdx}`} size="xs" ta="center" c="dimmed" ff="monospace">
            b{bitIdx}
          </Text>
        ))}
        {BIT_ORDER.map((bitIdx) => {
          const gi = groupForBit(groups, bitIdx);
          const inSel = selected
            && bitIdx >= selected.bitStart
            && bitIdx < selected.bitStart + selected.bitCount;
          const color = gi >= 0 ? groupColor(gi) : null;
          const bitVal = bitStr[7 - bitIdx];
          return (
            <Box
              key={`b${bitIdx}`}
              onMouseDown={(e) => beginDrag(bitIdx, e.shiftKey)}
              onMouseEnter={() => extendDrag(bitIdx)}
              style={{
                textAlign: 'center',
                fontSize: 12,
                fontFamily: 'monospace',
                padding: '6px 0',
                borderRadius: 4,
                cursor: 'pointer',
                opacity: gi < 0 && !inSel ? 0.45 : 1,
                background: inSel
                  ? 'var(--mantine-color-pink-light)'
                  : color
                    ? `var(--mantine-color-${color}-light)`
                    : 'var(--surface2)',
                border: inSel
                  ? '2px solid var(--mantine-color-pink-6)'
                  : '1px solid var(--border)',
              }}
            >
              {bitVal}
            </Box>
          );
        })}
        {BIT_ORDER.map((bitIdx) => {
          const gi = groupForBit(groups, bitIdx);
          const g = gi >= 0 ? groups[gi] : null;
          const isStart = g && bitIdx === (Number(g.bitStart) || 0) + (Number(g.bitCount) || 0) - 1;
          return (
            <Text
              key={`n${bitIdx}`}
              size="xs"
              ta="center"
              ff="monospace"
              c={gi >= 0 ? groupColor(gi) : 'dimmed'}
              style={{ fontSize: 8, minHeight: 12 }}
            >
              {isStart ? (g.name || '·') : gi >= 0 ? '' : ''}
            </Text>
          );
        })}
      </Box>

      <Group gap={6} align="flex-end" wrap="wrap">
        <TextInput
          size="xs"
          label="Group name"
          placeholder={selected ? rangeLabel(selected.bitStart, selected.bitCount) : 'select bits'}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addGroup();
            }
          }}
          style={{ flex: 1, minWidth: 120 }}
        />
        <Button size="compact-xs" onClick={addGroup} disabled={!selected}>
          Add group
        </Button>
        {showTimingPreset && (
          <Button size="compact-xs" variant="light" onClick={applyTiming}>
            Timing byte
          </Button>
        )}
      </Group>

      {groups.map((g, i) => {
        const decoded = decodeBitGroupValue(value, g.bitStart, g.bitCount);
        return (
          <Group key={`${g.name}-${g.bitStart}-${i}`} gap={6} wrap="nowrap">
            <Box
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: `var(--mantine-color-${groupColor(i)}-6)`,
                flexShrink: 0,
              }}
            />
            <Text size="xs" ff="monospace" style={{ flex: 1 }}>
              {g.name || '(unnamed)'} ({rangeLabel(g.bitStart, g.bitCount)}) = 0b
              {bitsToBinary(decoded, g.bitCount)} = {decoded}
            </Text>
            <Button size="compact-xs" variant="subtle" color="red" onClick={() => removeGroup(i)}>
              ✕
            </Button>
          </Group>
        );
      })}

      {!!patterns && onPatternsChange && (
        <Stack gap={4}>
          <Group gap={6} align="flex-end" wrap="wrap">
            <Box style={{ flex: 1, minWidth: 140 }}>
              <SearchableSelect
                size="xs"
                value={patternId}
                allowEmpty={false}
                onChange={setPatternId}
                options={patternOpts}
                placeholder="Saved pattern"
              />
            </Box>
            <Button size="compact-xs" variant="light" onClick={applyPattern} disabled={!patternId}>
              Apply
            </Button>
          </Group>
          <Group gap={6} align="flex-end" wrap="wrap">
            <TextInput
              size="xs"
              placeholder="Save current as…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              style={{ flex: 1, minWidth: 120 }}
            />
            <Button size="compact-xs" variant="default" onClick={savePattern}>
              Save as pattern
            </Button>
          </Group>
        </Stack>
      )}

      {error ? (
        <Text size="xs" c="red">
          {error}
        </Text>
      ) : (
        <Text size="xs" c="dimmed">
          Drag (or shift-click) adjacent bits, name them, then Add group. Ungrouped bits stay dim.
        </Text>
      )}
      <Tooltip label={sweepDisabledReason || 'Sweep this group through every value and observe'}>
        <Button
          size="compact-xs"
          variant="light"
          color="violet"
          loading={observing}
          disabled={!wc.available || !canSweep || observing}
          onClick={() => void handleSweepObserve()}
        >
          Sweep this group & Observe
        </Button>
      </Tooltip>
      {(observing || observeReports.length > 0) && (
        <WaveClassifierObserveResults reports={observeReports} reportCsv={observeReportCsv} />
      )}
    </Stack>
  );
}
