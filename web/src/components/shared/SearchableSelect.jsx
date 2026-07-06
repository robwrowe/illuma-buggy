import { useMemo } from 'react';
import { Select } from '@mantine/core';

function toSelectData(options) {
  const opts = (options ?? []).filter((o) => o != null && o.value !== undefined && o.label != null);
  if (!opts.length) return [];

  const hasGroups = opts.some((o) => o.group);
  if (!hasGroups) {
    return opts.map((o) => ({ value: String(o.value), label: String(o.label) }));
  }

  const byGroup = new Map();
  for (const o of opts) {
    const g = o.group || '';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push({ value: String(o.value), label: String(o.label) });
  }

  const ungrouped = byGroup.get('') || [];
  byGroup.delete('');

  const grouped = [...byGroup.entries()].map(([group, items]) => ({ group, items }));

  return ungrouped.length ? [...grouped, ...ungrouped] : grouped;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyLabel = 'No matches',
  allowEmpty = true,
  maxListHeight = 240,
}) {
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
      comboboxProps={{ withinPortal: true }}
      maxDropdownHeight={maxListHeight}
    />
  );
}
