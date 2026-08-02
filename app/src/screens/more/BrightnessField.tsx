import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

type Colors = ReturnType<typeof import('../../utils/theme').useTheme>['colors'];

export default function BrightnessField({ label, hint, value, onChange, colors }: {
  label: string;
  hint: string;
  value: number;
  onChange: (val: string) => void;
  colors: Colors;
}) {
  const s = StyleSheet.create({
    field: { gap: 4 },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    label: { color: colors.textPrimary, fontSize: 14, fontWeight: '500' },
    hint: { color: colors.textMuted, fontSize: 12 },
    input: { backgroundColor: colors.background, borderRadius: 8, borderWidth: 1, borderColor: colors.borderFocus, color: colors.textPrimary, padding: 8, fontSize: 14, width: 72, textAlign: 'right' },
  });

  return (
    <View style={s.field}>
      <View style={s.header}>
        <Text style={s.label}>{label}</Text>
        <TextInput style={s.input} value={String(value)} onChangeText={onChange} keyboardType="number-pad" selectTextOnFocus />
      </View>
      <Text style={s.hint}>{hint}</Text>
    </View>
  );
}
