import { Box, NumberInput, Paper, ScrollArea, Stack, Text, TextInput } from '@mantine/core';
import { Field } from '../../shared/Field';
import { AppButton } from '../../shared/styles';

export function PresetEffectTab({
  sel,
  setSel,
  setGlobal,
  wledEffects,
  effectFilter,
  onEffectFilterChange,
  filteredEffects,
}) {
  return (
    <Stack gap="sm" maw={520}>
      {sel.global.fx != null && sel.global.fx !== '' && (
        <Paper p="sm" radius="md" bg="var(--primary-dim)" style={{ border: '1px solid var(--border)' }}>
          <Text size="xs" c="dimmed" mb={2}>Selected</Text>
          <Text size="sm" fw={600}>
            {sel.global.fxName || 'Unnamed effect'}
            <Text component="span" fw={400} c="dimmed" ml={6}>#{sel.global.fx}</Text>
          </Text>
        </Paper>
      )}
      {wledEffects.length > 0 ? (
        <>
          <Field label={`Filter effects (${filteredEffects.length} of ${wledEffects.length})`}>
            <TextInput
              value={effectFilter}
              onChange={(e) => onEffectFilterChange(e.target.value)}
              placeholder="Type to filter by name or ID…"
            />
          </Field>
          <ScrollArea.Autosize mah={360} style={{ border: '1px solid var(--border)', borderRadius: 8 }}>
            {filteredEffects.length === 0 && (
              <Text p="md" size="sm" c="dimmed" ta="center">No effects match</Text>
            )}
            {filteredEffects.map((eff) => (
              <Box
                key={eff.id}
                onClick={() => setSel((s) => ({ ...s, global: { ...s.global, fx: eff.id, fxName: eff.name } }))}
                p="sm"
                style={{
                  cursor: 'pointer',
                  borderBottom: '1px solid var(--border)',
                  background: sel.global.fx === eff.id ? 'var(--primary-dim)' : 'transparent',
                  color: sel.global.fx === eff.id ? 'var(--primary)' : 'var(--text)',
                }}
              >
                <Text size="sm" component="span">{eff.name}</Text>
                <Text size="xs" c="dimmed" component="span" ml={6}>#{eff.id}</Text>
              </Box>
            ))}
          </ScrollArea.Autosize>
          {sel.global.fx != null && sel.global.fx !== '' && (
            <AppButton
              type="button"
              variant="default"
              size="compact-sm"
              onClick={() => setSel((s) => ({ ...s, global: { ...s.global, fx: undefined, fxName: '' } }))}
              style={{ alignSelf: 'flex-start' }}
            >
              Clear selection
            </AppButton>
          )}
        </>
      ) : (
        <Text size="xs" c="dimmed">
          Use WLED Connect in the left panel to fetch the effect list. Lists are cached in the browser after the first successful connect.
        </Text>
      )}
      <Box component="details">
        <Box component="summary" style={{ cursor: 'pointer', userSelect: 'none' }}>
          <Text size="sm" c="dimmed">Manual override</Text>
        </Box>
        <Stack gap="sm" mt="sm">
          <Field label="Effect name">
            <TextInput
              value={sel.global.fxName || ''}
              onChange={(e) => setGlobal('fxName', e.target.value)}
              placeholder="e.g. Rainbow"
            />
          </Field>
          <Field label="Effect ID">
            <NumberInput
              value={sel.global.fx ?? ''}
              onChange={(v) => setGlobal('fx', v === '' || v == null ? undefined : parseInt(String(v), 10))}
              placeholder="0"
              hideControls
            />
          </Field>
        </Stack>
      </Box>
    </Stack>
  );
}
