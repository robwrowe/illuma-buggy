import { createTheme } from '@mantine/core';
import { darkColors } from './tokens';

/** Mantine defaults + Android dark palette via CSS variables only. */
export const appTheme = createTheme({
  primaryColor: 'violet',
  colors: {
    violet: [
      '#f3eeff',
      '#e1daf7',
      '#c0b3e9',
      '#9d89db',
      '#8065cf',
      '#6d4ec8',
      '#5f3dc4',
      '#5335af',
      '#492e9d',
      '#3e268b',
    ],
  },
  headings: {
    fontFamily: 'Poppins, -apple-system, system-ui, sans-serif',
  },
  fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
});

export function cssVariablesResolver(_theme) {
  return {
    variables: {},
    light: {},
    dark: {
      '--mantine-color-body': darkColors.background,
      '--mantine-color-text': darkColors.textPrimary,
      '--mantine-color-dimmed': darkColors.textSecondary,
      '--mantine-color-anchor': darkColors.primary,
      '--mantine-color-surface': darkColors.surfaceAlt,
    },
  };
}
