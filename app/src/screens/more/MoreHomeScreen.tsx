import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../utils/theme';
import { moreStyles } from './moreStyles';

const MORE_DESTINATIONS = [
  ['General', 'Appearance, device, sync, and data'],
  ['PresetsConfig', 'Preset recall and override behavior'],
  ['Brightness', 'Day, night, and indoor brightness'],
  ['ParkShows', 'Show preset assignments'],
  ['BleData', 'Calibration and BLE mapping'],
  ['LogicBoard', 'Board mode, HTTP address, and WLED network'],
  ['Diagnostics', 'Capture diagnostics'],
  ['LiveLog', 'Real-time BLE command and status log'],
  ['Zones', 'Edit location zones'],
] as const;

export default function MoreHomeScreen({ navigation }: { navigation: any }) {
  const { colors } = useTheme();
  const s = moreStyles(colors);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.section}>
        <Text style={s.sectionTitle}>More</Text>
        {MORE_DESTINATIONS.map(([route, hint]) => (
          <TouchableOpacity key={route} style={s.row} onPress={() => navigation.navigate(route)}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>{route === 'PresetsConfig' ? 'Presets' : route === 'BleData' ? 'BLE Data' : route === 'LogicBoard' ? 'Logic Board' : route === 'ParkShows' ? 'Park Shows' : route === 'LiveLog' ? 'Live Log' : route}</Text>
              <Text style={s.rowHint}>{hint}</Text>
            </View>
            <Text style={{ color: colors.primary, fontSize: 20 }}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}
