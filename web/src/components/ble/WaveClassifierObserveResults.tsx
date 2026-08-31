import { useEffect, useState } from 'react';
import { Button, CopyButton, Group, Stack, Table, Text } from '@mantine/core';
import { fetchReport } from '../../lib/ble/waveClassifierClient';

/**
 * Inline Observe results — waveform class / confidence keyed by the tail that
 * produced them. Same table in Tail Builder, Packet Sequence, Analyzer sweep,
 * and Sweep Queue.
 */
export function WaveClassifierObserveResults({
  reports = [],
  reportCsv,
  reportMd,
  reportJson,
  backendUrl,
  emptyLabel = 'No observe results yet.',
}) {
  const [mdText, setMdText] = useState('');
  const [mdError, setMdError] = useState('');
  const [mdCopied, setMdCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMdText('');
    setMdError('');
    setMdCopied(false);
    if (!reportMd || !backendUrl) return undefined;
    fetchReport(backendUrl, reportMd)
      .then((text) => {
        if (!cancelled) setMdText(text);
      })
      .catch((e) => {
        if (!cancelled) setMdError(e.message || 'Could not load markdown');
      });
    return () => {
      cancelled = true;
    };
  }, [reportMd, backendUrl]);

  if (!reports.length) {
    return (
      <Text size="xs" c="dimmed">
        {emptyLabel}
      </Text>
    );
  }

  const files = [
    { label: 'MD (paste into Claude)', path: reportMd, copyContents: true },
    { label: 'CSV', path: reportCsv },
    { label: 'JSON', path: reportJson },
  ].filter((f) => f.path);

  const copyMarkdown = async () => {
    let text = mdText;
    if (!text && backendUrl && reportMd) {
      try {
        text = await fetchReport(backendUrl, reportMd);
        setMdText(text);
        setMdError('');
      } catch (e) {
        setMdError(e.message || 'Could not load markdown');
        return;
      }
    }
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setMdCopied(true);
      setTimeout(() => setMdCopied(false), 1500);
    } catch {
      setMdError('Clipboard write failed');
    }
  };

  return (
    <>
      {files.length ? (
        <Stack gap={2} mb={6}>
          {files.map((f) => (
            <Group key={f.path} gap={6} wrap="nowrap">
              <Text size="xs" c="dimmed" ff="monospace" style={{ flex: 1 }} lineClamp={1}>
                {f.label}: {f.path}
              </Text>
              {f.copyContents ? (
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() => void copyMarkdown()}
                  disabled={!mdText && !backendUrl}
                >
                  {mdCopied ? 'Copied' : 'Copy markdown'}
                </Button>
              ) : null}
              <CopyButton value={f.path}>
                {({ copied, copy }) => (
                  <Button size="compact-xs" variant="subtle" onClick={copy}>
                    {copied ? 'Copied' : 'Copy path'}
                  </Button>
                )}
              </CopyButton>
            </Group>
          ))}
          {mdError ? (
            <Text size="xs" c="red">{mdError}</Text>
          ) : null}
        </Stack>
      ) : null}
      <Table.ScrollContainer minWidth={480}>
        <Table striped withTableBorder withColumnBorders highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Tail</Table.Th>
              <Table.Th>Engine</Table.Th>
              <Table.Th>Spatial</Table.Th>
              <Table.Th>Mix</Table.Th>
              <Table.Th>Colors</Table.Th>
              <Table.Th>Cycle</Table.Th>
              <Table.Th>Conf</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {reports.map((r, i) => {
              const key = r.sweep_value || r.effect_label || r.row_id || `#${i + 1}`;
              const engine = r.engine || r.inferred_label || r.waveform_class_brightness || '—';
              const mix = r.mix || r.mix_steps || r.blend_style || '—';
              const cycle = r.cycle_ms ? `${r.cycle_ms} ms` : '—';
              return (
                <Table.Tr key={`${key}-${i}`}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">{String(key)}</Text>
                    {r.hex_full ? (
                      <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
                        {String(r.hex_full).slice(0, 28)}…
                      </Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{engine}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{r.spatial || r.zone_relationship || '—'}</Text>
                    {r.outer_chase_direction ? (
                      <Text size="xs" c="dimmed">{r.outer_chase_direction}</Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{mix}</Text>
                    {r.mix_kind && r.mix_kind !== 'unknown' ? (
                      <Text size="xs" c="dimmed">{r.mix_kind.replace(/_/g, ' ')}</Text>
                    ) : null}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{r.colors || r.expected_colors_label || '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{cycle}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {typeof r.confidence === 'number' ? r.confidence.toFixed(2) : r.confidence || '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </>
  );
}
