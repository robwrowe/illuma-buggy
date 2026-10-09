import { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from '@mantine/core';
import { hexToRgb } from '../../lib/utils';
import { DEFAULT_MB_WLED_COLORS, MB_COLOR_NAMES, MB_PALETTE } from '../../lib/ble/mbConstants';
import { payloadToShowHex } from '../../lib/ble/wandSimClient';
import { useWandLabUiRead, useWandLabUiState } from '../../lib/ble/wandLabUiState';
import {
  observe,
  wandsimUrlFromIp,
  DEFAULT_OBSERVE_HOLD_MS,
} from '../../lib/ble/waveClassifierClient';
import { useWaveClassifierBackend } from '../../lib/ble/useWaveClassifierBackend';
import { assembleTailPayload } from '../../lib/ble/tailBuilder';
import {
  MAX_FUZZ_TAIL_BYTES,
  clampFuzzLen,
  randomTailBatch,
  randomTailBytes,
  tailEntryFromBytes,
} from '../../lib/ble/tailFuzzer';
import { WaveClassifierObserveResults } from './WaveClassifierObserveResults';

function defaultColors(n) {
  return Array.from({ length: n }, () => ({
    kind: 'palette',
    paletteIdx: 0,
    mask: 0,
    r: 0,
    g: 0,
    b: 0,
  }));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtHexByte(n) {
  return `0x${(Number(n) & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;
}

function vibLabel(vibration) {
  if (vibration == null) return 'none';
  return `0x${(Number(vibration) & 0x0f).toString(16).toUpperCase()}`;
}

function envLabel(envelope) {
  return String(envelope ?? 'e1').replace(/^0x/i, '').toUpperCase() || 'E1';
}

export function WandLabFuzzTab({
  simIp,
  onStatus,
  onSendPacket,
  onLoadToByteEditor = undefined,
  onSendToAnalyzer,
  onLogTail,
  onGoToTailBuilder = undefined,
}) {
  const timingByte = useWandLabUiRead('tail.timingByte', 0x0f);
  const colorFormat = useWandLabUiRead('tail.colorFormat', '0f');
  const colorCount = useWandLabUiRead('tail.colorCount', 2);
  const maskFollowsColorCount = useWandLabUiRead('tail.maskFollowsColorCount', true);
  const colors = useWandLabUiRead('tail.colors', () => defaultColors(2));
  const vibration = useWandLabUiRead('tail.vibration', null);
  const envelope = useWandLabUiRead('tail.envelope', 'e1');

  const [minLen, setMinLen] = useWandLabUiState('fuzz.minLen', 4);
  const [maxLen, setMaxLen] = useWandLabUiState('fuzz.maxLen', 12);
  const [count, setCount] = useWandLabUiState('fuzz.count', 10);
  const [avoidVibNibble, setAvoidVibNibble] = useWandLabUiState('fuzz.avoidVibNibble', true);
  const [generated, setGenerated] = useWandLabUiState('fuzz.generated', () => []);
  const [selectedIdx, setSelectedIdx] = useWandLabUiState('fuzz.selectedIdx', 0);
  const [sendWaitMs, setSendWaitMs] = useWandLabUiState('fuzz.sendWaitMs', 1000);
  const [observeHoldMs, setObserveHoldMs] = useWandLabUiState(
    'fuzz.observeHoldMs',
    DEFAULT_OBSERVE_HOLD_MS,
  );

  const [sendingAll, setSendingAll] = useState(false);
  const sendAllGen = useRef(0);
  const wc = useWaveClassifierBackend();
  const [observing, setObserving] = useState(false);
  const [observeReports, setObserveReports] = useState([]);
  const [observeReportCsv, setObserveReportCsv] = useState('');
  const [observeReportMd, setObserveReportMd] = useState('');
  const [observeReportJson, setObserveReportJson] = useState('');
  const [observeError, setObserveError] = useState('');

  const isRgb = colorFormat === 'd2';
  const colorList = Array.isArray(colors) ? colors : [];
  const activeColors = colorList.slice(0, Math.max(0, Number(colorCount) || 0));
  const colorsForPacket = useMemo(() => {
    if (!maskFollowsColorCount) return activeColors;
    const mask = Math.max(0, Math.min(7, Number(colorCount) || 0));
    return activeColors.map((c) => ({ ...c, mask }));
  }, [activeColors, maskFollowsColorCount, colorCount]);

  const rows = Array.isArray(generated) ? generated : [];
  const safeIdx = rows.length ? Math.min(Math.max(0, selectedIdx), rows.length - 1) : 0;
  const minLenRef = useRef(minLen);
  const maxLenRef = useRef(maxLen);
  minLenRef.current = minLen;
  maxLenRef.current = maxLen;

  const fuzzOpts = {
    minLen,
    maxLen,
    count,
    avoidVibNibble,
  };

  const assembleForTail = (bytes) =>
    assembleTailPayload({
      timingByte,
      colorFormat,
      colors: colorsForPacket,
      tailBytes: bytes,
      vibration,
      envelope,
    });

  // TODO: dedupe with WandLabTailBuilderTab
  const sendAssembled = async (bytes, label = '') => {
    if (!bytes?.length) return false;
    const ok = await onSendPacket?.(bytes);
    if (ok && label) onStatus?.(label);
    return ok;
  };

  const hexFullForBytes = (bytes) => payloadToShowHex(bytes || []).toUpperCase();

  // TODO: dedupe with WandLabTailBuilderTab
  const expectedColorsForPacket = () =>
    colorsForPacket.map((c) => {
      if (isRgb) {
        return { r: c.r ?? 0, g: c.g ?? 0, b: c.b ?? 0, name: 'rgb' };
      }
      const palIdx = c.paletteIdx ?? c.palette_idx ?? 0;
      const hex = DEFAULT_MB_WLED_COLORS[palIdx] || '#000000';
      const rgb = hexToRgb(hex.startsWith('#') ? hex : `#${hex}`);
      const pal = MB_PALETTE[palIdx];
      return {
        r: rgb.r,
        g: rgb.g,
        b: rgb.b,
        name: pal?.color || MB_COLOR_NAMES[palIdx] || '',
        palette_idx: palIdx,
      };
    });

  const runObserve = async (payloads, statusPrefix) => {
    setObserveError('');
    const wandsim = wandsimUrlFromIp(simIp);
    if (!wandsim) {
      const msg = 'Set Simulator IP first — Observe drives the same board as Send';
      setObserveError(msg);
      onStatus?.(msg);
      return;
    }
    let ready = wc.available;
    if (!ready) {
      ready = await wc.refresh();
    }
    if (!ready) {
      setObserveError(wc.disabledTip);
      onStatus?.(wc.disabledTip);
      return;
    }
    if (!payloads.length) {
      setObserveError('Nothing to observe');
      onStatus?.('Nothing to observe');
      return;
    }
    setObserving(true);
    onStatus?.(`${statusPrefix} (${payloads.length})…`);
    try {
      const hold = Math.max(500, Number(observeHoldMs) || DEFAULT_OBSERVE_HOLD_MS);
      const nColors = colorsForPacket.length;
      const expected = expectedColorsForPacket();
      const withColors = payloads.map((p) => ({
        ...p,
        color_count: p.color_count != null ? p.color_count : nColors,
        expected_colors: p.expected_colors || expected,
      }));
      const res = await observe(wc.baseUrl, {
        payloads: withColors,
        hold_ms: hold,
        zone_layout: 'auto',
        base_url: wandsim,
        onChunk: (i, n) => {
          if (n > 1) onStatus?.(`${statusPrefix} batch ${i + 1}/${n}…`);
        },
      });
      const reports = (res?.reports || []).map((r, i) => ({
        ...r,
        effect_label: r.effect_label || payloads[i]?.label || `#${i + 1}`,
      }));
      setObserveReports(reports);
      setObserveReportCsv(res?.report_csv || '');
      setObserveReportMd(res?.report_md || '');
      setObserveReportJson(res?.report_json || '');
      const fileNote = res?.report_md
        ? ` → ${res.report_md}`
        : res?.report_csv
          ? ` → ${res.report_csv}`
          : '';
      const layoutNote = res?.capture_layout
        ? ` · captured as ${res.capture_layout}${res.capture_layout_auto ? ' (auto)' : ''}`
        : '';
      onStatus?.(
        `${statusPrefix} done — ${reports.length} result${reports.length === 1 ? '' : 's'}${fileNote}${layoutNote}`,
      );
    } catch (e) {
      const msg = e.message || 'Observe failed';
      setObserveError(msg);
      onStatus?.(msg);
    } finally {
      setObserving(false);
    }
  };

  const handleRoll = () => {
    syncLenBounds();
    const batch = randomTailBatch({
      minLen: minLenRef.current,
      maxLen: maxLenRef.current,
      count,
      avoidVibNibble,
    }).map(tailEntryFromBytes);
    setGenerated(batch);
    setSelectedIdx(0);
    onStatus?.(
      batch.length === 1 ? 'Rolled 1 random tail' : `Rolled ${batch.length} random tails`,
    );
  };

  const handleRerollOne = () => {
    if (!rows[safeIdx]) return;
    const next = rows.map((row, i) =>
      i === safeIdx ? tailEntryFromBytes(randomTailBytes(fuzzOpts)) : row,
    );
    setGenerated(next);
    onStatus?.(`Rerolled fuzz tail ${safeIdx + 1}/${next.length}`);
  };

  const handleSendRow = async (idx) => {
    const tail = rows[idx];
    if (!tail) return;
    setSelectedIdx(idx);
    const pkt = assembleForTail(tail.bytes);
    await sendAssembled(pkt.bytes, `Sent fuzz tail ${idx + 1}/${rows.length}`);
  };

  const handleLogRow = (idx) => {
    const tail = rows[idx];
    if (!tail) return;
    setSelectedIdx(idx);
    const pkt = assembleForTail(tail.bytes);
    if (!pkt.bytes?.length) {
      onStatus?.('Nothing to log — assembled packet is empty');
      return;
    }
    onLogTail?.(pkt, {
      rowIdx: idx,
      rowCount: rows.length,
      tailBytes: tail.bytes,
    });
  };

  const handleCopyRow = async (idx) => {
    const tail = rows[idx];
    if (!tail) return;
    const hex = (assembleForTail(tail.bytes).hex || '').toUpperCase();
    if (!hex) {
      onStatus?.('Nothing to copy — assembled packet is empty');
      return;
    }
    setSelectedIdx(idx);
    try {
      await navigator.clipboard.writeText(hex);
      onStatus?.(`Copied assembled packet ${idx + 1}/${rows.length}`);
    } catch {
      onStatus?.('Clipboard copy failed');
    }
  };

  // TODO: dedupe with WandLabTailBuilderTab
  const handleSendAll = async () => {
    if (!rows.length || sendingAll) return;
    const gen = ++sendAllGen.current;
    setSendingAll(true);
    try {
      for (let i = 0; i < rows.length; i++) {
        if (sendAllGen.current !== gen) return;
        setSelectedIdx(i);
        const pkt = assembleForTail(rows[i].bytes);
        await sendAssembled(pkt.bytes);
        if (sendAllGen.current !== gen) return;
        if (i < rows.length - 1) await sleep(sendWaitMs);
      }
      if (sendAllGen.current === gen) {
        onStatus?.(`Sent all ${rows.length} fuzz tails`);
      }
    } finally {
      if (sendAllGen.current === gen) setSendingAll(false);
    }
  };

  const stopSendAll = () => {
    sendAllGen.current += 1;
    setSendingAll(false);
    onStatus?.('Stopped fuzz send-all');
  };

  const handleObserveAll = async () => {
    const payloads = rows
      .map((t, i) => {
        const pkt = assembleForTail(t.bytes || []);
        return {
          hex_full: hexFullForBytes(pkt.bytes),
          label: `fuzz-${i + 1}`,
        };
      })
      .filter((p) => p.hex_full);
    await runObserve(payloads, 'Build & Observe All');
  };

  const handleSendToAnalyzer = () => {
    const packets = rows
      .map((t) => {
        const assembled = assembleForTail(t.bytes || []);
        return { bytes: assembled.bytes, hex: assembled.hex };
      })
      .filter((p) => p.bytes.length);
    onSendToAnalyzer?.(packets);
  };

  const syncLenBounds = () => {
    const lo = minLenRef.current;
    const hi = maxLenRef.current;
    if (hi < lo) {
      minLenRef.current = hi;
      maxLenRef.current = lo;
      setMinLen(hi);
      setMaxLen(lo);
    }
  };

  const commitMinLen = (v) => {
    const n = clampFuzzLen(v);
    minLenRef.current = n;
    setMinLen(n);
  };

  const commitMaxLen = (v) => {
    const n = clampFuzzLen(v);
    maxLenRef.current = n;
    setMaxLen(n);
  };

  const fmtLabel = `0x${String(colorFormat || '0f').replace(/^0x/i, '').toUpperCase().padStart(2, '0')}`;
  const noColors = !activeColors.length;

  return (
    <Stack gap="md">
      <Group gap="xs" wrap="wrap" align="center">
        <Text size="xs" c="dimmed">
          Using Tail Builder settings:
        </Text>
        <Badge size="sm" variant="light" ff="monospace">
          TB={fmtHexByte(timingByte)}
        </Badge>
        <Badge size="sm" variant="light" ff="monospace">
          fmt={fmtLabel}
        </Badge>
        <Badge size="sm" variant="light">
          {activeColors.length} color{activeColors.length === 1 ? '' : 's'}
        </Badge>
        <Badge size="sm" variant="light" ff="monospace">
          vib={vibLabel(vibration)}
        </Badge>
        <Badge size="sm" variant="light" ff="monospace">
          env={envLabel(envelope)}
        </Badge>
        <Button size="compact-xs" variant="light" onClick={() => onGoToTailBuilder?.()}>
          Edit in Tail Builder
        </Button>
      </Group>
      {noColors && (
        <Text size="xs" c="orange">
          No colors configured in Tail Builder yet — set up Assembly there first. Rolling with 0
          colors is still allowed.
        </Text>
      )}

      <Group gap="sm" wrap="wrap" align="flex-end">
        <NumberInput
          label="Min length"
          size="xs"
          w={110}
          min={0}
          max={MAX_FUZZ_TAIL_BYTES}
          clampBehavior="strict"
          allowDecimal={false}
          value={minLen}
          onChange={commitMinLen}
          onBlur={() => requestAnimationFrame(syncLenBounds)}
        />
        <NumberInput
          label="Max length"
          size="xs"
          w={110}
          min={0}
          max={MAX_FUZZ_TAIL_BYTES}
          clampBehavior="strict"
          allowDecimal={false}
          value={maxLen}
          onChange={commitMaxLen}
          onBlur={() => requestAnimationFrame(syncLenBounds)}
        />
        <NumberInput
          label="How many"
          size="xs"
          w={110}
          min={1}
          max={200}
          clampBehavior="strict"
          allowDecimal={false}
          value={count}
          onChange={(v) => setCount(Math.max(1, Math.min(200, Number(v) || 1)))}
        />
        <Tooltip label="Last tail byte won't end up looking like a vibration field.">
          <span>
            <Switch
              size="xs"
              label="Avoid trailing 0xB_ (vibration nibble)"
              checked={!!avoidVibNibble}
              onChange={(e) => setAvoidVibNibble(e.currentTarget.checked)}
            />
          </span>
        </Tooltip>
        <Button onClick={handleRoll}>🎲 Roll</Button>
        <Button
          variant="default"
          onClick={handleRerollOne}
          disabled={!rows[safeIdx]}
        >
          🎲 Reroll one
        </Button>
      </Group>

      <Table.ScrollContainer minWidth={640}>
        <Table striped highlightOnHover withTableBorder withColumnBorders>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={36}>#</Table.Th>
              <Table.Th>Tail hex</Table.Th>
              <Table.Th w={56}>Len</Table.Th>
              <Table.Th>Assembled packet</Table.Th>
              <Table.Th w={220} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <Text size="sm" c="dimmed">
                    Nothing rolled yet — hit Roll.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              rows.map((t, i) => {
                const isSelected = i === safeIdx;
                const assembledHex = (assembleForTail(t.bytes || []).hex || '').toUpperCase();
                return (
                  <Table.Tr
                    key={`fuzz-${i}-${t.hex || i}`}
                    onClick={() => setSelectedIdx(i)}
                    style={{
                      cursor: 'pointer',
                      background: isSelected
                        ? 'color-mix(in srgb, var(--mantine-color-teal-filled) 14%, transparent)'
                        : undefined,
                    }}
                  >
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {i + 1}
                      </Text>
                      {isSelected && (
                        <Badge size="xs" color="teal" variant="light">
                          Sel
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {t.displayHex || '(empty)'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace">
                        {t.bytes?.length || 0}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                        {assembledHex || '(empty)'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4} wrap="nowrap">
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="teal"
                          disabled={!simIp || sendingAll}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleSendRow(i);
                          }}
                        >
                          Send
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="light"
                          color="cyan"
                          disabled={!onLogTail}
                          title="Log this assembled tail in the observation log"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleLogRow(i);
                          }}
                        >
                          Log
                        </Button>
                        <Button
                          size="compact-xs"
                          variant="default"
                          title="Copy this assembled packet as compact hex"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleCopyRow(i);
                          }}
                        >
                          Copy
                        </Button>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {rows.length > 0 && (
        <Group gap="xs" wrap="wrap" align="flex-end">
          {sendingAll ? (
            <Button color="red" variant="light" onClick={stopSendAll}>
              Stop
            </Button>
          ) : (
            <Button variant="default" onClick={() => void handleSendAll()} disabled={!simIp}>
              Send all
            </Button>
          )}
          <NumberInput
            label="Wait (ms)"
            size="xs"
            w={110}
            min={50}
            max={60000}
            step={50}
            value={sendWaitMs}
            onChange={(v) => setSendWaitMs(Math.max(50, Number(v) || 1000))}
            disabled={sendingAll}
          />
          <Tooltip
            label={
              !simIp
                ? 'Set Simulator IP first — Observe drives the same board as Send'
                : wc.available
                  ? 'Assemble every rolled tail and observe'
                  : wc.disabledTip
            }
          >
            <span>
              <Button
                variant="light"
                color="violet"
                onClick={() => void handleObserveAll()}
                loading={observing}
                disabled={!simIp || !wc.available || !rows.length || observing}
              >
                Build & Observe All
              </Button>
            </span>
          </Tooltip>
          <NumberInput
            label="Observe hold (ms)"
            size="xs"
            w={140}
            min={500}
            max={30000}
            step={500}
            value={observeHoldMs}
            onChange={(v) =>
              setObserveHoldMs(Math.max(500, Number(v) || DEFAULT_OBSERVE_HOLD_MS))
            }
            disabled={observing}
          />
          <Button
            size="compact-xs"
            variant="light"
            color="cyan"
            disabled={!rows.length}
            onClick={handleSendToAnalyzer}
          >
            Send to Analyzer
          </Button>
        </Group>
      )}

      {observeError ? (
        <Text size="xs" c="red">
          {observeError}
        </Text>
      ) : null}
      {(observing || observeReports.length > 0) && (
        <Stack gap={4}>
          <Text size="xs" fw={600} tt="uppercase" c="dimmed">
            Observe results
          </Text>
          <WaveClassifierObserveResults
            reports={observeReports}
            reportCsv={observeReportCsv}
            reportMd={observeReportMd}
            reportJson={observeReportJson}
            backendUrl={wc.baseUrl}
          />
        </Stack>
      )}

      <Text size="xs" c="dimmed">
        Only tail bytes are randomized. Timing byte, color format/colors, and vibration come from
        Tail Builder's Assembly settings above.
      </Text>
    </Stack>
  );
}
