import { Table, Text } from '@mantine/core';

/**
 * Inline Observe results — waveform class / confidence keyed by the tail that
 * produced them. Same table in Tail Builder, Packet Sequence, and Analyzer sweep.
 */
export function WaveClassifierObserveResults({
  reports = [],
  reportCsv,
  emptyLabel = 'No observe results yet.',
}) {
  if (!reports.length) {
    return (
      <Text size="xs" c="dimmed">
        {emptyLabel}
      </Text>
    );
  }
  return (
    <>
    {reportCsv ? (
      <Text size="xs" c="dimmed" ff="monospace" mb={4}>
        {reportCsv}
      </Text>
    ) : null}
    <Table.ScrollContainer minWidth={480}>
      <Table striped withTableBorder withColumnBorders highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Group value / tail</Table.Th>
            <Table.Th>n</Table.Th>
            <Table.Th>Observed</Table.Th>
            <Table.Th>Conf</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {reports.map((r, i) => {
              const key = r.sweep_value || r.effect_label || r.row_id || `#${i + 1}`;
            const observed = r.inferred_label || r.waveform_class_brightness || '—';
            const extra = [
              r.waveform_class_r && `R=${r.waveform_class_r}`,
              r.waveform_class_g && `G=${r.waveform_class_g}`,
              r.waveform_class_b && `B=${r.waveform_class_b}`,
              r.zone_relationship && r.zone_relationship !== 'single_zone'
                ? r.zone_relationship
                : null,
            ].filter(Boolean).join(' · ');
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
                  <Text size="xs">{r.n_repeats ?? 1}</Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{observed}</Text>
                  {extra ? <Text size="xs" c="dimmed">{extra}</Text> : null}
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {typeof r.confidence === 'number' ? r.confidence.toFixed(2) : r.confidence || '—'}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{r.status || r.capture_status || '—'}</Text>
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
