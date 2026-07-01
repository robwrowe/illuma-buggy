#!/usr/bin/env node
/**
 * Round-trip test for v2.2 → v3.0 migrateConfig.
 * Usage: node scripts/migrate-config-test.mjs [path/to/export.json]
 *
 * Asserts presets, zones, and indoorZones are unchanged (deep equal)
 * except for any new optional fields on zone records (parkId not added by migration).
 */

import { readFileSync } from 'fs';

const CURRENT_VERSION = '3.0';

function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function withSegRefDefaults(ref) {
  return {
    id: ref.id, start: ref.start, stop: ref.stop,
    grp: ref.grp ?? 1, spc: ref.spc ?? 0, of: ref.of ?? 0,
    rev: ref.rev ?? false, mi: ref.mi ?? false,
    fx: ref.fx ?? -1, sx: ref.sx ?? 128, ix: ref.ix ?? 128, pal: ref.pal ?? -1,
  };
}

function migrateSegmentMetadata(data) {
  const mbMapping = data.mbMapping ? { ...data.mbMapping } : undefined;
  if (mbMapping?.segments) {
    const segments = {};
    for (const [key, refs] of Object.entries(mbMapping.segments)) {
      segments[key] = (refs || []).map(withSegRefDefaults);
    }
    mbMapping.segments = segments;
  }
  const customSegmentLayouts = (data.customSegmentLayouts || []).map(layout => ({
    ...layout,
    segments: (layout.segments || []).map(withSegRefDefaults),
  }));
  return { ...data, mbMapping, customSegmentLayouts };
}

function migrateParksGrouping(data) {
  if (data.parks) return data;
  return { ...data, parks: [] };
}

function migrateShowModeDefaults(data) {
  if (data.showModeConfig) return data;
  return {
    ...data,
    showModeConfig: {
      parade: { pre: '', live: '', post: '' },
      fireworks: { pre: '', live: '__BLACK__', post: '' },
    },
  };
}

function migrateWandLabDefaults(data) {
  if (data.wandLab) return data;
  return { ...data, wandLab: { simIp: '', log: [] } };
}

function migrateConfig(raw) {
  if (!raw) return { version: CURRENT_VERSION };
  let data = { ...raw };
  const v = data.version || '1.0';
  if (compareVersions(v, CURRENT_VERSION) < 0) {
    data = migrateSegmentMetadata(data);
    data = migrateParksGrouping(data);
    data = migrateShowModeDefaults(data);
    data = migrateWandLabDefaults(data);
    data.version = CURRENT_VERSION;
  }
  return data;
}

function deepEqual(a, b, path = '') {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} !== ${typeof b}`;
  if (a === null || b === null) return a !== b ? `${path}: ${a} !== ${b}` : null;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return `${path}: array length mismatch`;
    for (let i = 0; i < a.length; i++) {
      const err = deepEqual(a[i], b[i], `${path}[${i}]`);
      if (err) return err;
    }
    return null;
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.join() !== keysB.join()) {
      return `${path}: keys ${keysA.join()} !== ${keysB.join()}`;
    }
    for (const k of keysA) {
      const err = deepEqual(a[k], b[k], path ? `${path}.${k}` : k);
      if (err) return err;
    }
    return null;
  }
  return `${path}: ${a} !== ${b}`;
}

function main() {
  const file = process.argv[2];
  let raw;
  if (file) {
    raw = JSON.parse(readFileSync(file, 'utf8'));
    console.log(`Loaded ${file} (version ${raw.version || '?'})`);
    console.log(`  presets: ${raw.presets?.length ?? 0}, zones: ${raw.zones?.length ?? 0}, indoor: ${raw.indoorZones?.length ?? 0}`);
  } else {
    raw = {
      version: '2.2',
      presets: [{ id: 'p1', name: 'Test', wled: { on: true, fx: 0 }, memory: {}, createdAt: 1 }],
      zones: [{ id: 'z1', name: 'Zone', polygon: [], presetId: 'p1', enabled: true }],
      indoorZones: [{ id: 'i1', name: 'Indoor', polygon: [], enabled: true }],
      mbMapping: {
        version: 1,
        segments: {
          band5: [{ id: 14, start: 80, stop: 87 }],
          band6: [{ id: 15, start: 87, stop: 94 }],
          band7: [{ id: 16, start: 94, stop: 100 }],
        },
      },
    };
    console.log('No file — using minimal v2.2 fixture');
  }

  const migrated = migrateConfig(raw);

  const checks = [
    ['presets', raw.presets, migrated.presets],
    ['zones', raw.zones, migrated.zones],
    ['indoorZones', raw.indoorZones, migrated.indoorZones],
  ];

  let failed = false;
  for (const [name, before, after] of checks) {
    const err = deepEqual(before, after, name);
    if (err) {
      console.error(`FAIL ${err}`);
      failed = true;
    } else {
      console.log(`OK   ${name} unchanged (${before?.length ?? 0} items)`);
    }
  }

  console.log(`Version: ${raw.version} → ${migrated.version}`);
  console.log(`parks: ${JSON.stringify(migrated.parks)}`);
  console.log(`showModeConfig: ${JSON.stringify(migrated.showModeConfig)}`);
  console.log(`wandLab: ${JSON.stringify(migrated.wandLab)}`);

  const band5 = migrated.mbMapping?.segments?.band5?.[0];
  if (band5) {
    console.log(`band5 seg ref: ${JSON.stringify(band5)}`);
    if (band5.fx !== -1 || band5.grp !== 1) {
      console.error('FAIL band5 metadata defaults');
      failed = true;
    } else {
      console.log('OK   band5 metadata defaults applied');
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
