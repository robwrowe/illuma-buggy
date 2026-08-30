import {
  Checkbox,
  createTheme,
  defaultVariantColorsResolver,
  Divider,
  Input,
  Paper,
  SegmentedControl,
  Table,
  type CSSVariablesResolver,
  type VariantColorsResolver,
} from '@mantine/core';
import { darkColors, lightColors } from './tokens';

const variantColorResolver: VariantColorsResolver = (input) => {
  const defaultResolvedColors = defaultVariantColorsResolver(input);
  const lightColor = defaultVariantColorsResolver({
    ...input,
    color: input.color || input.theme.primaryColor,
    variant: 'light',
  });

  const successColor = defaultVariantColorsResolver({
    ...input,
    color: 'green',
    variant: 'filled',
  });

  const dangerColor = defaultVariantColorsResolver({
    ...input,
    color: 'red',
    variant: 'light',
  });

  if (input.variant === 'default') {
    return {
      ...lightColor,
    };
  }

  if (input.variant === 'success') return { ...successColor };
  if (input.variant === 'danger') return { ...dangerColor };

  return defaultResolvedColors;
};

/** Mantine defaults + Android dark palette via CSS variables only. */
export const appTheme = createTheme({
  primaryColor: 'violet',
  defaultRadius: 'sm',
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
        root: { backgroundColor: 'var(--surface)', borderColor: 'var(--primary)' },
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
      styles: {
        root: {
          backgroundColor: 'light-dark(var(--mantine-color-violet-1), var(--mantine-color-violet-9))',
        },
      },
    }),
    Table: Table.extend({
      styles: {
        table: {
          '--table-striped-color': 'var(--table-stripe)',
          '--table-highlight-on-hover-color': 'var(--table-hover)',
        },
      },
    }),
  },
  variantColorResolver,
});

export const cssVariablesResolver: CSSVariablesResolver = (_theme) => {
  return {
    variables: {},
    light: {
      '--mantine-color-body': lightColors.background,
      '--mantine-color-text': lightColors.textPrimary,
      '--mantine-color-dimmed': lightColors.textSecondary,
      '--mantine-color-anchor': lightColors.primary,
      '--mantine-color-surface': lightColors.surface,
      '--table-striped-color': '#ddd6fe',
      '--table-highlight-on-hover-color': '#c4b5fd',
    },
    dark: {
      '--mantine-color-body': darkColors.background,
      '--mantine-color-text': darkColors.textPrimary,
      '--mantine-color-dimmed': darkColors.textSecondary,
      '--mantine-color-anchor': darkColors.primary,
      '--mantine-color-surface': darkColors.surfaceAlt,
      '--table-striped-color': '#2a2a48',
      '--table-highlight-on-hover-color': '#32325a',
    },
  };
};
