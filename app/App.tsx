import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { enableScreens } from 'react-native-screens';
import { View, Text, StyleSheet } from 'react-native';

enableScreens();

import IconHome     from '@tabler/icons-react-native/dist/esm/icons/IconHome';
import IconSparkles from '@tabler/icons-react-native/dist/esm/icons/IconSparkles';
import IconMap      from '@tabler/icons-react-native/dist/esm/icons/IconMap';
import IconSettings from '@tabler/icons-react-native/dist/esm/icons/IconSettings';
import IconBook     from '@tabler/icons-react-native/dist/esm/icons/IconBook';
import IconDroplet  from '@tabler/icons-react-native/dist/esm/icons/IconDroplet';

import { bleService } from './src/services/BLEService';
import { useAppStore } from './src/stores/store';
import { useZoneManager } from './src/hooks/useZoneManager';
import { useTheme, useThemeStore } from './src/utils/theme';
import { buildRecallPayload } from './src/stores/store';

import HomeScreen     from './src/screens/HomeScreen';
import PresetsScreen  from './src/screens/PresetsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import LibraryScreen  from './src/screens/LibraryScreen';
import PalettesScreen from './src/screens/PalettesScreen';

const ZonesScreen = React.lazy(() => import('./src/screens/ZonesScreen'));

const Tab = createBottomTabNavigator();

function ZonesWrapper() {
  return (
    <React.Suspense fallback={
      <View style={styles.centered}>
        <Text style={styles.loadingText}>Loading map…</Text>
      </View>
    }>
      <ZonesScreen />
    </React.Suspense>
  );
}

function AppNavigator() {
  useZoneManager();
  const { colors, isDark } = useTheme();

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: colors.background,
      card:       colors.tabBar,
      text:       colors.textPrimary,
      border:     colors.border,
      primary:    colors.primary,
    },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          tabBarStyle:             { backgroundColor: colors.tabBar, borderTopColor: colors.border },
          tabBarActiveTintColor:   colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          headerStyle:             { backgroundColor: colors.header },
          headerTintColor:         colors.textPrimary,
          tabBarIcon: ({ color, size }) => {
            if (route.name === 'Home')     return <IconHome size={size} color={color} />;
            if (route.name === 'Presets')  return <IconSparkles size={size} color={color} />;
            if (route.name === 'Library')  return <IconBook size={size} color={color} />;
            if (route.name === 'Zones')    return <IconMap size={size} color={color} />;
            if (route.name === 'Settings') return <IconSettings size={size} color={color} />;
          if (route.name === 'Palettes')  return <IconDroplet size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home"     component={HomeScreen} />
        <Tab.Screen name="Presets"  component={PresetsScreen} />
        <Tab.Screen name="Library"  component={LibraryScreen} />
        <Tab.Screen name="Zones"    component={ZonesWrapper} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
        <Tab.Screen name="Palettes"  component={PalettesScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const { loadFromStorage, setPresets, setDeviceStatus, recallState, presets } = useAppStore();
  const { loadMode } = useThemeStore();
  const { isDark } = useTheme();

  useEffect(() => {
    loadFromStorage();
    loadMode();

    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'preset_list_raw') {
        try {
          const parsed = JSON.parse(msg.raw as string);
          console.log('[App] Presets received:', Array.isArray(parsed) ? parsed.length : 'not array');
          setPresets(Array.isArray(parsed) ? parsed : []);
        } catch (e) {
          console.error('[App] Preset parse error:', e);
        }
      }
      if (msg.type === 'status') {
        setDeviceStatus({
          override:      msg.override as number,
          killOnZone:    msg.kill_on_zone as boolean,
          brightness:    msg.brightness as number,
          currentPreset: msg.preset as string,
          wifiConnected: msg.wifi as boolean,
          mbFivePoint:   msg.mb_five_point as boolean,
        });
      }
    });

    bleService.connect();
    return () => unsub();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  centered:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0f' },
  loadingText: { color: '#9090b0', fontSize: 14 },
});
