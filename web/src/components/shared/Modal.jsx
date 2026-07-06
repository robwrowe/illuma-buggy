import { Button, Group, Modal as MantineModal } from '@mantine/core';

export function Modal({ title, children, onClose, width = 400, opened = true }) {
  const size = width >= 520 ? 'lg' : width >= 440 ? 'md' : 'sm';
  return (
    <MantineModal opened={opened} onClose={onClose} title={title} size={size} zIndex={1000}>
      {children}
    </MantineModal>
  );
}

export function ModalBtns({ onCancel, onSave, saveLabel = 'Save' }) {
  return (
    <Group mt="sm" grow>
      <Button variant="default" onClick={onCancel}>Cancel</Button>
      <Button onClick={onSave}>{saveLabel}</Button>
    </Group>
  );
}
