import { Box, Text } from '@mantine/core';
import {
  BIT_ORDER,
  bitFieldColor,
  bitRangeLabel,
  decodeBitGroupValue,
  formatCustomBitDecimals,
  groupIndexForBit,
  normalizeCustomBitFields,
} from '../../lib/ble/byteAnalyzer';
import { byteToBitString } from '../../lib/ble/wandSimClient';

function hexByte(value) {
  return (Number(value) & 0xff).toString(16).padStart(2, '0').toUpperCase();
}

export function CustomBitSuffix({ byteValue, fields }) {
  const text = formatCustomBitDecimals(byteValue, fields);
  if (!text) return null;
  const list = normalizeCustomBitFields(fields);
  const titled = list
    .map((f) => `${f.name || bitRangeLabel(f.bitStart, f.bitCount)}=${decodeBitGroupValue(byteValue, f.bitStart, f.bitCount)}`)
    .join(' · ');
  return (
    <Text
      span
      size="xs"
      c="dimmed"
      ff="monospace"
      title={titled}
      style={{ fontSize: 8, display: 'block', lineHeight: 1.2 }}
    >
      {text}
    </Text>
  );
}

/** Clickable b7..b0 strip — same interaction as Analyze / Tail bit view. */
export function ClickableBitStrip({
  byteValue,
  onByteChange,
  showLabels = true,
  groups = [],
}: {
  byteValue: number;
  onByteChange?: (n: number) => void;
  showLabels?: boolean;
  groups?: { bitStart?: number; bitCount?: number }[];
}) {
  const value = Number(byteValue) & 0xff;
  const bitStr = byteToBitString(value);
  return (
    <Box>
      {showLabels && (
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2, marginBottom: 2 }}>
          {BIT_ORDER.map((bitIdx) => (
            <Text key={bitIdx} size="xs" c="dimmed" ta="center" ff="monospace" style={{ fontSize: 8, lineHeight: 1 }}>
              {bitIdx}
            </Text>
          ))}
        </Box>
      )}
      <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
        {BIT_ORDER.map((bitIdx) => {
          const gi = groupIndexForBit(groups, bitIdx);
          const color = gi >= 0 ? bitFieldColor(gi) : undefined;
          return (
            <Box
              key={bitIdx}
              onClick={() => onByteChange?.((value ^ (1 << bitIdx)) & 0xff)}
              title={`Toggle bit ${bitIdx}`}
              style={{
                textAlign: 'center',
                fontSize: 12,
                lineHeight: '22px',
                borderRadius: 3,
                cursor: onByteChange ? 'pointer' : 'default',
                fontFamily: 'monospace',
                userSelect: 'none',
                border: color
                  ? `1px solid var(--mantine-color-${color}-6)`
                  : '1px solid var(--border)',
                background: color
                  ? `var(--mantine-color-${color}-light)`
                  : 'var(--surface2)',
              }}
            >
              {bitStr[7 - bitIdx]}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/**
 * One packet byte: hex or an 8-bit strip. Click the cell to flip between them.
 */
export function ByteBitCell({
  byteValue,
  showBits = false,
  onToggleBits = undefined,
  editable = false,
  onByteChange = undefined,
  tagColor = undefined,
  suffix = null,
  compareMark = null,
  empty = false,
  title = undefined,
  customFields = undefined,
}: {
  byteValue?: number;
  showBits?: boolean;
  onToggleBits?: (() => void) | undefined;
  editable?: boolean;
  onByteChange?: ((n: number) => void) | undefined;
  tagColor?: string;
  suffix?: any;
  compareMark?: number | null;
  empty?: boolean;
  title?: string;
  customFields?: { bitStart?: number; bitCount?: number; name?: string }[];
}) {
  const value = Number(byteValue) & 0xff;
  const bitStr = byteToBitString(value);

  const bg = tagColor
    ? `var(--mantine-color-${tagColor}-light)`
    : 'var(--surface2)';

  const cellStyle = {
    cursor: empty ? 'default' : 'pointer',
    textAlign: 'center' as const,
    fontSize: 10,
    fontFamily: 'monospace',
    padding: showBits ? '3px 2px 2px' : '4px 0',
    borderRadius: 4,
    position: 'relative' as const,
    opacity: empty ? 0.3 : 1,
    background: bg,
    outline: compareMark != null ? '2px solid var(--mantine-color-pink-6)' : undefined,
    outlineOffset: compareMark != null ? -1 : undefined,
    border: showBits
      ? '1px solid var(--mantine-color-cyan-6)'
      : '1px solid var(--border)',
    userSelect: 'none' as const,
  };

  if (empty) {
    return <Box style={cellStyle} title={title}>··</Box>;
  }

  const customSuffix = customFields?.length
    ? <CustomBitSuffix byteValue={value} fields={customFields} />
    : null;

  const mark = compareMark != null ? (
    <Text
      span
      size="xs"
      fw={700}
      c="pink"
      style={{ position: 'absolute', top: -6, right: -2, fontSize: 8, lineHeight: 1 }}
    >
      {compareMark}
    </Text>
  ) : null;

  if (!showBits) {
    return (
      <Box style={cellStyle} onClick={() => onToggleBits?.()} title={title || 'Click to show bits'}>
        {hexByte(value)}
        {customSuffix}
        {suffix}
        {mark}
      </Box>
    );
  }

  return (
    <Box
      style={cellStyle}
      onClick={() => {
        if (!editable) onToggleBits?.();
      }}
      title={title || (editable ? 'Click a bit to toggle it, or hex to show hex' : 'Click to show hex')}
    >
      <Box
        style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1 }}
      >
        {BIT_ORDER.map((bitIdx) => {
          const bitVal = bitStr[7 - bitIdx];
          return (
            <Box
              key={bitIdx}
              onClick={(e) => {
                e.stopPropagation();
                if (editable && onByteChange) {
                  onByteChange((value ^ (1 << bitIdx)) & 0xff);
                  return;
                }
                onToggleBits?.();
              }}
              style={{
                textAlign: 'center',
                fontSize: 10,
                lineHeight: '16px',
                borderRadius: 2,
                cursor: 'pointer',
              }}
            >
              {bitVal}
            </Box>
          );
        })}
      </Box>
      <Text
        size="xs"
        ff="monospace"
        c="dimmed"
        ta="center"
        style={{ fontSize: 9, lineHeight: 1.2, marginTop: 2, cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onToggleBits?.();
        }}
      >
        {hexByte(value)}
      </Text>
      {customSuffix}
      {suffix}
      {mark}
    </Box>
  );
}

export function BitColumnHeader({
  index,
  showBits = false,
  onClick,
  children = null,
  constant = false,
  tagColor = undefined,
}: {
  index: number | string;
  showBits?: boolean;
  onClick?: () => void;
  children?: any;
  constant?: boolean;
  tagColor?: string;
}) {
  return (
    <Box
      onClick={onClick}
      title="Click to flip this column hex ↔ bits"
      style={{
        cursor: 'pointer',
        textAlign: 'center',
        fontSize: 10,
        fontFamily: 'monospace',
        padding: showBits ? '3px 2px 2px' : '4px 0',
        borderRadius: 4,
        background: tagColor
          ? `var(--mantine-color-${tagColor}-light)`
          : 'var(--surface2)',
        border: constant
          ? '1px solid var(--mantine-color-teal-6)'
          : showBits
            ? '1px solid var(--mantine-color-cyan-6)'
            : '1px solid var(--border)',
      }}
    >
      {index}
      {showBits && (
        <Box style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 1, marginTop: 1 }}>
          {BIT_ORDER.map((bitIdx) => (
            <Text key={bitIdx} size="xs" c="dimmed" ta="center" ff="monospace" style={{ fontSize: 8, lineHeight: 1 }}>
              {bitIdx}
            </Text>
          ))}
        </Box>
      )}
      {children}
    </Box>
  );
}
