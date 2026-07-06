import { Button, Paper } from '@mantine/core';

export function AppButton({ variant = 'default', children, style, ...props }) {
  const cfg = {
    primary: { variant: 'filled' },
    success: { variant: 'filled', color: 'green' },
    danger: { variant: 'light', color: 'red' },
    default: { variant: 'default' },
  }[variant] || { variant: 'default' };
  return (
    <Button {...cfg} style={style} {...props}>
      {children}
    </Button>
  );
}

export function AppCard({ children, style, ...props }) {
  return (
    <Paper p="md" mb="sm" style={style} {...props}>
      {children}
    </Paper>
  );
}
