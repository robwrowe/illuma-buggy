import React from 'react';
import { ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useAppStore } from '../../stores/store';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

export default function DiagnosticsScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { sheetsEndpoint, setSheetsEndpoint, mbUnmatchedLogEnabled, setMbUnmatchedLogEnabled, saveToStorage } = useAppStore();

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Capture Uploads</Text>
        <View style={s.wledField}>
          <Text style={s.rowLabel}>Sheets endpoint</Text>
          <TextInput style={s.wledInput} value={sheetsEndpoint} onChangeText={setSheetsEndpoint} onEndEditing={saveToStorage} placeholder="https://script.google.com/macros/s/…/exec" placeholderTextColor={colors.textMuted} autoCapitalize="none" autoCorrect={false} />
          <Text style={s.rowHint}>Apps Script Web App URL for raw capture uploads. Leave blank to queue locally.</Text>
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>BLE Diagnostics</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Log unmatched BLE Data packets</Text>
            <Text style={s.rowHint}>Runs while connected. Disable if it causes instability.</Text>
          </View>
          <Switch value={mbUnmatchedLogEnabled} onValueChange={setMbUnmatchedLogEnabled} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
      </View>
    </ScrollView>
  );
}
