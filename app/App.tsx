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
import IconBolt     from '@tabler/icons-react-native/dist/esm/icons/IconBolt';

import { bleService } from './src/services/BLEService';
import { useAppStore, mbMappingToBlePayload } from './src/stores/store';
import { useZoneManager } from './src/hooks/useZoneManager';
import { useTheme, useThemeStore } from './src/utils/theme';

import HomeScreen     from './src/screens/HomeScreen';
import BleCaptureScreen from './src/screens/BleCaptureScreen';
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
            if (route.name === 'Capture')   return <IconBolt size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home"     component={HomeScreen} />
        <Tab.Screen name="Capture"  component={BleCaptureScreen} options={{ title: 'BLE Capture' }} />
        <Tab.Screen name="Presets"  component={PresetsScreen} />
        <Tab.Screen name="Library"  component={LibraryScreen} />
        <Tab.Screen name="Zones"    component={ZonesWrapper} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
        <Tab.Screen name="Palettes"  component={PalettesScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

function formatBleEffectLabel(msg: Record<string, unknown>): string | null {
  if (msg.type === 'ble_color') {
    return `Color RGB(${msg.r}, ${msg.g}, ${msg.b})`;
  }
  if (msg.type === 'ble_event') {
    const ev = String(msg.event ?? 'effect');
    const labels: Record<string, string> = {
      rgb: 'Raw RGB',
      five_color: 'Five-color pattern',
      show_fx: 'Show FX',
      flash: 'Flash',
      animation: 'Animation',
      show: 'Park show',
    };
    return labels[ev] ?? ev.replace(/_/g, ' ');
  }
  if (msg.type === 'sw_color') {
    return `Wand palette ${msg.palette} → RGB(${msg.r}, ${msg.g}, ${msg.b})`;
  }
  if (msg.type === 'sw_event') {
    return `Wand: ${String(msg.event)}`;
  }
  return null;
}

export default function App() {
  const {
    loadFromStorage, setDeviceStatus, setOverrideDetail,
    ingestWledEffectsRaw, ingestWledPalettesRaw, ingestWledFxDataRaw, syncBoardPresets,
    appendBleCapturePacket, stopBleCapture,
  } = useAppStore();
  const { loadMode } = useThemeStore();
  const { isDark } = useTheme();

  useEffect(() => {
    loadFromStorage();
    loadMode();

    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'preset_list_raw') {
        console.log('[App] Board presets received:', (msg.raw as string)?.length, 'bytes');
        syncBoardPresets(msg.raw as string);
      }
      if (msg.type === 'wled_effects_done') {
        ingestWledEffectsRaw(msg.raw as string);
      }
      if (msg.type === 'wled_palettes_done') {
        ingestWledPalettesRaw(msg.raw as string);
      }
      if (msg.type === 'wled_fxdata_done') {
        ingestWledFxDataRaw(msg.raw as string);
      }
      if (msg.type === 'ble_packet') {
        appendBleCapturePacket({
          boardTs: msg.ts as number,
          tag: String(msg.tag ?? 'DISNEY'),
          rssi: msg.rssi as number,
          hex: String(msg.hex ?? ''),
          len: msg.len as number,
        });
      }
      if (msg.type === 'ble_capture') {
        const event = String(msg.event ?? '');
        if (event === 'stopped') {
          stopBleCapture(String(msg.reason ?? 'board'));
        }
      }
      const effectLabel = formatBleEffectLabel(msg);
      if (effectLabel) setOverrideDetail(effectLabel);
      if (msg.type === 'status') {
        const override = msg.override as number;
        setDeviceStatus({
          override,
          killOnZone:         msg.kill_on_zone as boolean,
          brightness:         msg.brightness as number,
          currentPreset:      msg.preset as string,
          wifiConnected:      msg.wifi as boolean,
          starlightEnabled:   msg.sw_enabled as boolean,
          starlightTimeoutMs: msg.sw_timeout_ms as number,
          magicBandEnabled:   msg.mb_enabled as boolean,
          mbFivePoint:        msg.mb_five_point as boolean,
          mbTimeoutMs:        msg.mb_timeout_ms as number,
          showType:           msg.show_type as string | undefined,
          showPhase:          msg.show_phase as string | undefined,
        });
        if (override === 0) setOverrideDetail(null);
      }
    });

    const unsubState = bleService.onStateChange(async (state) => {
      if (state !== 'connected') return;
      const s = useAppStore.getState();
      await bleService.sendSwConfig(s.starlightEnabled, s.starlightTimeoutSec * 1000);
      await bleService.sendMbConfig(s.magicBandEnabled, s.magicBandFivePoint, s.magicBandTimeoutSec * 1000);
      await bleService.sendBleEffectConfig(s.bleEffectTransitionMs);
      await bleService.sendMbMappingConfig(mbMappingToBlePayload(s.mbMapping));
      await bleService.sendShowModeConfig(s.showModeConfig);
      await new Promise(r => setTimeout(r, 400));
      await bleService.sendPresetList();
      if (s.wledEffects.length === 0) {
        await bleService.sendGetFxData();
        await bleService.sendGetEffects();
        await bleService.sendGetPalettes();
      }
    });

    bleService.connect();
    return () => { unsub(); unsubState(); };
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
