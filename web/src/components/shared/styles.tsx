import { Button, Paper, type ButtonProps, type ElementProps, type PaperProps } from '@mantine/core';

type AppButtonProps = ButtonProps & ElementProps<'button', keyof ButtonProps>;
type AppCardProps = PaperProps & ElementProps<'div', keyof PaperProps>;

export function AppButton(props: AppButtonProps) {
  return <Button {...props} />;
}

export function AppCard(props: AppCardProps) {
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
    />
  );
}
