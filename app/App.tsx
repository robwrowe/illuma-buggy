import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { enableScreens } from 'react-native-screens';
import {
  IconHome, IconSparkles, IconMap, IconSettings,
} from '@tabler/icons-react-native';

enableScreens();

import { bleService } from './src/services/BLEService';
import { useAppStore } from './src/stores/store';
import { useZoneManager } from './src/hooks/useZoneManager';
import { useTheme, useThemeStore } from './src/utils/theme';

import HomeScreen     from './src/screens/HomeScreen';
import PresetsScreen  from './src/screens/PresetsScreen';
import ZonesScreen    from './src/screens/ZonesScreen';
import SettingsScreen from './src/screens/SettingsScreen';

const Tab = createBottomTabNavigator();

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
            if (route.name === 'Zones')    return <IconMap size={size} color={color} />;
            if (route.name === 'Settings') return <IconSettings size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Home"     component={HomeScreen} />
        <Tab.Screen name="Presets"  component={PresetsScreen} />
        <Tab.Screen name="Zones"    component={ZonesScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  const { loadFromStorage, setPresets, setDeviceStatus } = useAppStore();
  const { loadMode } = useThemeStore();
  const { isDark } = useTheme();

  useEffect(() => {
    loadFromStorage();
    loadMode();

    const unsub = bleService.onMessage((msg) => {
      if (msg.type === 'preset_list') {
        setPresets(msg.presets as import('./src/stores/store').Preset[]);
      }
      if (msg.type === 'status') {
        setDeviceStatus({
          override:      msg.override as number,
          killOnZone:    msg.kill_on_zone as boolean,
          brightness:    msg.brightness as number,
          currentPreset: msg.preset as string,
          wifiConnected: msg.wifi as boolean,
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
