import { useMemo, useState } from 'react';
import { Group, NumberInput, Stack, Switch, Text, TextInput } from '@mantine/core';
import { AppButton, AppCard } from '../shared/styles';
import { generateId } from '../../lib/utils';
import {
  cueWarnings,
  describeCue,
  expandCueOccurrences,
  parkDateString,
  type CueAnchor,
  type ParkDaySchedule,
  type ShowCue,
} from '../../lib/cues';

function blank(parkId: string, bindingId?: string): ShowCue {
  return {
    id: generateId(),
    parkId,
    label: 'Cue',
    enabled: true,
    anchor: bindingId
      ? { type: 'show', bindingId, point: 'end' }
      : { type: 'parkClose', which: 'latest' },
    fromSec: 0,
    toSec: 600,
    conditions: [],
    priority: 0,
    action: { type: 'black', fadeSec: null },
    onEnd: 'release',
  };
}

export function CuesPanel({
  parkId,
  cues,
  bindings,
  presets,
  zones,
  timezone,
  schedule,
  cueMaxHoldSec,
  onChange,
}: {
  parkId: string;
  cues: ShowCue[];
  bindings: { id: string; name: string; durationSec?: number; liveOffsetSec?: number }[];
  presets: { id: string; name: string }[];
  zones: { id: string; name: string }[];
  timezone?: string;
  schedule: ParkDaySchedule | null;
  cueMaxHoldSec: number;
  onChange: (cues: ShowCue[]) => void;
}) {
  const parkCues = cues.filter((c) => c.parkId === parkId);
  const [editing, setEditing] = useState<ShowCue | null>(null);
  const tz = timezone || 'America/New_York';
  const known = {
    bindingIds: bindings.map((b) => b.id),
    zoneIds: zones.map((z) => z.id),
    presetIds: presets.map((p) => p.id),
  };

  const bars = useMemo(() => {
    const now = Date.now();
    const day = parkDateString(now, tz);
    const open = schedule?.operating[0]?.openMs ?? now;
    const close = schedule
      ? Math.max(
        ...schedule.operating.map((w) => w.closeMs),
        ...schedule.ticketed.filter((t) => t.kind === 'event').map((t) => t.closeMs),
        open + 3600_000,
      )
      : open + 12 * 3600_000;
    const span = Math.max(close - open, 1);
    const ctx = {
      now: open + span / 2,
      parkTz: tz,
      showInstances: [],
      schedule,
      instanceOverrides: {},
      cueMaxHoldSec,
      showsWithShowtimes: bindings.map((b) => b.id),
    };
    return parkCues.flatMap((cue, index) => expandCueOccurrences(cue, ctx, index).map((occ) => ({
      id: occ.key,
      label: cue.label,
      left: Math.max(0, (occ.startMs - open) / span) * 100,
      width: Math.max(1, ((occ.endMs - occ.startMs) / span) * 100),
      lane: cue.conditions.some((c) => c.type === 'zone') ? 1 : 0,
    }))).concat([{ id: 'day', label: day, left: 0, width: 0, lane: 0 }]).filter((b) => b.id !== 'day');
  }, [parkCues, schedule, tz, cueMaxHoldSec, bindings]);

  const save = (cue: ShowCue) => {
    const next = cues.some((c) => c.id === cue.id) ? cues.map((c) => (c.id === cue.id ? cue : c)) : [...cues, cue];
    onChange(next);
    setEditing(null);
  };

  return (
    <AppCard>
      <Text fw={700} size="sm" mb="xs">Cues</Text>
      <Text size="xs" c="dimmed" mb="xs">
        Anchor + window + action. No cues means today’s pre/live/post behavior.
        Future days can preview park hours; show instances exist only for today.
      </Text>
      <div style={{ position: 'relative', height: 48, background: '#1a1b1e', borderRadius: 6, marginBottom: 8 }}>
        {bars.map((bar) => (
          <div
            key={bar.id}
            title={bar.label}
            style={{
              position: 'absolute',
              left: `${bar.left}%`,
              width: `${bar.width}%`,
              top: bar.lane ? 26 : 6,
              height: 16,
              background: bar.lane ? '#fab005' : '#4dabf7',
              borderRadius: 3,
              overflow: 'hidden',
              fontSize: 10,
              color: '#111',
              paddingLeft: 4,
            }}
          >
            {bar.label}
          </div>
        ))}
      </div>
      <Stack gap={6}>
        {parkCues.map((cue) => {
          const anchor = cue.anchor;
          const action = cue.action;
          const binding = anchor.type === 'show' ? bindings.find((b) => b.id === anchor.bindingId)?.name : undefined;
          const preset = action.type === 'preset' ? presets.find((p) => p.id === action.presetId)?.name : undefined;
          const warnings = cueWarnings(cue, known);
          const noSchedule = (cue.anchor.type === 'parkClose' || cue.anchor.type === 'parkOpen') && !schedule;
          return (
            <AppButton key={cue.id} variant="default" onClick={() => setEditing(cue)} style={{ height: 'auto', textAlign: 'left' }}>
              <Text size="xs">{describeCue(cue, { binding, preset })}</Text>
              {warnings.map((w) => <Text key={w} size="xs" c="yellow">{w}</Text>)}
              {noSchedule ? <Text size="xs" c="yellow">No schedule for today</Text> : null}
            </AppButton>
          );
        })}
      </Stack>
      <Group mt="sm">
        <AppButton size="compact-sm" onClick={() => setEditing({ ...blank(parkId, bindings[0]?.id), label: 'Exit music', toSec: 240 })}>Exit music</AppButton>
        <AppButton size="compact-sm" onClick={() => setEditing({ ...blank(parkId), label: 'Kiss goodnight', anchor: { type: 'parkClose', which: 'latest' }, toSec: 600 })}>Park close</AppButton>
        <AppButton size="compact-sm" onClick={() => setEditing({
          ...blank(parkId, bindings[0]?.id),
          label: 'Before show',
          anchor: { type: 'show', bindingId: bindings[0]?.id ?? '', point: 'start' },
          fromSec: -1800,
          toSec: -1770,
        })}>Before show</AppButton>
      </Group>
      {editing ? (
        <CueFields
          cue={editing}
          bindings={bindings}
          presets={presets}
          zones={zones}
          onCancel={() => setEditing(null)}
          onDelete={() => { onChange(cues.filter((c) => c.id !== editing.id)); setEditing(null); }}
          onSave={save}
        />
      ) : null}
    </AppCard>
  );
}

function CueFields({
  cue, bindings, presets, zones, onSave, onDelete, onCancel,
}: {
  cue: ShowCue;
  bindings: { id: string; name: string }[];
  presets: { id: string; name: string }[];
  zones: { id: string; name: string }[];
  onSave: (cue: ShowCue) => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(cue);
  const setAnchor = (anchor: CueAnchor) => setDraft({ ...draft, anchor });
  return (
    <Stack gap={6} mt="sm">
      <TextInput label="Label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
      <Group>
        <AppButton size="compact-sm" onClick={() => setAnchor({ type: 'clock', time: '21:30' })}>Clock</AppButton>
        <AppButton size="compact-sm" onClick={() => setAnchor({ type: 'parkClose', which: 'latest' })}>Park close</AppButton>
        <AppButton size="compact-sm" onClick={() => setAnchor({ type: 'parkOpen', which: 'earliest' })}>Park open</AppButton>
        <AppButton size="compact-sm" onClick={() => setAnchor({ type: 'show', bindingId: bindings[0]?.id ?? '', point: 'end' })}>A show</AppButton>
      </Group>
      {draft.anchor.type === 'clock' ? (
        <TextInput label="HH:mm" value={draft.anchor.time} onChange={(e) => setAnchor({ type: 'clock', time: e.target.value })} />
      ) : null}
      {draft.anchor.type === 'show' ? (
        <Group>
          {bindings.map((b) => (
            <AppButton key={b.id} size="compact-sm" variant={draft.anchor.type === 'show' && draft.anchor.bindingId === b.id ? 'primary' : 'default'} onClick={() => setAnchor({ type: 'show', bindingId: b.id, point: draft.anchor.type === 'show' ? draft.anchor.point : 'end' })}>{b.name}</AppButton>
          ))}
          {(['start', 'live', 'end'] as const).map((point) => (
            <AppButton key={point} size="compact-sm" onClick={() => {
              if (draft.anchor.type !== 'show') return;
              setAnchor({ ...draft.anchor, point });
            }}>{point}</AppButton>
          ))}
        </Group>
      ) : null}
      <NumberInput
        label="Offset (minutes, negative = before)"
        value={Math.round(draft.fromSec / 60)}
        onChange={(v) => {
          const fromSec = Math.round(Number(v) * 60);
          const dur = draft.toSec == null ? null : draft.toSec - draft.fromSec;
          setDraft({ ...draft, fromSec, toSec: dur == null ? null : fromSec + dur });
        }}
      />
      <NumberInput
        label="Duration (minutes, empty = until next)"
        value={draft.toSec == null ? '' : Math.round((draft.toSec - draft.fromSec) / 60)}
        onChange={(v) => {
          if (v === '' || v == null) setDraft({ ...draft, toSec: null });
          else setDraft({ ...draft, toSec: draft.fromSec + Math.round(Number(v) * 60) });
        }}
      />
      <Text size="xs">Action</Text>
      <AppButton size="compact-sm" variant={draft.action.type === 'black' ? 'primary' : 'default'} onClick={() => setDraft({ ...draft, action: { type: 'black', fadeSec: null } })}>Black</AppButton>
      <Group>
        {presets.map((p) => (
          <AppButton key={p.id} size="compact-sm" variant={draft.action.type === 'preset' && draft.action.presetId === p.id ? 'primary' : 'default'} onClick={() => setDraft({ ...draft, action: { type: 'preset', presetId: p.id } })}>{p.name}</AppButton>
        ))}
      </Group>
      <Text size="xs">Only if inside</Text>
      <Group>
        {zones.map((z) => {
          const cond = draft.conditions.find((c) => c.type === 'zone');
          const on = cond?.type === 'zone' && cond.zoneIds.includes(z.id);
          return (
            <AppButton key={z.id} size="compact-sm" variant={on ? 'primary' : 'default'} onClick={() => {
              const ids = new Set(cond?.type === 'zone' ? cond.zoneIds : []);
              if (ids.has(z.id)) ids.delete(z.id); else ids.add(z.id);
              const rest = draft.conditions.filter((c) => c.type !== 'zone');
              setDraft({
                ...draft,
                priority: ids.size ? Math.max(draft.priority, 10) : draft.priority,
                conditions: ids.size ? [...rest, { type: 'zone', zoneIds: [...ids], match: 'inside' }] : rest,
              });
            }}>{z.name}</AppButton>
          );
        })}
      </Group>
      <Switch label="Release when done" checked={draft.onEnd === 'release'} onChange={(e) => setDraft({ ...draft, onEnd: e.currentTarget.checked ? 'release' : 'hold' })} />
      <Switch label="Enabled" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.currentTarget.checked })} />
      <Group>
        <AppButton onClick={() => onSave(draft)}>Save</AppButton>
        <AppButton color="red" onClick={onDelete}>Delete</AppButton>
        <AppButton variant="default" onClick={onCancel}>Cancel</AppButton>
      </Group>
    </Stack>
  );
}
