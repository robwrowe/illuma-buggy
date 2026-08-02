import React from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { MbMappingSections } from '../MbMappingSections';
import { useBLE } from '../../hooks/useBLE';
import { useAppStore } from '../../stores/store';
import { bleService } from '../../services/BLEService';
import { normalizeColorCalibration } from '../../utils/colorCalibration';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

export default function BleDataScreen() {
  const { colors } = useTheme();
  const s = moreStyles(colors);
  const { isConnected } = useBLE();
  const { colorCalibration, setColorCalibration, saveToStorage } = useAppStore();
  const updateCalibration = (enabled: boolean) => {
    const next = normalizeColorCalibration({ ...colorCalibration, enabled });
    setColorCalibration(next);
    if (isConnected) void bleService.sendColorCalibration(next);
    saveToStorage();
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>BLE Data</Text>
        <View style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowLabel}>Apply RGB curves</Text>
            <Text style={s.rowHint}>Curves are edited in the web tool. Turn off to troubleshoot colors in the field.</Text>
          </View>
          <Switch value={colorCalibration.enabled} onValueChange={updateCalibration} trackColor={{ false: colors.borderFocus, true: colors.primary }} thumbColor="#fff" />
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>BLE Data Mapping</Text>
        <Text style={s.sectionHint}>Default preset and BLE Data color table.</Text>
        <MbMappingSections colors={colors} isConnected={isConnected} />
      </View>
    </ScrollView>
  );
}
