/**
 * theme.ts
 * Dark / light / system theme support.
 * Import useTheme() in any component to get colors + toggles.
 */

import { useColorScheme } from 'react-native';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'dark' | 'light' | 'system';

interface ThemeStore {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  loadMode: () => Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: 'dark',
  setMode: async (mode) => {
    set({ mode });
    await AsyncStorage.setItem('themeMode', mode);
  },
  loadMode: async () => {
    const saved = await AsyncStorage.getItem('themeMode');
    if (saved) set({ mode: saved as ThemeMode });
  },
}));

// ─────────────────────────────────────────────
// Color palettes
// ─────────────────────────────────────────────

export const darkColors = {
  background:    '#0a0a0f',
  surface:       '#12121e',
  surfaceAlt:    '#1a1a2e',
  border:        '#1a1a2e',
  borderFocus:   '#2a2a3e',
  primary:       '#a78bfa',
  primaryDim:    '#a78bfa22',
  success:       '#22c55e',
  warning:       '#f59e0b',
  danger:        '#ef4444',
  indoor:        '#60a5fa',
  textPrimary:   '#ffffff',
  textSecondary: '#9090b0',
  textMuted:     '#4a4a6a',
  tabBar:        '#0a0a0f',
  header:        '#0a0a0f',
};

export const lightColors = {
  background:    '#f4f4f8',
  surface:       '#ffffff',
  surfaceAlt:    '#e8e8f0',
  border:        '#dddde8',
  borderFocus:   '#c0c0d0',
  primary:       '#7c3aed',
  primaryDim:    '#7c3aed22',
  success:       '#16a34a',
  warning:       '#d97706',
  danger:        '#dc2626',
  indoor:        '#2563eb',
  textPrimary:   '#0a0a1a',
  textSecondary: '#4a4a6a',
  textMuted:     '#9090b0',
  tabBar:        '#ffffff',
  header:        '#ffffff',
};

export type Colors = typeof darkColors;

// ─────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────

export function useTheme() {
  const { mode, setMode } = useThemeStore();
  const systemScheme = useColorScheme();

  const isDark =
    mode === 'dark' ||
    (mode === 'system' && systemScheme === 'dark') ||
    (mode === 'system' && systemScheme == null);

  const colors: Colors = isDark ? darkColors : lightColors;

  return { colors, mode, setMode, isDark };
}
