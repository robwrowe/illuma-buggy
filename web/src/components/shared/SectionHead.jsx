import { Text } from '@mantine/core';

export function SectionHead({ children }) {
  return (
    <Text
      size="xs"
      fw={700}
      c="dimmed"
      tt="uppercase"
      lts={0.6}
      mt="md"
      mb="xs"
    >
      {children}
    </Text>
  );
}
