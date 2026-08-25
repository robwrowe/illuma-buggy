import { Title } from '@mantine/core';
import type { ReactNode } from 'react';

export function SectionHead({ children, title }: { children?: ReactNode; title?: ReactNode }) {
  return <Title order={5}>{children ?? title}</Title>;
}
