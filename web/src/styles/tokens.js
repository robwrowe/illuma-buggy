/**
 * Color tokens from app/src/utils/theme.ts (Android app).
 * Legacy `colors` aliases keep map/sidebar CSS vars working during migration.
 */

/** @type {const} */
export const darkColors = {
  background: '#0a0a0f',
  surface: '#12121e',
  surfaceAlt: '#1a1a2e',
  border: '#1a1a2e',
  borderFocus: '#2a2a3e',
  primary: '#a78bfa',
  primaryDim: '#a78bfa22',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  indoor: '#60a5fa',
  textPrimary: '#ffffff',
  textSecondary: '#9090b0',
  textMuted: '#4a4a6a',
  tabBar: '#0a0a0f',
  header: '#0a0a0f',
};

/** @deprecated Prefer darkColors — kept for var(--surface) etc. in map/sidebar */
export const colors = {
  bg: darkColors.background,
  surface: darkColors.surface,
  surface2: darkColors.surfaceAlt,
  border: darkColors.borderFocus,
  primary: darkColors.primary,
  primaryDim: darkColors.primaryDim,
  success: darkColors.success,
  warning: darkColors.warning,
  danger: darkColors.danger,
  text: darkColors.textPrimary,
  text2: darkColors.textSecondary,
  text3: darkColors.textMuted,
  indoor: darkColors.indoor,
};
