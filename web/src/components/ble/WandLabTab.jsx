import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Group,
  ScrollArea,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import {
  MB_PATTERN_MODES,
  SW_FX_PRESET_BYTES,
  WAND_LAB_MB_CMDS,
  WAND_LAB_TAGS,
  mbPaletteOptions,
} from '../../lib/ble/mbConstants';
import { buildMbDual, buildMbFive, buildMbPing, buildMbRgb, buildMbSingle } from '../../lib/ble/mbPayloads';
import { bytesToHex, sendHex } from '../../lib/ble/wandSimClient';
import { DEFAULT_DATA, generateId } from '../../lib/utils';
import { WAND_LAB_SECTIONS } from '../../lib/routes';
import { WandLabCapturePaste } from './WandLabCapturePaste';
import { WandLabPacketSequence } from './WandLabPacketSequence';
import { WandLabQuickCommands } from './WandLabQuickCommands';
import { WandLabShowPanel } from './WandLabShowPanel';
import { SweepByteIndex, WandLabSweepPanel } from './WandLabSweepPanel';

const LAB_TABS = WAND_LAB_SECTIONS;

export function WandLabTab({ data, update }) {
  const { section } = useParams();
  const navigate = useNavigate();
  const labTab = WAND_LAB_SECTIONS.some((t) => t.path === section) ? section : 'quick';
  const setLabTab = (v) => { if (v) navigate(`/wandlab/${v}`); };
  const lab = data.wandLab || DEFAULT_DATA.wandLab;
  const [presetKey, setPresetKey] = useState('rainbow');
  const [bytes, setBytes] = useState([...SW_FX_PRESET_BYTES.rainbow]);
  const [origBytes, setOrigBytes] = useState([...SW_FX_PRESET_BYTES.rainbow]);
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
    const n = parseInt(val, 16);
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

  const addLogEntry = ({ note: logNote, presetKey: pk, bytes: hexOverride }) => {
    const entry = {
      id: editingLogId || generateId(),
      ts: editingLogId
        ? (lab.log || []).find((e) => e.id === editingLogId)?.ts || Date.now()
        : Date.now(),
      presetKey: pk || presetKey,
      bytes: hexOverride || bytesToHex(bytes),
      origBytes: bytesToHex(origBytes),
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

  const logEntry = () => addLogEntry({});

  const loadLogEntry = (e) => {
    const arr = (e.bytes || '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
    if (arr.length) {
      setByteArray(arr, e.presetKey || 'log');
      setLabTab('bytes');
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
    <ScrollArea h="100%" type="auto">
      <Stack p="md" gap="md" maw={960}>
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

              <WandLabSweepPanel
                simIp={lab.simIp}
                bytes={bytes}
                sweepIndex={sweepIndex}
                onSweepIndexChange={setSweepIndex}
                onStatus={setStatus}
                onSweepComplete={(payload) => addLogEntry(payload)}
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
              onStatus={setStatus}
              onLoadToEditor={loadFromSequence}
            />
          </Tabs.Panel>

          <Tabs.Panel value="log" pt="md">
            <Stack gap="md">
              <SectionHead>Observation log</SectionHead>
              <Group gap="xs" wrap="wrap">
                {WAND_LAB_TAGS.map((t) => (
                  <Badge
                    key={t}
                    variant={tag === t ? 'filled' : 'outline'}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setTag(t)}
                  >
                    {t}
                  </Badge>
                ))}
              </Group>
              <Textarea
                placeholder="What happened on the strip?"
                minRows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <Group gap="xs">
                <Button variant="default" onClick={logEntry} style={{ flex: 1 }}>
                  {editingLogId ? 'Save log entry' : 'Add log entry'}
                </Button>
                {editingLogId && (
                  <Button variant="default" onClick={() => { setEditingLogId(null); setNote(''); }} style={{ flex: 1 }}>
                    Cancel edit
                  </Button>
                )}
              </Group>
              <Group gap="xs" wrap="wrap" align="center">
                <Text size="sm" fw={600}>Log ({(lab.log || []).length})</Text>
                <SearchableSelect
                  value={logFilter}
                  allowEmpty
                  onChange={setLogFilter}
                  placeholder="Filter…"
                  options={[
                    ...Object.keys(SW_FX_PRESET_BYTES),
                    ...WAND_LAB_MB_CMDS.map((c) => `mb:${c.id}`),
                    ...WAND_LAB_TAGS,
                    'paste',
                    'sequence',
                    'burst',
                  ].map((v) => ({ value: v, label: v, searchText: v }))}
                />
                <Button size="xs" variant="default" onClick={exportLog}>Export JSON</Button>
                {(lab.log || []).length > 0 && (
                  <Button size="xs" color="red" variant="light" onClick={purgeLog}>Purge all</Button>
                )}
              </Group>
              {filteredLog.length === 0 ? (
                <Text size="sm" c="dimmed">No log entries yet.</Text>
              ) : (
                <Stack gap="xs">
                  {filteredLog.map((e) => (
                    <Stack
                      key={e.id}
                      gap={4}
                      p="xs"
                      style={{
                        background: 'var(--surface2)',
                        borderRadius: 8,
                        border: editingLogId === e.id ? '1px solid var(--primary)' : '1px solid transparent',
                      }}
                    >
                      <Group justify="space-between" wrap="nowrap" align="flex-start">
                        <Text size="xs" fw={600}>
                          {e.presetKey} · {e.tag} · {new Date(e.ts).toLocaleString()}
                        </Text>
                        <Group gap={4} wrap="nowrap">
                          <Button size="compact-xs" variant="default" onClick={() => loadLogEntry(e)}>Load</Button>
                          <Button size="compact-xs" color="red" variant="light" onClick={() => deleteLogEntry(e.id)}>Delete</Button>
                        </Group>
                      </Group>
                      {e.note && <Text size="xs" c="dimmed">{e.note}</Text>}
                      <Text size="xs" ff="monospace" c="dimmed" style={{ wordBreak: 'break-all' }}>{e.bytes}</Text>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </ScrollArea>
  );
}
