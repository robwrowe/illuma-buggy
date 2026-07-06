import { createTheme } from '@mantine/core';
import { darkColors } from './tokens';

/** Mantine defaults + Android dark palette via CSS variables only. */
export const appTheme = createTheme({
  primaryColor: 'violet',
  fontFamily: '-apple-system, system-ui, sans-serif',
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
    },
  };
}
