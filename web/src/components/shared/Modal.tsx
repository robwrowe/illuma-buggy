import { Button, Group, Modal as MantineModal } from '@mantine/core';
import type { ReactNode } from 'react';

export function Modal({
  title,
  children,
  onClose,
  width = 400,
  opened = true,
}: {
  title?: ReactNode;
  children?: ReactNode;
  onClose: () => void;
  width?: number;
  opened?: boolean;
}) {
  const size = width >= 520 ? 'lg' : width >= 440 ? 'md' : 'sm';
  return (
    <MantineModal opened={opened} onClose={onClose} title={title} size={size} zIndex={1000}>
      {children}
    </MantineModal>
  );
}

export function ModalBtns({
  onCancel,
  onSave,
  saveLabel = 'Save',
}: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <Group mt="sm" grow>
      <Button variant="default" onClick={onCancel}>Cancel</Button>
      <Button onClick={onSave}>{saveLabel}</Button>
    </Group>
  );
}
