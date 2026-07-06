#!/usr/bin/env node
/**
 * Split index.legacy.html babel monolith into web/src modules.
 * Usage: node scripts/split-monolith.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const LEGACY_HTML = path.join(WEB_ROOT, 'index.legacy.html');
const SRC_ROOT = path.join(WEB_ROOT, 'src');

/** @type {Record<string, string>} symbol -> relative path from src/ */
const SYMBOL_TO_FILE = {
  // lib/tags.js
  TAG_SUGGESTIONS: 'lib/tags.js',
  normalizeTags: 'lib/tags.js',
  parseTagsInput: 'lib/tags.js',
  tagsToInput: 'lib/tags.js',
  collectAllTags: 'lib/tags.js',
  itemMatchesTagFilter: 'lib/tags.js',
  duplicateTaggedName: 'lib/tags.js',

  // lib/utils.js
  generateId: 'lib/utils.js',
  hexToRgb: 'lib/utils.js',
  rgbToHex: 'lib/utils.js',
  rgbToHsl: 'lib/utils.js',
  hslToRgb: 'lib/utils.js',
  normalizeHex: 'lib/utils.js',
  hexToRgbTriplet: 'lib/utils.js',
  rgbTripletToHex: 'lib/utils.js',
  wledColToHexList: 'lib/utils.js',
  hexListToWledCol: 'lib/utils.js',
  saveColorToLibrary: 'lib/utils.js',
  MAX_EFFECT_COLORS: 'lib/utils.js',
  ZONE_COLORS: 'lib/utils.js',
  PRESET_COLORS: 'lib/utils.js',
  DEFAULT_DATA: 'lib/utils.js',
  normalizePolygonPoint: 'lib/utils.js',
  normalizePolygon: 'lib/utils.js',
  normalizeZoneRecord: 'lib/utils.js',
  focusMapOnPolygon: 'lib/utils.js',
  presetSelectOptions: 'lib/utils.js',
  showModePresetOptions: 'lib/utils.js',
  paletteSelectValue: 'lib/utils.js',
  DEFAULT_PRESET_MEMORY: 'lib/utils.js',
  buildRecallPayload: 'lib/utils.js',
  compareVersions: 'lib/utils.js',
  showPresetLabel: 'lib/utils.js',
  buildPaletteSelectOptions: 'lib/utils.js',
  SegmentBar: 'components/shared/SegmentBar.jsx',

  // lib/ble/mbPayloads.js
  mbVibByte: 'lib/ble/mbPayloads.js',
  mbFiveSlotByte: 'lib/ble/mbPayloads.js',
  mbColorByte: 'lib/ble/mbPayloads.js',
  buildMbSingle: 'lib/ble/mbPayloads.js',
  buildMbDual: 'lib/ble/mbPayloads.js',
  buildMbRgb: 'lib/ble/mbPayloads.js',
  buildMbFive: 'lib/ble/mbPayloads.js',
  buildMbPing: 'lib/ble/mbPayloads.js',

  // lib/ble/mbConstants.js
  SW_FX_PRESET_BYTES: 'lib/ble/mbConstants.js',
  WAND_LAB_TAGS: 'lib/ble/mbConstants.js',
  MB_PATTERN_MODES: 'lib/ble/mbConstants.js',
  WAND_LAB_MB_CMDS: 'lib/ble/mbConstants.js',
  MB_COLOR_NAMES: 'lib/ble/mbConstants.js',
  mbPaletteOptions: 'lib/ble/mbConstants.js',
  DEFAULT_MB_WLED_COLORS: 'lib/ble/mbConstants.js',
  MB_PAL_OFF: 'lib/ble/mbConstants.js',
  MB_PAL_UNIQUE: 'lib/ble/mbConstants.js',
  MB_PAL_RANDOM: 'lib/ble/mbConstants.js',
  mbPaletteEligibleForRandom: 'lib/ble/mbConstants.js',
  defaultRandomPaletteIndices: 'lib/ble/mbConstants.js',
  normalizeRandomPool: 'lib/ble/mbConstants.js',
  MB_EFFECT_CLASS_META: 'lib/ble/mbConstants.js',
  TIER2_OPCODE_OPTIONS: 'lib/ble/mbConstants.js',
  MB_SEGMENT_META: 'lib/ble/mbConstants.js',
  MB_ANIMATION_META: 'lib/ble/mbConstants.js',
  SW_ANIMATION_META: 'lib/ble/mbConstants.js',
  MB_PATTERN_META: 'lib/ble/mbConstants.js',
  STRIP_LED_COUNT: 'lib/ble/mbConstants.js',
  MB_SEGMENT_SIM_COMMAND: 'lib/ble/mbConstants.js',
  SIM_FIVE_CORNERS: 'lib/ble/mbConstants.js',
  FIVE_CORNER_IDS: 'lib/ble/mbConstants.js',
  FIVE_CORNER_RGB: 'lib/ble/mbConstants.js',

  // lib/ble/mbMapping.js
  DEFAULT_MB_EFFECT_CLASSES: 'lib/ble/mbMapping.js',
  DEFAULT_MB_MAPPING: 'lib/ble/mbMapping.js',
  normalizeEffectClassMapping: 'lib/ble/mbMapping.js',
  normalizeEffectClasses: 'lib/ble/mbMapping.js',
  mirrorEffectClassesToLegacy: 'lib/ble/mbMapping.js',
  normalizeMbMapping: 'lib/ble/mbMapping.js',
  mbMappingToBlePayload: 'lib/ble/mbMapping.js',
  presetWledForBoard: 'lib/ble/mbMapping.js',
  buildMbKeyedSegmentsFromMapping: 'lib/ble/mbMapping.js',
  mbLayoutSetBlePayload: 'lib/ble/mbMapping.js',
  findMbSegIdConflicts: 'lib/ble/mbMapping.js',
  withSegRefDefaults: 'lib/ble/mbMapping.js',
  migrateWandLabDefaults: 'lib/ble/mbMapping.js',

  // lib/ble/chunking.js
  splitCommandForBleChunks: 'lib/ble/chunking.js',
  buildTestPresetPayload: 'lib/ble/chunking.js',
  finalizeWledSegmentPayload: 'lib/ble/chunking.js',
  testPresetOnWled: 'lib/ble/chunking.js',
  BLE_DEVICE_NAME: 'lib/ble/chunking.js',
  BLE_SERVICE_UUID: 'lib/ble/chunking.js',
  BLE_CMD_CHAR_UUID: 'lib/ble/chunking.js',
  BLE_NOTIFY_CHAR_UUID: 'lib/ble/chunking.js',
  BLE_SEND_DELAY_MS: 'lib/ble/chunking.js',
  BLE_MAX_WRITE_BYTES: 'lib/ble/chunking.js',
  BLE_CHUNK_INTER_MS: 'lib/ble/chunking.js',
  WLED_MAX_SEG: 'lib/ble/chunking.js',
  TEST_PRESET_RECALL: 'lib/ble/chunking.js',
  TEST_PRESET_MEMORY: 'lib/ble/chunking.js',
  WebBleBoard: 'lib/ble/chunking.js',
  webBleBoard: 'lib/ble/chunking.js',

  // lib/wled/capture.js
  postWledState: 'lib/wled/capture.js',
  SEGMENT_LAYOUT_FIELDS: 'lib/wled/capture.js',
  WLED_BLEND_MODES: 'lib/wled/capture.js',
  normalizeSegmentDef: 'lib/wled/capture.js',
  formatSegRange: 'lib/wled/capture.js',
  formatSegLabel: 'lib/wled/capture.js',
  isActiveSegment: 'lib/wled/capture.js',
  parseWledStateSegments: 'lib/wled/capture.js',
  summarizeLayout: 'lib/wled/capture.js',
  buildLayoutPayload: 'lib/wled/capture.js',
  fetchWledFullStateFromIp: 'lib/wled/capture.js',
  fetchWledSegmentsFromIp: 'lib/wled/capture.js',
  resolvePaletteName: 'lib/wled/capture.js',
  DEFAULT_WLED_CAPTURE_OPTS: 'lib/wled/capture.js',
  wledCaptureLabels: 'lib/wled/capture.js',
  captureSegmentFromRaw: 'lib/wled/capture.js',
  mergeSegmentsById: 'lib/wled/capture.js',
  activeSegmentsFromPreset: 'lib/wled/capture.js',
  pickSegOrWled: 'lib/wled/capture.js',
  buildRecalledSegment: 'lib/wled/capture.js',
  applyWledStateCapture: 'lib/wled/capture.js',
  segRefToPreview: 'lib/wled/capture.js',
  buildSegmentHighlightPreview: 'lib/wled/capture.js',
  buildFiveCornerPreview: 'lib/wled/capture.js',
  formatWledSegLabel: 'lib/wled/capture.js',
  formatWledSegSelectionSummary: 'lib/wled/capture.js',
  isValidSegRef: 'lib/wled/capture.js',
  parseSegRefFields: 'lib/wled/capture.js',
  defaultNewSegRef: 'lib/wled/capture.js',
  refsFromSnapshotIds: 'lib/wled/capture.js',
  updateRefAt: 'lib/wled/capture.js',
  removeRefAt: 'lib/wled/capture.js',
  appendSegRef: 'lib/wled/capture.js',
  toggleSnapshotSelection: 'lib/wled/capture.js',
  pruneRefsToSnapshot: 'lib/wled/capture.js',
  buildPresetLayoutPayload: 'lib/wled/capture.js',

  // lib/wled/catalog.js
  WLED_EFFECTS_CACHE_KEY: 'lib/wled/catalog.js',
  WLED_PALETTES_CACHE_KEY: 'lib/wled/catalog.js',
  loadCachedWledCatalog: 'lib/wled/catalog.js',
  fetchWledCatalog: 'lib/wled/catalog.js',

  // lib/boardSync.js
  BOARD_SYNC_LS_KEY: 'lib/boardSync.js',
  DEFAULT_BOARD_SYNC_OPTIONS: 'lib/boardSync.js',
  loadBoardSyncOptions: 'lib/boardSync.js',
  saveBoardSyncOptions: 'lib/boardSync.js',
  syncProfileToBoard: 'lib/boardSync.js',
  BOARD_SYNC_ITEMS: 'lib/boardSync.js',

  // lib/config.js
  loadAppData: 'lib/config.js',
  CURRENT_VERSION: 'lib/config.js',
  migrateSegmentMetadata: 'lib/config.js',
  migrateParksGrouping: 'lib/config.js',
  migrateShowBindingsDefaults: 'lib/config.js',
  migrateShowModeDefaults: 'lib/config.js',
  migrateMbSegmentLayouts: 'lib/config.js',
  migrateConfig: 'lib/config.js',
  LS_KEY: 'lib/config.js',
  LS_PROFILES: 'lib/config.js',

  // shared
  btn: 'components/shared/styles.js',
  inputStyle: 'components/shared/styles.js',
  labelStyle: 'components/shared/styles.js',
  cardStyle: 'components/shared/styles.js',
  selectStyle: 'components/shared/styles.js',
  Field: 'components/shared/Field.jsx',
  SearchableSelect: 'components/shared/SearchableSelect.jsx',
  SectionHead: 'components/shared/SectionHead.jsx',
  Modal: 'components/shared/Modal.jsx',
  ModalBtns: 'components/shared/Modal.jsx',
  ColorSwatch: 'components/shared/ColorSwatch.jsx',
  TagChipRow: 'components/shared/TagChipRow.jsx',
  TagFilterBar: 'components/shared/TagFilterBar.jsx',
  TagEditor: 'components/shared/TagEditor.jsx',
  PALETTE_SWATCHES: 'components/shared/ColorInput.jsx',
  ColorCell: 'components/shared/ColorCell.jsx',
  ColorInput: 'components/shared/ColorInput.jsx',

  // map
  THEME_PARKS_API: 'lib/map/themeParks.js',
  themeParkDestCache: 'lib/map/themeParks.js',
  fetchThemeParkDestinations: 'lib/map/themeParks.js',
  fetchParkShows: 'lib/map/themeParks.js',
  inferShowKind: 'lib/map/themeParks.js',
  normalizeShowBinding: 'lib/map/themeParks.js',
  buildLegacyShowModeConfig: 'lib/map/themeParks.js',
  parkSelectOptions: 'lib/map/themeParks.js',
  groupZonesByPark: 'lib/map/themeParks.js',
  ParksPanel: 'components/map/ParksPanel.jsx',
  MapZonesTab: 'components/map/MapZonesTab.jsx',

  // tabs
  PresetsTab: 'components/presets/PresetsTab.jsx',
  PalettesTab: 'components/palettes/PalettesTab.jsx',
  ShowsTab: 'components/shows/ShowsTab.jsx',
  BrightnessTab: 'components/brightness/BrightnessTab.jsx',
  WledSegEditor: 'components/ble/WledSegEditor.jsx',
  MbEffectField: 'components/ble/MbEffectField.jsx',
  BleMappingTabBar: 'components/ble/BleMappingTabBar.jsx',
  DefaultPresetField: 'components/ble/DefaultPresetField.jsx',
  RandomPoolEditor: 'components/ble/RandomPoolEditor.jsx',
  WandLabTab: 'components/ble/WandLabTab.jsx',
  SettingsTab: 'components/settings/SettingsTab.jsx',
  BoardSyncModal: 'components/board/BoardSyncModal.jsx',
  App: 'App.jsx',
};

const DECL_START =
  /^(?:async )?function ([A-Za-z_$][\w$]*)|^const ([A-Za-z_$][\w$]*) =|^let ([A-Za-z_$][\w$]*) =|^class ([A-Za-z_$][\w$]*)/;

const REACT_HOOKS = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo'];

function extractBabelScript(html) {
  const open = html.indexOf('<script type="text/babel"');
  if (open < 0) throw new Error('No <script type="text/babel"> found');
  const contentStart = html.indexOf('>', open) + 1;
  const close = html.indexOf('</script>', contentStart);
  if (close < 0) throw new Error('Unclosed babel script');
  return html.slice(contentStart, close);
}

function stripIndent(source) {
  return source
    .split('\n')
    .map((line) => (line.startsWith('    ') ? line.slice(4) : line))
    .join('\n');
}

function parseDeclarations(source) {
  const lines = source.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.startsWith('//')) continue;
    if (DECL_START.test(lines[i])) starts.push(i);
  }

  const decls = new Map();
  const order = [];
  for (let s = 0; s < starts.length; s++) {
    const start = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1] : lines.length;
    const block = lines.slice(start, end).join('\n').replace(/\n+$/, '');
    const m = block.match(DECL_START);
    if (!m) continue;
    const name = m[1] || m[2] || m[3] || m[4];
    if (name === 'useState' || block.includes('= React')) continue;
    decls.set(name, block);
    order.push(name);
  }
  return { decls, order };
}

function isJsxFile(filePath) {
  return filePath.endsWith('.jsx');
}

function fileExportsForPath(filePath, decls) {
  const names = [];
  for (const [sym, fp] of Object.entries(SYMBOL_TO_FILE)) {
    if (fp === filePath && decls.has(sym)) names.push(sym);
  }
  return names;
}

function detectNeededSymbols(body, localSymbols, filePath) {
  const codeOnly = stripComments(body);
  const needed = new Set();
  for (const sym of Object.keys(SYMBOL_TO_FILE)) {
    if (localSymbols.has(sym)) continue;
    if (SYMBOL_TO_FILE[sym] === filePath) continue;
    const re = new RegExp(`\\b${sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(codeOnly)) needed.add(sym);
  }
  return needed;
}

function reactImportsForBody(body) {
  const hooks = REACT_HOOKS.filter((h) => new RegExp(`\\b${h}\\b`).test(body));
  const parts = [];
  if (hooks.length) parts.push(`import { ${hooks.join(', ')} } from 'react';`);
  if (/\b(createPortal|ReactDOM\.createPortal)\b/.test(body)) {
    parts.push("import { createPortal } from 'react-dom';");
  }
  return parts;
}

function cleanBlock(block) {
  return block
    .replace(/\n\/\/ ──[^\n]*─+\s*$/g, '')
    .trimEnd();
}

function stripComments(source) {
  return source
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function transformBody(body) {
  let out = body;
  out = out.replace(/\bReactDOM\.createPortal\b/g, 'createPortal');
  return out;
}

function buildImportLines(filePath, neededSymbols) {
  const byPath = new Map();
  for (const sym of neededSymbols) {
    const from = SYMBOL_TO_FILE[sym];
    if (!from || from === filePath) continue;
    if (!byPath.has(from)) byPath.set(from, []);
    byPath.get(from).push(sym);
  }

  const lines = [];
  const sortedPaths = [...byPath.keys()].sort();
  for (const from of sortedPaths) {
    const names = [...new Set(byPath.get(from))].sort();
    const rel = path.relative(path.dirname(filePath), from).replace(/\\/g, '/');
    const importPath = rel.startsWith('.') ? rel : `./${rel}`;
    const ext = importPath.endsWith('.js') || importPath.endsWith('.jsx') ? '' : '';
    lines.push(`import { ${names.join(', ')} } from '${importPath.replace(/\.(js|jsx)$/, '')}${ext}';`);
  }
  return lines;
}

function exportLine(symbols, isDefault = false) {
  if (isDefault) return '';
  if (symbols.length === 0) return '';
  const fns = [];
  const vals = [];
  for (const s of symbols) {
    if (/^[A-Z]/.test(s) && !s.match(/^[A-Z_]+$/)) {
      fns.push(s);
    } else {
      vals.push(s);
    }
  }
  const parts = [];
  if (vals.length) parts.push(`export { ${vals.join(', ')} };`);
  for (const fn of fns) {
    parts.push(`export { ${fn} };`);
  }
  return parts.join('\n');
}

function prefixExports(body, symbols) {
  let out = body;
  for (const sym of symbols) {
    const fnRe = new RegExp(`^(async )?function ${sym}\\b`, 'm');
    const classRe = new RegExp(`^class ${sym}\\b`, 'm');
    const constRe = new RegExp(`^(const|let) ${sym} =`, 'm');
    if (fnRe.test(out)) out = out.replace(fnRe, (m) => `export ${m}`);
    else if (classRe.test(out)) out = out.replace(classRe, (m) => `export ${m}`);
    else if (constRe.test(out)) out = out.replace(constRe, (m) => `export ${m}`);
  }
  return out;
}

function writeGoogleMaps() {
  const content = `const MAPS_KEY_STORAGE = 'maps-api-key';

let loadPromise = null;

export function getMapsApiKey() {
  return localStorage.getItem(MAPS_KEY_STORAGE) || '';
}

export function setMapsApiKey(key) {
  localStorage.setItem(MAPS_KEY_STORAGE, key);
}

/** @returns {Promise<typeof google>} */
export function loadGoogleMaps(apiKey) {
  const key = (apiKey ?? getMapsApiKey()).trim();
  if (!key) return Promise.reject(new Error('Google Maps API key not set'));
  if (typeof window !== 'undefined' && window.google?.maps) {
    return Promise.resolve(window.google);
  }
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const prev = window.initMap;
    window.initMap = () => {
      window.MAPS_LOADED = true;
      if (typeof prev === 'function') prev();
      resolve(window.google);
    };
    const s = document.createElement('script');
    s.src = \`https://maps.googleapis.com/maps/api/js?key=\${encodeURIComponent(key)}&callback=initMap&libraries=geometry\`;
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });

  return loadPromise;
}

export function isMapsLoaded() {
  return !!(typeof window !== 'undefined' && window.google?.maps);
}
`;
  return content;
}

function writeMainJsx() {
  return `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;
}

function extractCssFromLegacy(html) {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  return m ? m[1].trim() : '';
}

function groupByFile(order, decls) {
  /** @type {Map<string, string[]>} */
  const files = new Map();
  const unassigned = [];

  for (const name of order) {
    const fp = SYMBOL_TO_FILE[name];
    if (!fp) {
      unassigned.push(name);
      continue;
    }
    if (!files.has(fp)) files.set(fp, []);
    files.get(fp).push(name);
  }
  return { files, unassigned };
}

function composeFile(filePath, symbolNames, decls) {
  const blocks = symbolNames.map((n) => cleanBlock(decls.get(n) || '')).filter(Boolean);
  let body = blocks.map(transformBody).join('\n\n');
  body = prefixExports(body, symbolNames);

  const localSymbols = new Set(symbolNames);
  const needed = detectNeededSymbols(body, localSymbols, filePath);
  const importLines = buildImportLines(filePath, needed);
  const reactLines = isJsxFile(filePath) ? reactImportsForBody(body) : [];

  const header = [...reactLines, ...importLines].filter(Boolean).join('\n');
  return header ? `${header}\n\n${body}\n` : `${body}\n`;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function countLines(text) {
  return text.split('\n').length;
}

function main() {
  console.log('Reading', LEGACY_HTML);
  const html = fs.readFileSync(LEGACY_HTML, 'utf8');
  const babelRaw = extractBabelScript(html);
  const babel = stripIndent(babelRaw);
  const { decls, order } = parseDeclarations(babel);

  console.log(`Parsed ${decls.size} top-level declarations`);

  const { files, unassigned } = groupByFile(order, decls);
  if (unassigned.length) {
    console.warn('Unassigned symbols (not in SYMBOL_TO_FILE):', unassigned.join(', '));
  }

  const written = [];
  const errors = [];

  for (const [filePath, symbols] of files) {
    const fullPath = path.join(SRC_ROOT, filePath);
    try {
      const content = composeFile(filePath, symbols, decls);
      ensureDir(fullPath);
      fs.writeFileSync(fullPath, content, 'utf8');
      written.push({ path: filePath, lines: countLines(content), symbols });
    } catch (e) {
      errors.push({ path: filePath, error: String(e.message || e) });
    }
  }

  // googleMaps.js
  const gmapsPath = path.join(SRC_ROOT, 'lib/googleMaps.js');
  ensureDir(gmapsPath);
  const gmapsContent = writeGoogleMaps();
  fs.writeFileSync(gmapsPath, gmapsContent, 'utf8');
  written.push({ path: 'lib/googleMaps.js', lines: countLines(gmapsContent), symbols: ['loadGoogleMaps'] });

  // main.jsx
  const mainPath = path.join(SRC_ROOT, 'main.jsx');
  const mainContent = writeMainJsx();
  fs.writeFileSync(mainPath, mainContent, 'utf8');
  written.push({ path: 'main.jsx', lines: countLines(mainContent), symbols: [] });

  // index.css from legacy
  const cssPath = path.join(SRC_ROOT, 'index.css');
  const css = extractCssFromLegacy(html);
  if (css) {
    fs.writeFileSync(cssPath, css + '\n', 'utf8');
    written.push({ path: 'index.css', lines: countLines(css), symbols: [] });
  }

  // Report
  console.log('\n=== Created files ===');
  let totalLines = 0;
  for (const w of written.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`  ${w.path} (${w.lines} lines, ${w.symbols.length} symbols)`);
    totalLines += w.lines;
  }
  console.log(`\nTotal: ${written.length} files, ${totalLines} lines`);

  if (errors.length) {
    console.error('\n=== Errors ===');
    for (const e of errors) console.error(`  ${e.path}: ${e.error}`);
    process.exitCode = 1;
  }

  // Write manifest for follow-up fixes
  const manifest = {
    generatedAt: new Date().toISOString(),
    files: written,
    unassigned,
    errors,
  };
  fs.writeFileSync(path.join(WEB_ROOT, 'scripts/split-manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('\nManifest: scripts/split-manifest.json');
}

main();
