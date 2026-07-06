import { useState, useEffect } from 'react';
import {
  Button,
  Group,
  NumberInput,
  Paper,
  Slider,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { PALETTE_SWATCHES } from './ColorInput';
import { AppButton } from './styles';
import { hexToRgb, hslToRgb, normalizeHex, rgbToHex, rgbToHsl } from '../../lib/utils';

export function ColorCell({ color, onChange, onRemove, savedColors, onSaveColor }) {
  const [mode, setMode] = useState('swatches');
  const rgb = hexToRgb(color || '#000000');
  const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
  const [hexInput, setHexInput] = useState(color);
  const library = savedColors || [];

  useEffect(() => { setHexInput(color); }, [color]);

  const applyHex = (v) => {
    const h = normalizeHex(v);
    if (h) onChange(h);
    setHexInput(v);
  };

  const applyRgb = (r, g, b) => onChange(rgbToHex(r, g, b));

  const applyHsl = (h, s, l) => {
    const next = hslToRgb(h, s, l);
    applyRgb(next.r, next.g, next.b);
  };

  const channelRow = (ch, val, min, max, accent, onVal) => (
    <Group key={ch} gap="xs" align="center" wrap="nowrap">
      <Text size="xs" fw={700} c="dimmed" w={14}>{ch}</Text>
      <NumberInput
        min={min}
        max={max}
        value={val}
        onChange={(v) => onVal(Math.max(min, Math.min(max, parseInt(v, 10) || 0)))}
        w={56}
        size="xs"
        styles={{ input: { textAlign: 'right', fontFamily: 'monospace' } }}
      />
      <Slider
        style={{ flex: 1 }}
        min={min}
        max={max}
        value={val}
        onChange={onVal}
        color={accent}
        size="xs"
      />
    </Group>
  );

  const saveCurrent = () => {
    if (onSaveColor) onSaveColor(color);
  };

  return (
    <Paper p="sm" bg="var(--surface2)">
      <Stack gap="xs">
        <div style={{
          height: 44, borderRadius: 7, background: color, border: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Text size="xs" ff="monospace" c="white" style={{ textShadow: '0 1px 3px #000000aa' }}>{color}</Text>
        </div>
        <Group gap={0} style={{ background: 'var(--surface)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {['swatches', 'hex', 'rgb', 'hsl'].map((m) => (
            <Button
              key={m}
              size="compact-xs"
              variant={mode === m ? 'filled' : 'subtle'}
              style={{ flex: 1, borderRadius: 0 }}
              onClick={() => setMode(m)}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </Button>
          ))}
        </Group>

        {library.length > 0 && (
          <Stack gap={4}>
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">Saved colors</Text>
            <Group gap={3}>
              {library.map((sc) => (
                <div
                  key={sc.id}
                  title={sc.name}
                  onClick={() => onChange(sc.hex)}
                  style={{
                    width: 20, height: 20, borderRadius: 3, background: sc.hex, cursor: 'pointer', flexShrink: 0,
                    outline: sc.hex.toLowerCase() === color.toLowerCase() ? '2px solid white' : '1px solid #ffffff22',
                    outlineOffset: 1,
                  }}
                />
              ))}
            </Group>
          </Stack>
        )}

        {mode === 'swatches' && (
          <Group gap={3}>
            {PALETTE_SWATCHES.map((sw) => (
              <div
                key={sw}
                onClick={() => onChange(sw)}
                style={{
                  width: 20, height: 20, borderRadius: 3, background: sw, cursor: 'pointer', flexShrink: 0,
                  outline: sw.toLowerCase() === color.toLowerCase() ? '2px solid white' : '1px solid #ffffff22',
                  outlineOffset: 1,
                }}
              />
            ))}
            <label style={{
              width: 20, height: 20, borderRadius: 3, overflow: 'hidden', cursor: 'pointer',
              border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: 'var(--text3)',
            }}>
              <input type="color" value={color} onChange={(e) => onChange(e.target.value)} style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }} />+
            </label>
          </Group>
        )}

        {mode === 'hex' && (
          <Group gap="xs" align="center">
            <div style={{ width: 28, height: 28, borderRadius: 5, background: color, border: '1px solid var(--border)', flexShrink: 0 }} />
            <TextInput
              value={hexInput}
              onChange={(e) => applyHex(e.target.value)}
              placeholder="#rrggbb"
              maxLength={7}
              style={{ flex: 1 }}
              styles={{ input: { fontFamily: 'monospace' } }}
            />
          </Group>
        )}

        {mode === 'rgb' && (
          <Stack gap={6}>
            {channelRow('R', rgb.r, 0, 255, 'red', (nv) => applyRgb(nv, rgb.g, rgb.b))}
            {channelRow('G', rgb.g, 0, 255, 'green', (nv) => applyRgb(rgb.r, nv, rgb.b))}
            {channelRow('B', rgb.b, 0, 255, 'blue', (nv) => applyRgb(rgb.r, rgb.g, nv))}
          </Stack>
        )}

        {mode === 'hsl' && (
          <Stack gap={6}>
            {channelRow('H', hsl.h, 0, 360, 'grape', (nv) => applyHsl(nv, hsl.s, hsl.l))}
            {channelRow('S', hsl.s, 0, 100, 'orange', (nv) => applyHsl(hsl.h, nv, hsl.l))}
            {channelRow('L', hsl.l, 0, 100, 'gray', (nv) => applyHsl(hsl.h, hsl.s, nv))}
          </Stack>
        )}

        <Group gap="xs">
          {onSaveColor && (
            <AppButton variant="default" style={{ flex: 1 }} size="compact-xs" onClick={saveCurrent}>Save to library</AppButton>
          )}
          {onRemove && (
            <AppButton variant="danger" style={{ flex: 1 }} size="compact-xs" onClick={onRemove}>Remove</AppButton>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
