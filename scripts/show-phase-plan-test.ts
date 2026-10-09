/**
 * Binding defaults and show-phase command selection.
 * Run: node web/node_modules/tsx/dist/cli.mjs scripts/show-phase-plan-test.ts
 */
import assert from 'node:assert/strict';
import { DEFAULT_SHOW_SETTINGS, normalizeShowBinding } from '../app/src/utils/showBindings.ts';
import { ftbDurationMs, planShowPhase } from '../app/src/utils/showPhasePlan.ts';
import { normalizeShowBinding as normalizeWeb } from '../web/src/lib/map/themeParks.ts';

const old = normalizeShowBinding({
  parkId: 'p',
  entityId: 'e',
  name: 'Festival of Fantasy Parade',
  presets: { pre: 'pre1', post: 'post1' },
}, DEFAULT_SHOW_SETTINGS);
assert.ok(old);
assert.equal(old!.liveMode, 'ftb');
assert.equal(old!.livePresetId, '');
assert.equal(old!.ftbFadeSec, null);

const presetMode = normalizeShowBinding({
  ...old,
  liveMode: 'preset',
  livePresetId: 'live1',
  ftbFadeSec: 10,
}, DEFAULT_SHOW_SETTINGS);
assert.equal(presetMode!.liveMode, 'preset');
assert.equal(presetMode!.livePresetId, 'live1');
assert.equal(ftbDurationMs(presetMode!, 700), 10_000);

const presetWithoutId = normalizeShowBinding({
  ...old,
  liveMode: 'preset',
  livePresetId: '',
}, DEFAULT_SHOW_SETTINGS);
assert.equal(presetWithoutId!.liveMode, 'ftb');
assert.equal(presetWithoutId!.livePresetId, '');

const capped = normalizeShowBinding({ ...old, ftbFadeSec: 9999 }, DEFAULT_SHOW_SETTINGS);
assert.equal(capped!.ftbFadeSec, 600);

const negative = normalizeShowBinding({ ...old, ftbFadeSec: -1 }, DEFAULT_SHOW_SETTINGS);
assert.equal(negative!.ftbFadeSec, null);

const liveFtb = planShowPhase(old!, 'live', [], 800);
assert.equal(liveFtb.action, 'ftb');
if (liveFtb.action === 'ftb') {
  assert.equal(liveFtb.fadeMs, 800);
  assert.equal(liveFtb.firmwarePhase, 'live');
  assert.equal(liveFtb.missingLivePreset, false);
}

const livePreset = planShowPhase(presetMode!, 'live', [{ id: 'live1' }], 700);
assert.deepEqual(livePreset, { action: 'preset', presetId: 'live1', firmwarePhase: 'live' });

const missing = planShowPhase(presetMode!, 'live', [{ id: 'other' }], 700);
assert.equal(missing.action, 'ftb');
if (missing.action === 'ftb') {
  assert.equal(missing.missingLivePreset, true);
  assert.equal(missing.fadeMs, 10_000);
}

const fireworks = planShowPhase({ ...old!, kind: 'fireworks' }, 'live', [], 800);
assert.equal(fireworks.action, 'ftb');
if (fireworks.action === 'ftb') assert.equal(fireworks.firmwarePhase, 'black');

const blackPre = planShowPhase(
  { ...old!, presets: { pre: '__BLACK__', post: '' }, ftbFadeSec: 10 },
  'pre',
  [],
  800,
);
assert.equal(blackPre.action, 'ftb');
if (blackPre.action === 'ftb') {
  assert.equal(blackPre.fadeMs, 10_000);
  assert.equal(blackPre.firmwarePhase, 'pre');
}

const namedPre = planShowPhase(old!, 'pre', [{ id: 'pre1' }], 800);
assert.deepEqual(namedPre, { action: 'preset', presetId: 'pre1', firmwarePhase: 'pre' });

const webOld = normalizeWeb({
  parkId: 'p',
  entityId: 'e',
  name: 'Festival of Fantasy Parade',
  presets: { pre: 'pre1', post: 'post1' },
}, DEFAULT_SHOW_SETTINGS);
assert.equal(webOld.liveMode, 'ftb');
assert.equal(webOld.livePresetId, '');
assert.equal(webOld.ftbFadeSec, null);

const webPreset = normalizeWeb({
  ...webOld,
  liveMode: 'preset',
  livePresetId: 'live1',
  ftbFadeSec: '12.5',
}, DEFAULT_SHOW_SETTINGS);
assert.equal(webPreset.liveMode, 'preset');
assert.equal(webPreset.ftbFadeSec, 12.5);

console.log('show-phase-plan-test: ok');
