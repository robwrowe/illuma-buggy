import { createTheme } from '@mantine/core';
import { colors, radius, spacing } from './tokens';

export const appTheme = createTheme({
  primaryColor: 'violet',
  primaryShade: 4,
  defaultRadius: 'md',
  fontFamily: '-apple-system, system-ui, sans-serif',
  spacing,
  radius,
  black: colors.bg,
  white: colors.text,
  colors: {
    dark: [
      colors.bg,
      colors.surface,
      colors.surface2,
      colors.border,
      colors.text3,
      colors.text2,
      colors.text,
      colors.text,
      colors.text,
      colors.text,
    ],
    violet: [
      '#f5f3ff',
      '#ede9fe',
      '#ddd6fe',
      '#c4b5fd',
      colors.primary,
      '#8b5cf6',
      '#7c3aed',
      '#6d28d9',
      '#5b21b6',
      '#4c1d95',
    ],
    green: [
      '#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', colors.success,
      '#16a34a', '#15803d', '#166534', '#14532d', '#052e16',
    ],
    red: [
      '#fef2f2', '#fee2e2', '#fecaca', '#fca5a5', colors.danger,
      '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a',
    ],
  },
  components: {
    AppShell: {
      styles: {
        header: {
          backgroundColor: colors.surface,
          borderBottom: `1px solid ${colors.border}`,
        },
        main: {
          backgroundColor: colors.bg,
        },
      },
    },
    Modal: {
      defaultProps: {
        overlayProps: { backgroundOpacity: 0.75, blur: 2 },
        centered: true,
      },
      styles: {
        content: {
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
        },
        header: {
          backgroundColor: colors.surface,
        },
        title: {
          fontWeight: 700,
        },
      },
    },
    Tabs: {
      styles: {
        tab: {
          fontWeight: 600,
          fontSize: 12,
        },
      },
    },
    Paper: {
      defaultProps: {
        withBorder: true,
      },
      styles: {
        root: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      },
    },
    Button: {
      defaultProps: {
        radius: 'md',
      },
    },
    TextInput: {
      styles: {
        input: {
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          color: colors.text,
        },
      },
    },
    NumberInput: {
      styles: {
        input: {
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          color: colors.text,
        },
      },
    },
    Textarea: {
      styles: {
        input: {
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          color: colors.text,
        },
      },
    },
    Select: {
      styles: {
        input: {
          backgroundColor: colors.surface2,
          borderColor: colors.border,
          color: colors.text,
        },
        dropdown: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      },
    },
    Checkbox: {
      styles: {
        input: {
          borderColor: colors.border,
        },
      },
    },
  },
  other: {
    appColors: colors,
  },
});
