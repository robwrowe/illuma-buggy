import { useMemo } from 'react';
import { Select } from '@mantine/core';

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyLabel = 'No matches',
  allowEmpty = true,
  maxListHeight = 240,
}) {
  const data = useMemo(() => options.map((o) => ({
      value: String(o.value),
      label: o.label,
    group: o.group || undefined,
  })), [options]);

  return (
    <Select
      searchable
      clearable={allowEmpty}
      value={value === '' || value == null ? null : String(value)}
      onChange={(v) => onChange(v ?? '')}
      data={data}
      placeholder={placeholder}
      nothingFoundMessage={emptyLabel}
      comboboxProps={{ withinPortal: true }}
      maxDropdownHeight={maxListHeight}
    />
  );
}
