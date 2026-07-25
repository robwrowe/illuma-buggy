import { Checkbox, Group, Stack, Text } from '@mantine/core';
import { GradientCurveEditor } from '../shared/GradientCurveEditor';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import {
  DEFAULT_DATA,
  IDENTITY_CALIBRATION_CURVE,
  applyColorCalibration,
  normalizeColorCalibration,
} from '../../lib/utils';

/** Wand-lab reference RGB triples used while tuning blue-channel correction. */
const PREVIEW_COLORS = [
  { label: 'R 87,0,0', rgb: [87, 0, 0] },
  { label: 'G 0,64,4', rgb: [0, 64, 4] },
  { label: '61,0,252', rgb: [61, 0, 252] },
  { label: '0,65,252', rgb: [0, 65, 252] },
  { label: '0,60,72', rgb: [0, 60, 72] },
];

const CHANNELS = [
  { key: 'r', title: 'Red', channelColor: '#ff4444' },
  { key: 'g', title: 'Green', channelColor: '#44ff44' },
  { key: 'b', title: 'Blue', channelColor: '#4488ff' },
];

function rgbCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

export function ColorCalibrationPanel({ data, update }) {
  const cal = normalizeColorCalibration(data.colorCalibration || DEFAULT_DATA.colorCalibration);

  const setEnabled = (enabled) => {
    update({ colorCalibration: { ...cal, enabled } });
  };

  const setCurve = (ch, points) => {
    update({
      colorCalibration: {
        ...cal,
        curves: { ...cal.curves, [ch]: points },
      },
    });
  };

  const resetCurve = (ch) => {
    setCurve(ch, IDENTITY_CALIBRATION_CURVE.map((p) => [...p]));
  };

  return (
    <Stack p="lg" gap="sm">
      <SectionHead>Color Calibration</SectionHead>
      <Text size="xs" c="dimmed" lh={1.5} m={0}>
        Per-channel curves applied on the board to raw BLE RGB extracts (channelGroup /
        kind:rgb) before they reach WLED. Palette-indexed colors are not corrected.
      </Text>

      <Checkbox
        label="Enable calibration"
        checked={!!cal.enabled}
        onChange={(e) => setEnabled(e.target.checked)}
      />

      <Text size="xs" fw={700} c="dimmed" tt="uppercase" mt="xs">
        Preview (wand-lab reference colors)
      </Text>
      <Stack gap={6}>
        {PREVIEW_COLORS.map(({ label, rgb }) => {
          const corrected = applyColorCalibration(rgb, cal);
          return (
            <Group key={label} gap="sm" wrap="nowrap" align="center">
              <Text size="xs" ff="monospace" w={88} style={{ flexShrink: 0 }}>{label}</Text>
              <Group gap={6} align="center">
                <Text size="xs" c="dimmed">raw</Text>
                <div
                  title={`raw ${rgb.join(',')}`}
                  style={{
                    width: 36,
                    height: 22,
                    borderRadius: 4,
                    background: rgbCss(rgb),
                    border: '1px solid var(--border)',
                  }}
                />
                <Text size="xs" c="dimmed">→</Text>
                <Text size="xs" c="dimmed">corrected</Text>
                <div
                  title={`corrected ${corrected.join(',')}`}
                  style={{
                    width: 36,
                    height: 22,
                    borderRadius: 4,
                    background: rgbCss(corrected),
                    border: '1px solid var(--border)',
                    opacity: cal.enabled ? 1 : 0.45,
                  }}
                />
              </Group>
            </Group>
          );
        })}
      </Stack>

      {CHANNELS.map(({ key, title, channelColor }) => (
        <AppCard key={key} p="sm">
          <Group justify="space-between" align="center" mb={6}>
            <div>
              <Text size="sm" fw={600} c={channelColor}>{title}</Text>
              <Text size="xs" c="dimmed" m={0}>
                Double-click to add · right-click / × to delete · endpoints lock on x
              </Text>
            </div>
            <AppButton
              variant="default"
              size="compact-xs"
              onClick={() => resetCurve(key)}
              disabled={!cal.enabled}
            >
              Reset to identity
            </AppButton>
          </Group>
          <GradientCurveEditor
            points={cal.curves[key]}
            onChange={(pts) => setCurve(key, pts)}
            channelColor={channelColor}
            height={180}
            disabled={!cal.enabled}
          />
        </AppCard>
      ))}
    </Stack>
  );
}
