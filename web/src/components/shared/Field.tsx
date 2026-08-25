import { Input, type InputWrapperProps } from '@mantine/core';

export function Field({ label, children, style, description, ...rest }: InputWrapperProps) {
  return (
    <Input.Wrapper label={label} description={description} mb="sm" style={style} {...rest}>
      {children}
    </Input.Wrapper>
  );
}
