import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ZonesScreen from '../screens/ZonesScreen';
import BleDataScreen from '../screens/more/BleDataScreen';
import BrightnessScreen from '../screens/more/BrightnessScreen';
import DiagnosticsScreen from '../screens/more/DiagnosticsScreen';
import GeneralScreen from '../screens/more/GeneralScreen';
import LogicBoardScreen from '../screens/more/LogicBoardScreen';
import MoreHomeScreen from '../screens/more/MoreHomeScreen';
import ParkShowsScreen from '../screens/more/ParkShowsScreen';
import PresetsConfigScreen from '../screens/more/PresetsConfigScreen';
import LiveLogScreen from '../screens/more/LiveLogScreen';
import { useTheme } from '../utils/theme';

const Stack = createNativeStackNavigator();

export default function MoreNavigator() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Stack.Navigator screenOptions={{
      headerStyle: { backgroundColor: colors.header },
      headerTintColor: colors.textPrimary,
      contentStyle: { backgroundColor: colors.background },
      // Nested stack under a tab with headerShown:false — apply inset so titles
      // sit below the status bar / notch instead of under it.
      safeAreaInsets: { top: insets.top },
    }}>
      <Stack.Screen name="MoreHome" component={MoreHomeScreen} options={{ title: 'More' }} />
      <Stack.Screen name="General" component={GeneralScreen} options={{ title: 'General' }} />
      <Stack.Screen name="PresetsConfig" component={PresetsConfigScreen} options={{ title: 'Presets' }} />
      <Stack.Screen name="Brightness" component={BrightnessScreen} />
      <Stack.Screen name="ParkShows" component={ParkShowsScreen} options={{ title: 'Park Shows' }} />
      <Stack.Screen name="BleData" component={BleDataScreen} options={{ title: 'BLE Data' }} />
      <Stack.Screen name="LogicBoard" component={LogicBoardScreen} options={{ title: 'Logic Board' }} />
      <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
      <Stack.Screen name="LiveLog" component={LiveLogScreen} options={{ title: 'Live Log' }} />
      <Stack.Screen name="Zones" component={ZonesScreen} options={{ title: 'Locations' }} />
    </Stack.Navigator>
  );
}
