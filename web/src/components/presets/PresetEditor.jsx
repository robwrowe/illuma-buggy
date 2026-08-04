import { Group, Paper, ScrollArea, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { AppButton } from '../shared/styles';
import { PRESET_SUB_TABS } from './presetModel';
import { PresetColorsTab } from './tabs/PresetColorsTab';
import { PresetEffectTab } from './tabs/PresetEffectTab';
import { PresetMapsTab } from './tabs/PresetMapsTab';
import { PresetMiscTab } from './tabs/PresetMiscTab';
import { PresetSegmentsTab } from './tabs/PresetSegmentsTab';

export function PresetEditor({
  sel,
  setSel,
  isNew,
  ptab,
  onPtabChange,
  setGlobal,
  setMemory,
  wledIp,
  onWledIpChange,
  wledEffects,
  wledPalettes,
  effectFilter,
  onEffectFilterChange,
  filteredEffects,
  paletteOptions,
  onApplyPalettePick,
  segmentMaps,
  zones,
  presetTestStatus,
  presetTestErr,
  onImportFromWled,
  onTest,
  onDelete,
  onDuplicate,
  onCancel,
  onSave,
  onOpenMapEditor,
}) {
  return (
    <ScrollArea style={{ flex: 1 }}>
      <Stack p="lg" gap="sm">
        <Group justify="space-between" align="center" wrap="nowrap">
          <TextInput
            value={sel.name}
            onChange={(e) => setSel({ ...sel, name: e.target.value })}
            placeholder="Preset name"
            size="md"
            fw={600}
            style={{ flex: 1, marginRight: 12 }}
          />
          <Group gap="xs" wrap="nowrap">
            <AppButton
              type="button"
              variant="default"
              size="compact-sm"
              onClick={onImportFromWled}
              title="Import live strip state from WLED"
            >
              Import from WLED
            </AppButton>
            <AppButton
              type="button"
              variant={presetTestStatus === 'ok' ? 'success' : 'primary'}
              size="compact-sm"
              onClick={() => onTest(sel)}
              disabled={presetTestStatus === 'testing'}
            >
              {presetTestStatus === 'testing' ? 'Testing…' : presetTestStatus === 'ok' ? 'Sent ✓' : 'Test on strip'}
            </AppButton>
            {!isNew && (
              <AppButton variant="danger" size="compact-sm" onClick={() => onDelete(sel.id)}>Delete</AppButton>
            )}
            {!isNew && (
              <AppButton variant="default" size="compact-sm" onClick={() => onDuplicate(sel)}>Duplicate</AppButton>
            )}
            <AppButton variant="default" size="compact-sm" onClick={onCancel}>Cancel</AppButton>
            <AppButton variant="primary" size="compact-sm" onClick={onSave}>Save</AppButton>
          </Group>
        </Group>

        {presetTestErr && (
          <Paper p="sm" radius="md" bg="#ef444422" style={{ border: '1px solid var(--danger)' }}>
            <Text size="sm" c="red">{presetTestErr}</Text>
          </Paper>
        )}
        {!presetTestErr && presetTestStatus === 'ok' && (
          <Text size="sm" c="green">Preset sent to WLED at {wledIp.trim()}.</Text>
        )}

        <Tabs value={ptab} onChange={onPtabChange}>
          <Tabs.List>
            {PRESET_SUB_TABS.map((t) => (
              <Tabs.Tab key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        {ptab === 'effect' && (
          <PresetEffectTab
            sel={sel}
            setSel={setSel}
            setGlobal={setGlobal}
            setMemory={setMemory}
            wledEffects={wledEffects}
            wledPalettes={wledPalettes}
            effectFilter={effectFilter}
            onEffectFilterChange={onEffectFilterChange}
            filteredEffects={filteredEffects}
            paletteOptions={paletteOptions}
            onApplyPalettePick={onApplyPalettePick}
          />
        )}
        {ptab === 'maps' && (
          <PresetMapsTab
            sel={sel}
            setSel={setSel}
            segmentMaps={segmentMaps}
            wledEffects={wledEffects}
            wledPalettes={wledPalettes}
            wledIp={wledIp}
            onWledIpChange={onWledIpChange}
            onOpenMapEditor={onOpenMapEditor}
          />
        )}
        {ptab === 'segments' && (
          <PresetSegmentsTab
            sel={sel}
            setSel={setSel}
            setMemory={setMemory}
            segmentMaps={segmentMaps}
            wledEffects={wledEffects}
            wledPalettes={wledPalettes}
          />
        )}
        {ptab === 'colors' && (
          <PresetColorsTab sel={sel} setSel={setSel} />
        )}
        {ptab === 'misc' && (
          <PresetMiscTab
            sel={sel}
            setSel={setSel}
            setMemory={setMemory}
            zones={zones}
          />
        )}
      </Stack>
    </ScrollArea>
  );
}
