import { useState } from 'react';
import {
  Checkbox,
  Group,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { Field } from '../shared/Field';
import { SearchableSelect } from '../shared/SearchableSelect';
import { SectionHead } from '../shared/SectionHead';
import { AppButton, AppCard } from '../shared/styles';
import {
  createEmptyTimingModel,
  normalizeMbMapping,
  normalizeTimingModel,
} from '../../lib/ble/mbMapping';

const FADE_CURVE_OPTS = [
  { value: 'linear', label: 'Linear', searchText: 'linear' },
  { value: 'decelerating', label: 'Decelerating (duration only)', searchText: 'decelerating non-linear' },
];

function TimingModelCard({
  model,
  effectOptions = [],
  onChange,
  onDuplicate,
  onDelete,
}) {
  const m = normalizeTimingModel(model);
  const set = (patch) => onChange(normalizeTimingModel({ ...m, ...patch }));
  const se = m.strobeEffect || {};
  const setStrobe = (patch) => set({ strobeEffect: { ...se, ...patch } });

  const fxOpts = (effectOptions || []).map((e) => ({
    value: String(e.id),
    label: e.name,
    searchText: `${e.id} ${e.name}`,
  }));

  return (
    <Paper p="sm" withBorder bg="var(--surface2)">
      <Group justify="space-between" mb="xs" wrap="wrap">
        <TextInput
          value={m.name}
          onChange={(e) => set({ name: e.target.value })}
          styles={{ input: { fontWeight: 700, fontSize: 13 } }}
          w={220}
        />
        <Group gap={4}>
          <Text size="xs" c="dimmed" ff="monospace">{m.id}</Text>
          <AppButton size="compact-xs" variant="default" onClick={onDuplicate}>Duplicate</AppButton>
          <AppButton size="compact-xs" variant="danger" onClick={onDelete}>Delete</AppButton>
        </Group>
      </Group>

      <Text size="xs" fw={600} c="dimmed" mb={4}>On-time multipliers</Text>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs" mb="sm">
        <Field label="multNormal">
          <NumberInput
            size="xs"
            decimalScale={2}
            step={0.1}
            min={0}
            value={m.multNormal}
            onChange={(v) => set({ multNormal: Number(v) || 0 })}
          />
        </Field>
        <Field label="multScaler">
          <NumberInput
            size="xs"
            decimalScale={2}
            step={0.1}
            min={0}
            value={m.multScaler}
            onChange={(v) => set({ multScaler: Number(v) || 0 })}
          />
        </Field>
        <Field label="multExtended">
          <NumberInput
            size="xs"
            decimalScale={2}
            step={0.1}
            min={0}
            value={m.multExtended}
            onChange={(v) => set({ multExtended: Number(v) || 0 })}
          />
        </Field>
        <Field label="t0 fallback (sec)">
          <NumberInput
            size="xs"
            decimalScale={2}
            step={0.5}
            min={0}
            value={m.t0FallbackSec}
            onChange={(v) => set({ t0FallbackSec: Number(v) || 0 })}
          />
        </Field>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs" mb="sm">
        <Field label="Fade step (sec / fadeBits)">
          <NumberInput
            size="xs"
            decimalScale={3}
            step={0.05}
            min={0}
            value={m.fadeStepSec}
            onChange={(v) => set({ fadeStepSec: Number(v) || 0 })}
          />
        </Field>
        <Field label="Fade curve">
          <SearchableSelect
            value={m.fadeCurve || 'linear'}
            onChange={(fadeCurve) => set({ fadeCurve })}
            options={FADE_CURVE_OPTS}
            allowEmpty={false}
          />
        </Field>
      </SimpleGrid>
      {m.fadeCurve === 'decelerating' && (
        <Text size="xs" c="orange" mb="sm">
          Non-linear fade is documented only — WLED still gets a single fade duration.
          Duration numbers are what we can match reliably.
        </Text>
      )}

      <Paper p="xs" withBorder bg="var(--bg)">
        <Checkbox
          label="Auto-set Strobe effect from decoded flash rate"
          checked={!!se.enabled}
          onChange={(e) => setStrobe({ enabled: e.target.checked })}
          mb="xs"
        />
        {se.enabled && (
          <Stack gap="xs">
            <Text size="xs" c="dimmed">
              Uses WLED Strobe: sx = 255 − 50 / flashRateHz (cycleTime = (255−sx)×20 ms).
            </Text>
            <Field label="Strobe effect">
              <SearchableSelect
                value={se.fx != null ? String(se.fx) : '23'}
                onChange={(v) => setStrobe({ fx: v === '' ? 23 : parseInt(v, 10) })}
                options={fxOpts}
                placeholder="Strobe"
                allowEmpty
              />
            </Field>
            <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
              <Field label="Normal Hz">
                <NumberInput
                  size="xs"
                  decimalScale={2}
                  step={0.1}
                  min={0.05}
                  value={se.flashRateNormalHz}
                  onChange={(v) => setStrobe({ flashRateNormalHz: Number(v) || 0.05 })}
                />
              </Field>
              <Field label="Scaler Hz">
                <NumberInput
                  size="xs"
                  decimalScale={2}
                  step={0.1}
                  min={0.05}
                  value={se.flashRateScalerHz}
                  onChange={(v) => setStrobe({ flashRateScalerHz: Number(v) || 0.05 })}
                />
              </Field>
              <Field label="Extended Hz">
                <NumberInput
                  size="xs"
                  decimalScale={2}
                  step={0.05}
                  min={0.05}
                  value={se.flashRateExtendedHz}
                  onChange={(v) => setStrobe({ flashRateExtendedHz: Number(v) || 0.05 })}
                />
              </Field>
            </SimpleGrid>
          </Stack>
        )}
      </Paper>
    </Paper>
  );
}

export function TimingModelEditor({ mb, effectOptions = [], onChange }) {
  const mapping = normalizeMbMapping(mb);
  const models = mapping.timingModels || [];
  const [selectedId, setSelectedId] = useState(models[0]?.id || null);
  const selected = models.find((m) => m.id === selectedId) || models[0] || null;

  const setModels = (next) => {
    onChange({ ...mapping, timingModels: next.map((m, i) => normalizeTimingModel(m, i)) });
  };

  const updateModel = (id, next) => {
    setModels(models.map((m) => (m.id === id ? next : m)));
  };

  const addModel = () => {
    const m = createEmptyTimingModel({ name: `Timing model ${models.length + 1}` });
    setModels([...models, m]);
    setSelectedId(m.id);
  };

  const duplicateModel = (model) => {
    const copy = normalizeTimingModel({
      ...JSON.parse(JSON.stringify(model)),
      id: undefined,
      name: `${model.name || 'Model'} copy`,
    });
    setModels([...models, copy]);
    setSelectedId(copy.id);
  };

  const deleteModel = (id) => {
    if (models.length <= 1) return;
    const next = models.filter((m) => m.id !== id);
    setModels(next);
    if (selectedId === id) setSelectedId(next[0]?.id || null);
  };

  return (
    <AppCard>
      <SectionHead title="Timing models" />
      <Text size="xs" c="dimmed" mb="sm">
        Named on-time / fade formulas referenced by rules (like segment maps). Empty timing
        model on a rule uses firmware defaults (same as E9 05/09 standard).
      </Text>
      <Group gap="xs" mb="sm" wrap="wrap">
        <AppButton size="compact-xs" onClick={addModel}>Add model</AppButton>
        {(models || []).map((m) => (
          <AppButton
            key={m.id}
            size="compact-xs"
            variant={m.id === selected?.id ? 'light' : 'default'}
            onClick={() => setSelectedId(m.id)}
          >
            {m.name || m.id}
          </AppButton>
        ))}
      </Group>
      {selected && (
        <TimingModelCard
          model={selected}
          effectOptions={effectOptions}
          onChange={(next) => updateModel(selected.id, next)}
          onDuplicate={() => duplicateModel(selected)}
          onDelete={() => deleteModel(selected.id)}
        />
      )}
    </AppCard>
  );
}
