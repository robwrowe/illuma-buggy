import { Group, Stack, Text, TextInput } from '@mantine/core';
import { SegmentMapEditor } from '../ble/SegmentMapEditor';
import { Modal } from '../shared/Modal';
import { normalizeMbMapping } from '../../lib/ble/mbMapping';

export function PresetMapEditorModal({
  open,
  onClose,
  wledIp,
  onWledIpChange,
  mb,
  presets,
  wledEffects,
  wledPalettes,
  onMbChange,
  onPresetsChange,
}) {
  if (!open) return null;

  return (
    <Modal title="Segment maps" onClose={onClose} width={720}>
      <Stack gap="sm">
        <Group gap="sm" wrap="wrap" align="center">
          <Text size="xs" fw={600} c="dimmed">WLED IP</Text>
          <TextInput
            value={wledIp}
            onChange={(e) => onWledIpChange(e.target.value)}
            placeholder="4.3.2.1"
            w={140}
            styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
          />
          <Text size="xs" c="dimmed">Import / replace from live strip</Text>
        </Group>
        <SegmentMapEditor
          mb={mb}
          presets={presets}
          wledIp={wledIp}
          effectOptions={wledEffects}
          paletteOptions={wledPalettes}
          onChange={(next) => onMbChange(normalizeMbMapping(next))}
          onPresetsChange={onPresetsChange}
        />
      </Stack>
    </Modal>
  );
}
