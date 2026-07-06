import { Input } from '@mantine/core';

export function Field({ label, children, style = {}, description }) {
  return (
    <Input.Wrapper label={label} description={description} mb="sm" style={style}>
      {children}
    </Input.Wrapper>
  );
}
