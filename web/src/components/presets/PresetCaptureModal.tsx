import { Checkbox, Group, Paper, Stack, Text } from '@mantine/core';
import { Modal } from '../shared/Modal';
import { AppButton } from '../shared/styles';
import { wledCaptureLabels } from '../../lib/wled/capture';

export function PresetCaptureModal({
  open,
  wledIp,
  captureOpts,
  onToggleOpt,
  onSetAllOpts,
  captureUpdateMemory,
  onCaptureUpdateMemoryChange,
  capturing,
  captureErr,
  onClose,
  onImport,
}) {
  if (!open) return null;

  return (
    <Modal title="Import from WLED" onClose={onClose} width={440}>
      <Stack gap="sm">
        <Text size="sm" c="dimmed" lh={1.55}>
          Reads the current strip at <Text component="code" ff="monospace" span>{wledIp.trim() || '…'}</Text> via{' '}
          <Text component="code" ff="monospace" span>/json/state</Text>. Only checked fields overwrite this preset; others stay as-is.
        </Text>
        <Group gap="xs">
          <AppButton type="button" variant="default" size="compact-xs" onClick={() => onSetAllOpts(true)}>Select all</AppButton>
          <AppButton type="button" variant="default" size="compact-xs" onClick={() => onSetAllOpts(false)}>Clear all</AppButton>
        </Group>
        {Object.entries(wledCaptureLabels()).map(([key, { title, hint }]) => (
          <Paper
            key={key}
            p="sm"
            radius="md"
            bg="var(--surface2)"
            style={{ cursor: 'pointer' }}
            onClick={() => onToggleOpt(key)}
          >
            <Group gap="sm" align="flex-start" wrap="nowrap">
              <Checkbox
                checked={!!captureOpts[key]}
                onChange={() => onToggleOpt(key)}
                onClick={(e) => e.stopPropagation()}
                mt={2}
                style={{ flexShrink: 0 }}
              />
              <Stack gap={2}>
                <Text size="sm" fw={600}>{title}</Text>
                <Text size="xs" c="dimmed">{hint}</Text>
              </Stack>
            </Group>
          </Paper>
        ))}
        <Checkbox
          label="Update Memory tab flags for imported fields"
          checked={captureUpdateMemory}
          onChange={(e) => onCaptureUpdateMemoryChange(e.target.checked)}
          size="sm"
        />
        {captureErr && <Text size="sm" c="red">{captureErr}</Text>}
        <Group gap="sm">
          <AppButton type="button" variant="default" style={{ flex: 1 }} onClick={onClose} disabled={capturing}>Cancel</AppButton>
          <AppButton type="button" variant="primary" style={{ flex: 1 }} onClick={onImport} disabled={capturing}>
            {capturing ? 'Reading…' : 'Import'}
          </AppButton>
        </Group>
      </Stack>
    </Modal>
  );
}
