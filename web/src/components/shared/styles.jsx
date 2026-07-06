import { Button, Paper } from '@mantine/core';

export function AppButton({ variant = 'default', children, ...props }) {
  const cfg = {
    primary: { variant: 'filled' },
    success: { variant: 'filled', color: 'green' },
    danger: { variant: 'light', color: 'red' },
    default: { variant: 'default' },
  }[variant] || { variant: 'default' };
  return (
    <Button {...cfg} {...props}>
      {children}
    </Button>
  );
}

export function AppCard({ children, ...props }) {
  return (
    <Paper p="md" mb="sm" withBorder {...props}>
      {children}
    </Paper>
  );
}
