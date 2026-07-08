import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Button,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import {
  MB_PATTERN_MODES,
  SW_FX_PRESET_BYTES,
  WAND_LAB_MB_CMDS,
  mbPaletteOptions,
} from '../../lib/ble/mbConstants';
import { buildMbDual, buildMbFive, buildMbPing, buildMbRgb, buildMbSingle } from '../../lib/ble/mbPayloads';
import { bytesToHex, parseHexToBytes, sendHex } from '../../lib/ble/wandSimClient';
import { DEFAULT_DATA, generateId } from '../../lib/utils';
import { WAND_LAB_SECTIONS } from '../../lib/routes';
import { WandLabCapturePaste } from './WandLabCapturePaste';
import { WandLabLogPanel } from './WandLabLogPanel';
import { WandLabPacketSequence } from './WandLabPacketSequence';
import { WandLabQuickCommands } from './WandLabQuickCommands';
import { WandLabShowPanel } from './WandLabShowPanel';
import { SweepByteIndex, WandLabSweepPanel } from './WandLabSweepPanel';
import { WandLabByteBitsEditor } from './WandLabByteBitsEditor';

const LAB_TABS = WAND_LAB_SECTIONS;

function buildLogSnapshot(labTab, bytes, origBytes, presetKey, sequencePackets) {
  if (labTab === 'sequence') {
    const valid = sequencePackets.filter((p) => p.bytes?.length);
    if (valid.length > 1) {
      return {
        kind: 'sequence',
        presetKey: 'sequence',
        packets: valid.map((p) => ({
          bytes: bytesToHex(p.bytes),
          waitMs: p.waitMs ?? 1000,
        })),
      };
    }
    if (valid.length === 1) {
      const hex = bytesToHex(valid[0].bytes);
      return { kind: 'single', presetKey: 'sequence', bytes: hex, origBytes: hex };
    }
  }
  return {
    kind: 'single',
    presetKey,
    bytes: bytesToHex(bytes),
    origBytes: bytesToHex(origBytes),
  };
}

export function WandLabTab({ data, update }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const isNarrow = useMediaQuery('(max-width: 62em)');
  const labTab = WAND_LAB_SECTIONS.some((t) => t.path === section) ? section : 'quick';
  const setLabTab = (v) => { if (v) navigate(`/wandlab/${v}`); };

  useEffect(() => {
    if (section === 'log') navigate('/wandlab/quick', { replace: true });
  }, [section, navigate]);

  const lab = data.wandLab || DEFAULT_DATA.wandLab;
  const [presetKey, setPresetKey] = useState('rainbow');
  const [bytes, setBytes] = useState([...SW_FX_PRESET_BYTES.rainbow]);
  const [origBytes, setOrigBytes] = useState([...SW_FX_PRESET_BYTES.rainbow]);
  const [sequencePackets, setSequencePackets] = useState([]);
  const [note, setNote] = useState('');
  const [tag, setTag] = useState('unknown');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [logFilter, setLogFilter] = useState('');
  const [mbCmd, setMbCmd] = useState('single');
  const [mbPal, setMbPal] = useState('21');
  const [mbMask, setMbMask] = useState('0');
  const [mbInner, setMbInner] = useState('21');
  const [mbOuter, setMbOuter] = useState('0');
  const [mbRgb, setMbRgb] = useState({ r: 63, g: 0, b: 0 });
  const [mbFive, setMbFive] = useState({ tl: '0', bl: '2', br: '21', tr: '8', c: '19' });
  const [mbPattern, setMbPattern] = useState('solid');
  const [hexPaste, setHexPaste] = useState('');
  const [editingLogId, setEditingLogId] = useState(null);
  const [sweepIndex, setSweepIndex] = useState(null);
  const [sweepLivePayload, setSweepLivePayload] = useState(null);

  const palOpts = mbPaletteOptions();

  const setByteArray = (b, key) => {
    setPresetKey(key);
    setBytes([...b]);
    setOrigBytes([...b]);
  };

  const loadPreset = (key) => {
    const b = SW_FX_PRESET_BYTES[key] || [];
    setPresetKey(key);
    setBytes([...b]);
    setOrigBytes([...b]);
  };

  const patchByte = (idx, val) => {
    const n = typeof val === 'number' ? val : parseInt(val, 16);
    if (isNaN(n) || n < 0 || n > 255) return;
    setBytes((prev) => prev.map((b, i) => (i === idx ? n : b)));
  };

  const addByte = () => {
    setBytes((prev) => [...prev, 0]);
    setOrigBytes((prev) => [...prev, 0]);
  };

  const removeByte = (idx) => {
    setBytes((prev) => prev.filter((_, i) => i !== idx));
    setOrigBytes((prev) => prev.filter((_, i) => i !== idx));
    if (sweepIndex === idx) setSweepIndex(null);
    else if (sweepIndex != null && sweepIndex > idx) setSweepIndex(sweepIndex - 1);
  };

  const resetBytes = () => setBytes([...origBytes]);

  const buildMbCommandBytes = () => {
    const p = (v) => parseInt(v, 10) & 0x1F;
    switch (mbCmd) {
      case 'single':
        return buildMbSingle(p(mbPal), parseInt(mbMask, 10) || 0);
      case 'dual':
        return buildMbDual(p(mbInner), p(mbOuter));
      case 'rgb':
        return buildMbRgb(mbRgb.r, mbRgb.g, mbRgb.b);
      case 'five':
        return buildMbFive(p(mbFive.tl), p(mbFive.bl), p(mbFive.br), p(mbFive.tr), p(mbFive.c));
      case 'pattern': {
        const mode = MB_PATTERN_MODES.find((m) => m.id === mbPattern) || MB_PATTERN_MODES[0];
        const pal = p(mbPal);
        return buildMbFive(pal, pal, pal, pal, pal, 0x0E, 0, mode.nibble);
      }
      case 'ping':
        return buildMbPing();
      default:
        return [];
    }
  };

  const loadMbCommand = () => setByteArray(buildMbCommandBytes(), `mb:${mbCmd}`);

  const sendBytes = async (payload) => {
    const ip = (lab.simIp || '').trim();
    if (!ip) { setStatus('Set simulator IP first'); return false; }
    if (!payload.length) { setStatus('No bytes to send'); return false; }
    setSending(true);
    setStatus('');
    try {
      await sendHex(ip, payload);
      setStatus(`Sent ${payload.length} bytes`);
      return true;
    } catch (e) {
      setStatus(e.message || 'Send failed — is WandSim on WiFi?');
      return false;
    } finally {
      setSending(false);
    }
  };

  const sendMbCommand = async () => {
    const b = buildMbCommandBytes();
    setByteArray(b, `mb:${mbCmd}`);
    await sendBytes(b);
  };

  const addLogEntry = ({ note: logNote, presetKey: pk, snapshot: snapOverride, bytes: bytesOverride } = {}) => {
    const logBytes = bytesOverride
      ? parseHexToBytes(bytesOverride)
      : (sweepLivePayload ?? bytes);
    const logOrig = sweepLivePayload ?? origBytes;
    const snap = snapOverride || buildLogSnapshot(labTab, logBytes, logOrig, presetKey, sequencePackets);
    const entry = {
      id: editingLogId || generateId(),
      ts: editingLogId
        ? (lab.log || []).find((e) => e.id === editingLogId)?.ts || Date.now()
        : Date.now(),
      kind: snap.kind,
      presetKey: pk || snap.presetKey || presetKey,
      bytes: snap.kind === 'single' ? snap.bytes : (snap.packets?.[0]?.bytes || ''),
      origBytes: snap.origBytes || snap.bytes || '',
      packets: snap.kind === 'sequence' ? snap.packets : undefined,
      tag,
      note: (logNote ?? note).trim(),
    };
    const prev = lab.log || [];
    const log = editingLogId
      ? prev.map((e) => (e.id === editingLogId ? entry : e))
      : [entry, ...prev];
    update({ wandLab: { ...lab, log } });
    setNote('');
    setEditingLogId(null);
  };

  const loadLogEntry = (e) => {
    if ((e.kind === 'sequence' || e.packets?.length > 1) && e.packets?.length) {
      setSequencePackets(e.packets.map((p) => ({
        id: generateId(),
        bytes: parseHexToBytes(p.bytes),
        waitMs: p.waitMs ?? 1000,
        label: '',
      })));
      setPresetKey('sequence');
      setLabTab('sequence');
    } else {
      const arr = (e.bytes || '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
      if (arr.length) {
        setByteArray(arr, e.presetKey || 'log');
        setLabTab('bytes');
      }
    }
    setTag(e.tag || 'unknown');
    setNote(e.note || '');
    setEditingLogId(e.id);
  };

  const deleteLogEntry = (id) => {
    update({ wandLab: { ...lab, log: (lab.log || []).filter((e) => e.id !== id) } });
    if (editingLogId === id) setEditingLogId(null);
  };

  const purgeLog = () => {
    if (!(lab.log || []).length) return;
    if (!window.confirm(`Delete all ${(lab.log || []).length} log entries?`)) return;
    update({ wandLab: { ...lab, log: [] } });
    setEditingLogId(null);
  };

  const exportLog = () => {
    const blob = new Blob([JSON.stringify(lab.log || [], null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `wand-lab-log-${Date.now()}.json`;
    a.click();
  };

  const filteredLog = (lab.log || []).filter((e) =>
    !logFilter || e.presetKey === logFilter || e.tag === logFilter,
  );

  const loadFromSequence = (arr) => {
    setByteArray(arr, 'sequence');
    setLabTab('bytes');
    setStatus(`Loaded ${arr.length} bytes into editor`);
  };

  return (
    <Box
      h="100%"
      style={{
        display: 'flex',
        flexDirection: isNarrow ? 'column' : 'row',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <ScrollArea h="100%" type="auto" style={{ flex: 1, minWidth: 0 }}>
        <Stack p="md" gap="md">
          <Text size="xs" c="dimmed">
            Byte-stepper for WandSimulator on your LAN. Flash WandSimulator, run{' '}
            <Text span ff="monospace">wifi KyLan Ren password</Text> in Serial, then enter its IP below.
          </Text>

          <TextInput
            label="Simulator IP"
            value={lab.simIp || ''}
            placeholder="192.168.1.x"
            onChange={(e) => update({ wandLab: { ...lab, simIp: e.target.value.trim() } })}
          />

          {status && <Text size="xs" c="dimmed">{status}</Text>}

          <Tabs value={labTab} onChange={(v) => v && setLabTab(v)} keepMounted={false}>
            <Tabs.List>
              {LAB_TABS.map((t) => (
                <Tabs.Tab key={t.path} value={t.path}>{t.label}</Tabs.Tab>
              ))}
            </Tabs.List>

            <Tabs.Panel value="quick" pt="md">
              <WandLabQuickCommands
                simIp={lab.simIp}
                onStatus={setStatus}
                sending={sending}
                setSending={setSending}
              />
            </Tabs.Panel>

            <Tabs.Panel value="mb" pt="md">
              <Stack gap="md">
                <Text size="xs" c="dimmed">
                  Build standard MB packets (same builders as WandSimulator). Load into the byte editor or send directly.
                </Text>
                <Field label="Command">
                  <SearchableSelect
                    value={mbCmd}
                    allowEmpty={false}
                    onChange={setMbCmd}
                    options={WAND_LAB_MB_CMDS.map((c) => ({ value: c.id, label: c.label, searchText: c.label }))}
                  />
                </Field>
                {mbCmd === 'single' && (
                  <>
                    <Field label="Palette">
                      <SearchableSelect value={mbPal} allowEmpty={false} onChange={setMbPal} options={palOpts} />
                    </Field>
                    <Field label="LED mask (0 = all; bit N = band N)">
                      <TextInput type="number" min={0} max={255} value={mbMask} onChange={(e) => setMbMask(e.target.value)} />
                    </Field>
                  </>
                )}
                {mbCmd === 'dual' && (
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    <Field label="Inner ring">
                      <SearchableSelect value={mbInner} allowEmpty={false} onChange={setMbInner} options={palOpts} />
                    </Field>
                    <Field label="Outer ring">
                      <SearchableSelect value={mbOuter} allowEmpty={false} onChange={setMbOuter} options={palOpts} />
                    </Field>
                  </SimpleGrid>
                )}
                {mbCmd === 'rgb' && (
                  <SimpleGrid cols={{ base: 1, xs: 3 }}>
                    {['r', 'g', 'b'].map((ch) => (
                      <Field key={ch} label={`${ch.toUpperCase()} (0–63)`}>
                        <TextInput
                          type="number"
                          min={0}
                          max={63}
                          value={mbRgb[ch]}
                          onChange={(e) => setMbRgb((prev) => ({
                            ...prev,
                            [ch]: Math.max(0, Math.min(63, parseInt(e.target.value, 10) || 0)),
                          }))}
                        />
                      </Field>
                    ))}
                  </SimpleGrid>
                )}
                {mbCmd === 'five' && (
                  <SimpleGrid cols={{ base: 1, sm: 2 }}>
                    {[
                      ['tl', 'Top-left'], ['bl', 'Bottom-left'], ['br', 'Bottom-right'],
                      ['tr', 'Top-right'], ['c', 'Center'],
                    ].map(([key, label]) => (
                      <Field key={key} label={label}>
                        <SearchableSelect
                          value={mbFive[key]}
                          allowEmpty={false}
                          onChange={(v) => setMbFive((prev) => ({ ...prev, [key]: v }))}
                          options={palOpts}
                        />
                      </Field>
                    ))}
                  </SimpleGrid>
                )}
                {mbCmd === 'pattern' && (
                  <>
                    <Field label="Pattern">
                      <SearchableSelect
                        value={mbPattern}
                        allowEmpty={false}
                        onChange={setMbPattern}
                        options={MB_PATTERN_MODES.map((m) => ({ value: m.id, label: m.label, searchText: m.label }))}
                      />
                    </Field>
                    <Field label="Color">
                      <SearchableSelect value={mbPal} allowEmpty={false} onChange={setMbPal} options={palOpts} />
                    </Field>
                  </>
                )}
                <Group gap="xs" wrap="wrap">
                  <Button variant="default" onClick={() => { loadMbCommand(); setLabTab('bytes'); }} style={{ flex: 1, minWidth: 120 }}>
                    Load into editor
                  </Button>
                  <Button onClick={sendMbCommand} loading={sending} style={{ flex: 1, minWidth: 120 }}>
                    Send MB command
                  </Button>
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="bytes" pt="md">
              <Stack gap="md">
                <Field label="Paste single hex / capture row">
                  <WandLabCapturePaste
                    hexPaste={hexPaste}
                    onHexPasteChange={setHexPaste}
                    onLoadBytes={(arr) => setByteArray(arr, 'paste')}
                    onStatus={setStatus}
                    simIp={lab.simIp}
                  />
                </Field>

                <Text size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-all' }}>
                  {bytes.length ? bytesToHex(bytes).toUpperCase() : '(empty)'}
                </Text>

                <Group gap={6} wrap="wrap" align="flex-start">
                  {bytes.map((b, i) => (
                    <label
                      key={i}
                      style={{
                        fontSize: 10,
                        fontFamily: 'monospace',
                        position: 'relative',
                        background: b !== origBytes[i] ? 'var(--primary-dim)' : 'var(--surface2)',
                        border: `1px solid ${b !== origBytes[i] ? 'var(--primary)' : sweepIndex === i ? 'var(--mantine-color-yellow-5)' : 'var(--border)'}`,
                        borderRadius: 4,
                        padding: '4px 18px 4px 4px',
                      }}
                    >
                      <SweepByteIndex
                        index={i}
                        isModified={b !== origBytes[i]}
                        isSweepTarget={sweepIndex === i}
                        onSelect={setSweepIndex}
                      />
                      <input
                        style={{ width: 22, border: 'none', background: 'transparent', color: 'var(--text)', fontFamily: 'monospace', fontSize: 11 }}
                        value={b.toString(16).padStart(2, '0').toUpperCase()}
                        onFocus={() => setSweepIndex(i)}
                        onChange={(e) => patchByte(i, e.target.value)}
                      />
                      <button
                        type="button"
                        title="Remove byte"
                        onClick={() => removeByte(i)}
                        style={{
                          position: 'absolute', top: 2, right: 2, border: 'none', background: 'transparent',
                          color: 'var(--text3)', cursor: 'pointer', fontSize: 10, lineHeight: 1, padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </label>
                  ))}
                  <Button size="compact-xs" variant="default" onClick={addByte}>+ byte</Button>
                  {bytes.some((b, i) => b !== origBytes[i]) && (
                    <Button size="compact-xs" variant="default" onClick={resetBytes}>Reset</Button>
                  )}
                </Group>

                <WandLabByteBitsEditor
                  byteIndex={sweepIndex}
                  byteValue={sweepIndex != null ? bytes[sweepIndex] : null}
                  onChange={patchByte}
                />

                <WandLabSweepPanel
                  simIp={lab.simIp}
                  bytes={bytes}
                  sweepIndex={sweepIndex}
                  onSweepIndexChange={setSweepIndex}
                  onStatus={setStatus}
                  onSweepComplete={(payload) => addLogEntry(payload)}
                  onLivePayloadChange={setSweepLivePayload}
                />

                <Field label="Starlight / show preset">
                  <SearchableSelect
                    value={SW_FX_PRESET_BYTES[presetKey] ? presetKey : ''}
                    allowEmpty
                    onChange={loadPreset}
                    placeholder={presetKey.startsWith('mb:') || presetKey === 'sequence' || presetKey === 'paste' ? presetKey : 'Load show preset…'}
                    options={Object.keys(SW_FX_PRESET_BYTES).map((k) => ({ value: k, label: k, searchText: k }))}
                  />
                </Field>

                <Button onClick={() => sendBytes(bytes)} loading={sending} disabled={bytes.length === 0}>
                  Send raw bytes (/send)
                </Button>

                <WandLabShowPanel
                  simIp={lab.simIp}
                  bytes={bytes}
                  onStatus={setStatus}
                  onBurstComplete={(payload) => addLogEntry(payload)}
                />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="sequence" pt="md">
              <WandLabPacketSequence
                simIp={lab.simIp}
                packets={sequencePackets}
                setPackets={setSequencePackets}
                onStatus={setStatus}
                onLoadToEditor={loadFromSequence}
                onSequenceComplete={(payload) => addLogEntry(payload)}
              />
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </ScrollArea>

      <Box
        w={isNarrow ? '100%' : 300}
        h={isNarrow ? 280 : '100%'}
        style={{
          flexShrink: 0,
          borderLeft: isNarrow ? undefined : '1px solid var(--border)',
          borderTop: isNarrow ? '1px solid var(--border)' : undefined,
          minHeight: 0,
        }}
      >
        <WandLabLogPanel
          log={lab.log}
          filteredLog={filteredLog}
          tag={tag}
          onTagChange={setTag}
          note={note}
          onNoteChange={setNote}
          logFilter={logFilter}
          onLogFilterChange={setLogFilter}
          editingLogId={editingLogId}
          onAddEntry={() => addLogEntry()}
          onCancelEdit={() => { setEditingLogId(null); setNote(''); }}
          onLoadEntry={loadLogEntry}
          onDeleteEntry={deleteLogEntry}
          onExport={exportLog}
          onPurge={purgeLog}
        />
      </Box>
    </Box>
  );
}
