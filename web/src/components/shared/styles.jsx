import { Button, Paper } from '@mantine/core';

export function AppButton({ children, ...props }) {
  return <Button {...props}>{children}</Button>;
}

export function AppCard({ children, ...props }) {
  return (
    <Paper
      p="md"
      withBorder
      style={{
        borderRadius: 'var(--mantine-radius-sm)',
        border: '1px solid var(--border)',
        background: 'var(--surface2)',
      }}
      {...props}
    >
      {children}
    </Paper>
  );
}
