import { useMemo } from 'react';
import { Select, type ComboboxItem, type ComboboxItemGroup, type SelectProps } from '@mantine/core';
import type { SearchableSelectOption } from '../../types/app';

type ComboboxGroup = ComboboxItemGroup<ComboboxItem>;
type SelectData = Array<string | ComboboxItem | ComboboxGroup>;

function toSelectData(options?: SearchableSelectOption[] | null): SelectData {
  const opts = (options ?? []).filter((o) => o != null && o.value !== undefined && o.label != null);
  if (!opts.length) return [];

  const hasGroups = opts.some((o) => o.group);
  if (!hasGroups) {
    return opts.map((o) => ({ value: String(o.value), label: String(o.label) }));
  }

  const byGroup = new Map<string, ComboboxItem[]>();
  for (const o of opts) {
    const g = o.group || '';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push({ value: String(o.value), label: String(o.label) });
  }

  const ungrouped = byGroup.get('') || [];
  byGroup.delete('');

  const grouped: ComboboxGroup[] = [...byGroup.entries()].map(([group, items]) => ({ group, items }));

  return ungrouped.length ? [...grouped, ...ungrouped] : grouped;
}

type Props = Omit<SelectProps, 'data' | 'onChange' | 'value'> & {
  value?: string | number | null;
  onChange?: (value: string) => void;
  options?: SearchableSelectOption[] | null;
  emptyLabel?: string;
  allowEmpty?: boolean;
  maxListHeight?: number;
};

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyLabel = 'No matches',
  allowEmpty = true,
  maxListHeight = 240,
  comboboxProps,
  ...rest
}: Props) {
  const data = useMemo(() => toSelectData(options), [options]);

  return (
    <Select
      searchable
      clearable={allowEmpty}
      value={value === '' || value == null ? null : String(value)}
      onChange={(v) => onChange?.(v ?? '')}
      data={data}
      placeholder={placeholder}
      nothingFoundMessage={emptyLabel}
      // Above shared Modal (zIndex 1000) so dropdowns aren't clipped under it
      comboboxProps={{ withinPortal: true, zIndex: 1100, ...comboboxProps }}
      maxDropdownHeight={maxListHeight}
      {...rest}
    />
  );
}
