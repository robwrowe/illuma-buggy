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
  createEmptySpeedBuckets,
  normalizeMbMapping,
  normalizeTimingModel,
} from '../../lib/ble/mbMapping';

const FADE_CURVE_OPTS = [
  { value: 'linear', label: 'Linear', searchText: 'linear' },
  { value: 'decelerating', label: 'Decelerating (dim shape)', searchText: 'decelerating non-linear' },
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
  const sb = m.speedBuckets || createEmptySpeedBuckets();
  const setBuckets = (patch) => set({ speedBuckets: { ...sb, ...patch } });

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

      <Text size="xs" fw={600} c="dimmed" mb={4}>Final-cycle stretch by fadeBits</Text>
      <Text size="xs" c="dimmed" mb={4}>
        fadeBits stretches the LAST flash cycle (the LED fades out during that stretch, rather than
        a separate fade phase after on-time ends). Value = extra seconds added to that one cycle.
        fadeBits=00 should stay 0. Lab-confirmed for E9 0E only.
      </Text>
      <SimpleGrid cols={4} spacing="xs" mb="xs">
        {[0, 1, 2, 3].map((i) => (
          <Field key={i} label={`fadeBits=${i}`}>
            <NumberInput
              size="xs"
              decimalScale={2}
              step={0.05}
              min={0}
              value={m.fadeBitsStretchSec?.[i] ?? 0}
              onChange={(v) => {
                const next = [...(m.fadeBitsStretchSec || [0, 0, 0, 0])];
                next[i] = Number(v) || 0;
                set({ fadeBitsStretchSec: next });
              }}
            />
          </Field>
        ))}
      </SimpleGrid>
      <Checkbox
        label="Apply stretch in extended-timeout mode"
        checked={!!m.fadeBitsStretchAppliesToExtended}
        onChange={(e) => set({ fadeBitsStretchAppliesToExtended: e.target.checked })}
        mb="sm"
      />
      {!m.fadeBitsStretchAppliesToExtended && (
        <Text size="xs" c="dimmed" mb="sm">
          Currently disabled — lab data for extended-mode + fadeBits=01 is inconsistent (flash
          counts varied 7 vs 13 across repeat sessions on an identical packet). Re-enable once
          that&apos;s resolved.
        </Text>
      )}

      <Field label="Dim curve during stretch">
        <SearchableSelect
          value={m.fadeCurve || 'linear'}
          onChange={(fadeCurve) => set({ fadeCurve })}
          options={FADE_CURVE_OPTS}
          allowEmpty={false}
        />
      </Field>
      {m.fadeCurve === 'decelerating' && (
        <Text size="xs" c="orange" mb="sm">
          Non-linear dim during the stretched final cycle is documented only — WLED still gets a
          single transition duration. Duration numbers are what we can match reliably.
        </Text>
      )}

      <Paper p="xs" withBorder bg="var(--bg)" mb="sm">
        <Checkbox
          label="Auto-set Strobe effect from decoded flash rate"
          checked={!!se.enabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            set({
              strobeEffect: { ...se, enabled },
              ...(enabled ? { speedBuckets: { ...sb, enabled: false } } : {}),
            });
          }}
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

      <Paper p="xs" withBorder bg="var(--bg)">
        <Checkbox
          label="Speed buckets (manual timing→field gate)"
          checked={!!sb.enabled}
          onChange={(e) => {
            const enabled = e.target.checked;
            set({
              speedBuckets: { ...sb, enabled },
              ...(enabled ? { strobeEffect: { ...se, enabled: false } } : {}),
            });
          }}
          mb="xs"
        />
        <Text size="xs" c="dimmed" mb="xs">
          Author-sized table: smallest maxByte ≥ timing key wins. Takes precedence over strobe when
          enabled. Optional maskBits lets you bucket on a sub-field of the timing byte.
        </Text>
        {sb.enabled && (
          <Stack gap="xs">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
              <Field label="WLED field">
                <SearchableSelect
                  value={sb.field || 'sx'}
                  onChange={(field) => setBuckets({ field: field || 'sx' })}
                  options={[
                    { value: 'sx', label: 'sx (speed)' },
                    { value: 'ix', label: 'ix (intensity)' },
                    { value: 'c1', label: 'c1' },
                    { value: 'c2', label: 'c2' },
                    { value: 'c3', label: 'c3' },
                  ]}
                  allowEmpty={false}
                />
              </Field>
              <Field label="Custom field">
                <TextInput
                  size="xs"
                  value={sb.field || 'sx'}
                  onChange={(e) => setBuckets({ field: e.target.value.trim() || 'sx' })}
                  placeholder="sx"
                  styles={{ input: { fontFamily: 'monospace' } }}
                />
              </Field>
            </SimpleGrid>
            <Checkbox
              label="Mask timing byte bits"
              checked={!!sb.maskBits}
              onChange={(e) => {
                if (e.target.checked) {
                  setBuckets({ maskBits: { bitStart: 0, bitCount: 4 } });
                } else {
                  const next = { ...sb };
                  delete next.maskBits;
                  set({ speedBuckets: next });
                }
              }}
            />
            {sb.maskBits && (
              <SimpleGrid cols={2} spacing="xs">
                <Field label="mask bitStart">
                  <NumberInput
                    size="xs"
                    min={0}
                    max={7}
                    value={sb.maskBits.bitStart ?? 0}
                    onChange={(v) => setBuckets({
                      maskBits: {
                        ...sb.maskBits,
                        bitStart: Math.min(7, Math.max(0, parseInt(v, 10) || 0)),
                      },
                    })}
                  />
                </Field>
                <Field label="mask bitCount">
                  <NumberInput
                    size="xs"
                    min={1}
                    max={8}
                    value={sb.maskBits.bitCount ?? 8}
                    onChange={(v) => setBuckets({
                      maskBits: {
                        ...sb.maskBits,
                        bitCount: Math.min(8, Math.max(1, parseInt(v, 10) || 1)),
                      },
                    })}
                  />
                </Field>
              </SimpleGrid>
            )}
            <Text size="xs" fw={600} c="dimmed">Buckets (maxByte → value)</Text>
            {(sb.buckets || []).map((b, i) => (
              <Group key={i} gap="xs" align="flex-end" wrap="wrap">
                <Field label="maxByte">
                  <NumberInput
                    size="xs"
                    min={0}
                    max={255}
                    value={b.maxByte ?? 255}
                    onChange={(v) => {
                      const buckets = [...(sb.buckets || [])];
                      buckets[i] = {
                        ...buckets[i],
                        maxByte: Math.min(255, Math.max(0, parseInt(v, 10) || 0)),
                      };
                      setBuckets({ buckets });
                    }}
                  />
                </Field>
                <Field label="value">
                  <NumberInput
                    size="xs"
                    value={b.value ?? 128}
                    onChange={(v) => {
                      const buckets = [...(sb.buckets || [])];
                      buckets[i] = { ...buckets[i], value: parseInt(v, 10) || 0 };
                      setBuckets({ buckets });
                    }}
                  />
                </Field>
                <AppButton
                  size="compact-xs"
                  variant="danger"
                  onClick={() => {
                    const buckets = (sb.buckets || []).filter((_, j) => j !== i);
                    setBuckets({ buckets: buckets.length ? buckets : [{ maxByte: 255, value: 128 }] });
                  }}
                >
                  Delete
                </AppButton>
              </Group>
            ))}
            <AppButton
              size="compact-xs"
              variant="default"
              onClick={() => setBuckets({
                buckets: [...(sb.buckets || []), { maxByte: 255, value: 128 }],
              })}
            >
              Add bucket
            </AppButton>
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
        Named on-time / final-cycle stretch formulas referenced by rules (like segment maps).
        Empty timing model on a rule uses firmware defaults (same as E9 05/09 standard — no stretch).
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
