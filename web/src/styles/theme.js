import {
  Checkbox,
  createTheme,
  defaultVariantColorsResolver,
  Divider,
  Input,
  Paper,
  parseThemeColor,
  SegmentedControl,
} from '@mantine/core';
import { darkColors } from './tokens';

const variantColorResolver = (input) => {
  const defaultResolvedColors = defaultVariantColorsResolver(input);
  const lightColor = parseThemeColor({
    color: input.color || input.theme.primaryColor,
    theme: input.theme,
    variant: 'light',
  });

  if (input.variant === 'default') {
    return {
      ...lightColor,
      color: 'light-dark(var(--mantine-color-black), var(--mantine-color-white))',
    };
  }

  return defaultResolvedColors;
};

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
    dark: [
      '#f3f2f8',
      '#e3e1e9',
      '#c5c0d5',
      '#a69dc0',
      '#8b7faf',
      '#7a6ca4',
      '#7262a0',
      '#61528c',
      '#56497e',
      '#251f38',
    ],
  },
  headings: {
    fontFamily: 'Poppins, -apple-system, system-ui, sans-serif',
  },
  fontFamily: 'Inter, -apple-system, system-ui, sans-serif',

  components: {
    Divider: Divider.extend({
      defaultProps: { color: 'violet' },
      styles: {
        root: { borderColor: 'var(--mantine-primary-color-light)' },
        label: { color: 'var(--mantine-primary-color-light-color)' },
      },
    }),
    Paper: Paper.extend({
      styles: {
        root: { backgroundColor: 'var(--mantine-color-dark-9)', borderColor: 'var(--primary)' },
      },
    }),
    Input: Input.extend({
      styles: {
        input: {
          backgroundColor: 'var(--primary-dim)',
          borderColor: 'var(--primary-dim)',
          '&::placeholder': {
            color: 'var(--primary-dim) !important',
          },
        },
      },
    }),
    Checkbox: Checkbox.extend({
      styles: { input: { backgroundColor: 'var(--primary-dim) !important' } },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { color: 'violet.6' },
      styles: { root: { backgroundColor: 'var(--mantine-color-violet-9)' } },
    }),
  },
  variantColorResolver,
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
