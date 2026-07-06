# Cursor Task: React App Migration + Wand Lab Test Tooling

**Context for Cursor:** `index.html` is a single-file React app (~5,500 lines, 126+ top-level functions) using in-browser Babel transpilation via `@babel/standalone` and CDN-loaded React/ReactDOM. It has no build step, no module boundaries, no UI component library (all inline styles), and no tests. This doc covers three things in sequence: (1) migrating it to a proper Vite + React project on **Mantine** as the UI library, (2) extending the existing `WandLabTab` component with sweep/burst/capture-import tooling to make BLE opcode testing faster, and (3) extracting a small shared design-tokens file so the eventual Expo/React Native companion app can visually match this web app without needing the same component library. **Do the migration first** — the new features should be written directly into the new module structure, not bolted onto the monolith and then migrated.

**Repo:** https://github.com/robwrowe/illuma-buggy — you (Cursor) have full local access to this repo and should work from it directly rather than the `index.html` snapshot referenced in this doc, wherever they differ. (Note for context only, not a constraint on Cursor: this link is blocked by robots.txt for Claude's own web-fetch tooling, which is why earlier drafts of this doc were written against an uploaded file instead — irrelevant to Cursor, which reads the repo directly.)

**Reference docs for the BLE opcode work referenced throughout this doc:**

- https://emcot.world/Disney_MagicBand%2B_Bluetooth_Codes
- https://emcot.world/Disney%27s_Starlight_Wand
- `API.md` (WandSimulator HTTP/Serial API — read this in full before touching Part 2; it supersedes any earlier assumption in this doc that the Wand Lab talks to a simple `POST http://{simIp}/send {bytes}` endpoint). Key facts from that spec that change how Part 2 should be built:
  - The real endpoints are `GET /status`, `POST /send`, `POST /show`, `POST /stop` — `/send` takes either `{"line": "..."}` (runs a Serial-style command like `mb red` or `sw fx rainbow`) or `{"hex": "..."}` (payload-only bytes, firmware prepends the `8301` company ID). `/show` takes **plain text**, one `<holdMs> <hex>` line per step, and expects the **full** bytes including the `8301` prefix, straight from a capture file's `hex` column.
  - **The company-ID-byte handling is the single easiest thing to get wrong** and directly affects the existing raw-byte editor and the new capture-paste-import feature (2c below) — `/send hex` wants payload-only (no `8301`), while `/show` and anything sourced from a capture file wants the full bytes with `8301` intact. These are opposite conventions for what looks like the same kind of hex string, so the UI needs to make which one it's sending unambiguous rather than relying on Rob to remember it per-field.
  - `/send` **blocks for ~4 seconds per call** (the firmware holds the advertisement live for that long to match real pickup timing) — this changes how the burst/sweep tooling in Part 2 should be built. Firing rapid repeats via `/send` in a tight client-side timer loop will queue up and desync badly against its own ~4s blocking behavior; a naive "send every 1000ms" loop will actually fire far slower than requested once `/send`'s real latency is accounted for, and the UI needs to reflect actual elapsed/blocking time, not an optimistic timer.
  - `/show` is **built for exactly the burst/sequence-replay use case** Part 2 was designed to solve — it's async (returns immediately, poll `/status` for progress), takes a full sequence of timed steps in one call, and is explicitly the documented way to replay a captured show rather than looping individual `/send` calls client-side. Part 2 below has been rewritten to build on `/show`/`/status`/`/stop` rather than a client-side setInterval loop wrapping `/send`.
  - There's also a **rich named Serial/`/send {"line"}` command set already built into the firmware** (`mb red`, `mb five <tl> <bl> <br> <tr> <c>`, `sw fx rainbow`, `mbsweep`, `mbloop <color>`, `swfxloop`, `stop`, `test <segment>`, etc.) that duplicates some of what a client-side sweep UI might otherwise reinvent — e.g. `mbsweep` already cycles palettes 0–31 every 3s server-side, and `stop` already cancels any loop _or_ an in-progress `/show`. Part 2 should route through these where they already do the job, not reimplement them in the browser.
  - **No credential persistence, wide-open CORS, single-client-in-practice** — the simulator's IP is Serial-discovered fresh each session (no mDNS) and there's no auth. Nothing to build around here, but don't add any client-side assumption that the IP is stable across the simulator's power cycles, and don't add request queueing complexity beyond what's already documented (two clients racing the radio is a known, accepted limitation, not a bug to fix client-side).

**Forward-looking constraint — read before starting the module split (Part 1, step 2):** Rob is considering, as a future (not current) project, replacing the hardcoded MB+/Wand opcode parsing logic with a **user-configurable packet-parsing tool** — letting a user define "opcode X triggers effect Y, these byte ranges are colors for LEDs 1-5, this byte is on-duration, this byte is fade-duration" rather than shipping Disney-specific reverse-engineered mappings baked into the app. The motivation is being able to open-source the repo without the hardcoded opcode/byte mappings themselves being the thing published. **Do not build this now** — it's explicitly out of scope for this task. But while splitting `mbPayloads.js` / `mbConstants.js` / `mbMapping.js` out of the monolith in Part 1, keep the boundary between "generic BLE packet building/parsing machinery" and "the specific Disney opcode/byte values" as clean as practically possible (e.g. don't scatter literal opcode bytes like `0xE9`, `0x05`, `0x0C` through UI components — keep them centralized in the constants modules already planned). This costs nothing extra now and makes an eventual extraction into a user-facing config layer meaningfully easier later. If a clean separation isn't obvious for a given piece of code, don't force it — just don't make it harder than it already is.

**Use Mantine's hooks wherever they cleanly cover something the code needs**, not just for responsive breakpoints. `@mantine/hooks` covers a lot of the ad hoc state/effect patterns likely already hand-rolled in the current file — e.g. `useMediaQuery` (responsive, see below), `useDisclosure` (open/close state for modals, drawers, the sweep-mode panel in Part 2), `useDebouncedValue`/`useDebouncedCallback` (if anything currently debounces input by hand), `useLocalStorage` (the existing `localStorage.getItem('wled-ip')`/`maps-api-key` patterns are good candidates to replace, since this hook keeps state in sync with localStorage automatically rather than needing manual read/write calls), and `useClipboard` (useful for the byte-hex-string displays, if copy-to-clipboard is ever added). Don't force a hook where the existing logic doesn't map cleanly — check `@mantine/hooks`' current docs for the full list before writing custom state/effect logic that duplicates something already provided.

**Responsive design requirement:** the migrated web app must be usable on phone, iPad, and iPad mini screen sizes, not just desktop. The current `index.html` is desktop-oriented (fixed `height: 100vh; overflow: hidden` on `body`, no responsive breakpoints visible in the existing `<style>` block). During the migration:

- Use Mantine's responsive props (`visibleFrom`/`hiddenFrom`, the `Grid`/`SimpleGrid` breakpoint props, `useMediaQuery` from `@mantine/hooks`) rather than hand-rolled media queries, consistent with adopting Mantine as the UI library generally.
- Pay particular attention to: the tab navigation (likely needs to collapse to a compact/scrollable or drawer-style nav below a certain width rather than the current layout), any side-by-side grid layouts in `SettingsTab`/`WandLabTab`/`PalettesTab` (the `gridTemplateColumns: '1fr 1fr'` patterns throughout the file should become responsive, stacking to one column on narrow viewports), and the map view (`#map-container`) sizing on smaller screens.
- iPad mini's viewport (768×1024 in portrait) is a useful concrete breakpoint to test against explicitly, since it's narrower than a full iPad and a common point where two-column layouts stop fitting comfortably.
- This applies to every tab, not just the Wand Lab additions in Part 2 — but the Part 2 sweep/burst controls should be designed responsively from the start rather than retrofitted, since they're new.

---

## Part 1 — Migrate to a Vite + React project

### Why now (confirm this reasoning before starting; flag to Rob if anything below seems wrong)

- Single file is ~5,500 lines and growing every time a new BLE opcode family needs UI support (this doc adds more).
- In-browser Babel transpilation has no HMR, no source maps in a meaningful sense, and re-parses the entire file on every edit — this will get slower as the file grows.
- No module boundaries means every helper function (BLE payload builders, WLED capture parsing, tag utilities, etc.) is one global scope — collision risk is already nonzero at 126 functions.
- No tests, no lint config — fine for a single evening's hack, increasingly risky as this becomes a daily-use lab tool for opcode reverse-engineering with real safety-adjacent logic (fade-to-black, override kill).
- All styling is currently hand-rolled inline `style={{...}}` objects with a small set of CSS custom properties (`--bg`, `--surface`, `--primary`, etc. in `:root`). This works but means every new component (like the Part 2 additions below) re-derives the same spacing/color/border patterns by hand. Adopting a component library now, while the file is already being restructured, avoids doing this refactor a second time later.

### UI library: Mantine

Use **Mantine** (`@mantine/core`, `@mantine/hooks`, and `@mantine/form` if it simplifies the existing form-heavy tabs like `SettingsTab`) as the UI component library for the web app. This is a deliberate choice, not a default — don't substitute a different library.

Note for context: no UI library shares actual components between React (web) and React Native — Mantine is DOM/CSS-based and won't run inside the Expo app, and this is true of every mainstream React web UI kit (Chakra, MUI, etc.), not a Mantine-specific limitation. The two codebases will always be separate component trees. What _is_ worth sharing is a small **design tokens** module (color palette, spacing scale, radii) that Mantine's theme consumes on the web side, and that the Expo app's own styling approach (StyleSheet, NativeWind, Tamagui — whatever Rob picks when that work starts) can also import as plain JS values. See "Design tokens for future cross-platform reuse" at the end of this doc — this is a small, low-cost step to take now while the theme is being defined for Mantine anyway, not a framework decision for the Expo app itself.

Mapping existing custom components to Mantine equivalents during the migration (verify each during extraction, this is a starting guide not a strict spec):

| Existing custom component                                            | Mantine equivalent                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Field` (label + input wrapper)                                      | `Input.Wrapper` or a thin custom wrapper around Mantine's form field primitives                                                                                                                                                                                                   |
| `SectionHead`                                                        | `Title` (order 4-5) or `Text fw={700}` per current sizing                                                                                                                                                                                                                         |
| `SearchableSelect`                                                   | `Select` or `Combobox` (Mantine's `Select` has built-in search; `Combobox` if custom filtering behavior in the existing component doesn't map cleanly)                                                                                                                            |
| `ColorInput`                                                         | Mantine's own `ColorInput` component — check whether the existing one's "saved colors" swatch-picker behavior needs the `swatches` prop or a custom popover                                                                                                                       |
| Raw `<input>`/`<textarea>`/`<select>` throughout                     | `TextInput`, `NumberInput`, `Textarea`, `Select`                                                                                                                                                                                                                                  |
| Inline `btn('primary', {...})` / `btn('danger', {...})` style helper | Mantine `Button` with `color`/`variant` props — the existing `btn()` helper's variants (default/primary/danger) map to Mantine color choices; this helper can likely be deleted once buttons are migrated                                                                         |
| `TagChipRow`, tag filter bar                                         | Mantine `Badge` / `Pill` for chips, `TagsInput` may replace the custom tag-parsing input entirely (evaluate whether `TagsInput` covers the existing `parseTagsInput`/`normalizeTags` behavior, or if that logic needs to stay custom and just render into Mantine's visual style) |
| `:root` CSS variables (`--bg`, `--surface`, `--primary`, etc.)       | Migrate into a Mantine theme object (`createTheme`) — colors become a custom Mantine color scheme, spacing/radius become theme scale overrides                                                                                                                                    |

Set up Mantine's theme once, early, in `src/theme.js`, using the existing CSS variable values as the starting palette so the migrated app looks the same on day one — this is a structural migration, not a visual redesign. Any visual polish/redesign is a separate future task Rob hasn't asked for here.

### Migration steps

1. **Scaffold a new Vite React project** alongside the existing file, don't delete `index.html` until the migration is verified working:

   ```bash
   npm create vite@latest illuma-buggy-webapp -- --template react
   cd illuma-buggy-webapp
   npm install
   npm install @mantine/core @mantine/hooks @mantine/form
   npm install postcss postcss-preset-mantine postcss-simple-vars -D
   ```

   Mantine requires a small PostCSS config (`postcss-preset-mantine` + `postcss-simple-vars`) — follow Mantine's current Vite setup guide for the exact `postcss.config.cjs` contents and the `@mantine/core/styles.css` import in `main.jsx`, since these steps can shift between Mantine versions.

2. **Establish the module structure.** Based on the existing file's logical sections (identifiable by the `// ── Section ──` comments already in the code), split into:

   ```
   src/
     main.jsx                 # ReactDOM.createRoot entry, unchanged logic
     App.jsx                  # top-level App component + routing/tab state
     lib/
       ble/
         mbPayloads.js         # buildMbSingle, buildMbDual, buildMbRgb, buildMbFive, buildMbPing, mbColorByte
         mbConstants.js        # MB_PAL_RANDOM, MB_COLOR_NAMES, MB_PATTERN_MODES, MB_SEGMENT_META, MB_ANIMATION_META, MB_PATTERN_META, WAND_LAB_MB_CMDS, WAND_LAB_TAGS, SW_FX_PRESET_BYTES
         mbMapping.js           # mbMappingToBlePayload, normalizeMbMapping, migrateWandLabDefaults, DEFAULT_MB_MAPPING, DEFAULT_MB_EFFECT_CLASSES
         chunking.js            # splitCommandForBleChunks, buildTestPresetPayload
       wled/
         capture.js             # captureSegmentFromRaw, applyWledStateCapture, parseWledStateSegments, wledCaptureLabels
         catalog.js              # loadCachedWledCatalog and related
       tags.js                  # normalizeTags, parseTagsInput, tagsToInput, collectAllTags, itemMatchesTagFilter, duplicateTaggedName
       utils.js                 # generateId, misc small helpers
     components/
       shared/
         Field.jsx, SectionHead.jsx, SearchableSelect.jsx, ColorInput.jsx, TagChipRow.jsx, TagFilterBar.jsx
       ble/
         WandLabTab.jsx
         WandLabSweepPanel.jsx      # NEW — see Part 2
         WandLabCaptureImport.jsx   # NEW — see Part 2
         WledSegEditor.jsx
         BleMappingTabBar.jsx
       settings/
         SettingsTab.jsx
       palettes/
         PalettesTab.jsx
       ...(remaining tabs, one file per existing top-level tab component)
     styles/
       theme.js                # Mantine createTheme(), seeded from the existing :root CSS variable values
       tokens.js               # NEW — plain-JS design tokens (see final section), imported by theme.js
   index.html                  # trimmed to just <div id="root"> + script tag
   ```

   This mapping is a starting point based on function names visible in the current file — Cursor should verify actual dependencies between functions while splitting (some helpers may be used across more sections than their name suggests) and adjust module boundaries accordingly rather than following this list rigidly.

3. **Preserve exact runtime behavior during the split.** For each extracted module:
   - Copy the function/constant verbatim first, get it compiling and passing a manual smoke test, _then_ refactor if needed. Don't rewrite logic and restructure files in the same pass — that makes regressions hard to attribute.
   - Watch for implicit dependencies on global scope (e.g. a function used across multiple "sections" of the old file that wasn't obviously related by name).

4. **Google Maps loader**: the existing `window.loadGoogleMaps` / `window.initMap` pattern in the raw `<script>` tag before the Babel block should move into a small `src/lib/googleMaps.js` module using a promise-based loader instead of global callback flags, since Vite's module system makes this cleaner than the current polling-via-`window.MAPS_LOADED` approach. Confirm with Rob whether any component currently polls `window.MAPS_LOADED` directly — if so, replace with the promise.

5. **localStorage keys must not change** (`maps-api-key`, `wled-ip`, and any others found during extraction) — the migration must not force Rob to re-enter settings.

6. **Set up minimal lint + format**: ESLint with the React plugin, Prettier. Don't introduce TypeScript in this pass — that's a separate, larger decision Rob hasn't asked for.

7. **Build and deploy via GitHub Pages Action.** The current `index.html` is served directly by GitHub Pages (single static file, presumably from the repo root or a `docs/` folder — confirm which by checking the repo's Pages settings before assuming). Once this becomes a real Vite build with a `dist/` output folder, **that output is no longer sitting in the root or `docs/` where GitHub Pages looks by default** — a GitHub Actions workflow is required to build and publish `dist/` on every push, replacing the "GitHub Pages serves the file directly" setup that works today.
   - Add `.github/workflows/deploy.yml` using the standard Vite + GitHub Pages Actions pattern: a job that checks out the repo, sets up Node, runs `npm ci` and `npm run build`, then deploys the `dist/` folder using `actions/upload-pages-artifact` + `actions/deploy-pages`. Cursor should pull the current recommended version tags for these actions rather than hardcoding versions from memory, since they update independently of this doc.
   - In the repo's GitHub Pages settings, the source needs to change from "Deploy from a branch" (serving the raw `index.html`) to **"GitHub Actions"** as the build/deploy source — this is a one-time manual setting change in the repo, not something the workflow file itself can set. Flag this explicitly to Rob as a manual step he needs to do in GitHub's UI, since Cursor can't change repo settings.
   - Set `base` in `vite.config.js` to match the repo's Pages URL path (e.g. `/illuma-buggy/` if served from `https://robwrowe.github.io/illuma-buggy/`, or `/` if this repo is configured as a user/org root site at `https://robwrowe.github.io/`) — get this wrong and every asset path 404s on Pages while working fine in local dev, so confirm the actual Pages URL structure with Rob rather than assuming.
   - Confirm the workflow triggers on push to whichever branch currently triggers the existing Pages deploy (likely `main`), so the deploy cadence doesn't change from what Rob is used to.
   - After the Action is in place, verify a full deploy end-to-end (push → Action runs → Pages URL serves the new build) before considering Part 1 done — a broken deploy pipeline is easy to miss if local `npm run dev` is the only thing tested.
   - Keep `npm run dev` for local iteration as before; the Action only handles the production Pages deploy.

8. **Verification checklist before considering migration done**:
   - [ ] Every existing tab (BLE mapping sub-tabs, Wand Lab, Palettes, Settings, map view, etc.) renders and behaves identically to the pre-migration file
   - [ ] WLED capture/preview flows (`testPreset`, `runCaptureFromWled`, `captureFromWled`) still work against a real WLED IP
   - [ ] Wand Lab send-to-simulator flows still work against a real WandSimulator — both `POST /send` (line and hex forms) and, once Part 2 lands, `POST /show` + `GET /status` polling + `POST /stop`
   - [ ] All existing localStorage-backed settings persist across the swap
   - [ ] No console errors on load or on switching every tab at least once
   - [ ] Mantine theme colors/spacing visually match the old CSS-variable palette closely enough that this reads as a structural migration, not a redesign — Rob should not be surprised by the visual result
   - [ ] Dark color scheme is set explicitly in the Mantine theme (the existing app is dark-only; Mantine defaults to light, so this needs to be set deliberately, not left to a media-query default)
   - [ ] GitHub Actions workflow successfully builds and deploys to the same GitHub Pages URL Rob currently uses, with the repo's Pages source switched to "GitHub Actions" (confirm this manual setting change was made, since Cursor can't do it directly)
   - [ ] Every tab is usable (not just technically rendered) at phone width, iPad mini portrait (768px), and iPad portrait/landscape — tab navigation, forms, and the byte-editor grid in Wand Lab all remain operable without horizontal scrolling or cut-off controls

---

## Part 2 — Wand Lab additions for faster opcode testing

These should be built as new components/modules inside the migrated structure (`src/components/ble/WandLabShowPanel.jsx`, `src/components/ble/WandLabCaptureImport.jsx`), composed into `WandLabTab.jsx` as new sections, not appended as more inline JSX in one giant function the way the current tab is structured. `WandLabTab` is already doing a lot in one component (state for MB command builder, raw byte editor, and log, all in one function) — this is a good opportunity to split it into smaller composed pieces during the migration rather than growing it further.

Also add a small shared `src/lib/ble/wandSimClient.js` module wrapping the actual endpoints (`getStatus`, `sendLine`, `sendHex`, `startShow`, `stop`) per `API.md`, so every Part 2 feature below goes through one place that knows the company-ID-byte rules, rather than each component re-implementing fetch calls and re-deriving whether a given hex string needs `8301` stripped or kept.

### 2a. Burst / repeat-send → build on `/show`, not a client-side timer loop

**Problem this solves:** testing an animation's duration or confirming a packet needs repetition (like the real captures show — e.g. `cc03` pings firing every 30-70ms, or E905 firing every ~1-2s) currently means manually clicking send repeatedly.

**This should use `POST /show`, not a client-side `setInterval` wrapping `/send`.** `/send` blocks for ~4 seconds per call to match real advertisement pickup timing — a client-side loop calling `/send` on a timer will desync badly against that blocking behavior (a "send every 1000ms" loop will actually run far slower once each call's real ~4s latency is accounted for), whereas `/show` is explicitly built for exactly this: a queued, timed sequence of steps that plays back asynchronously in firmware, with `/status` polling for progress and `/stop` to cancel.

Add a small control cluster near the existing "Send raw bytes" button:

- **Repeat count** input (default 1, min 1, max something sane like 200)
- **Dwell (ms)** input between repeats (default 1000)
- **Start/Stop** button — clicking Start builds a `/show` body by repeating the current byte array `N` times with `holdMs` = the dwell value on every line except the last (give the last step a longer fallback hold, e.g. 3000ms, matching the practical guidance in `API.md` for capture-derived shows), `POST`s it once via `startShow`, then polls `GET /status` on an interval (~250-500ms) to drive a live progress display ("Step 4 / 20") from `showStep`/`showTotal`. Clicking Stop calls `POST /stop`.
- **Company ID byte handling:** `/show` steps need the **full** bytes including the `8301` prefix (same convention as a capture file's `hex` column), which is the _opposite_ convention from `/send {"hex":...}` (payload-only, no `8301`). Since the existing raw byte editor's byte array is presumably payload-only today (matching `/send hex`'s convention), building a `/show` body from it means prepending `8301` to each repeated line — make sure this prefixing happens in the shared `wandSimClient.js` builder, not left to whichever component happens to call it first, since getting this backwards is the single easiest bug this API invites.

Implementation notes:

- Clean up the status-polling interval in a `useEffect` return function so navigating away from the tab mid-show doesn't leave a dangling poll running against a board that's moved on.
- If `showActive` in `/status` goes false before the expected step count is reached (e.g. another client called `/stop`, or a new `/show` replaced the queue), reflect that in the UI rather than assuming only this tab could have stopped it — `API.md` notes shows aren't exclusive to one client.
- Log entries: don't create one log entry per repeat — offer a single "Log this burst" action after the show completes (or is stopped), pre-filled with the byte pattern and a note template like `"Burst via /show: N reps, Xms dwell"` that Rob can edit before saving.

### 2b. Byte-sweep mode (walk one byte through a range) → also a `/show` sequence, built client-side

**Problem this solves:** the test plan's Priority 1b (E9 0C selector-byte sweep) and Priority 2b (E9 11 palette substitution) both require manually editing one byte position repeatedly and re-sending. This should be a first-class workflow.

Same reasoning as 2a applies — a sweep across 256 values at a few seconds each is exactly the kind of long, precisely-timed sequence `/show` is built for, not 256 individual blocking `/send` calls. Build the full sequence of byte arrays client-side (one per swept value), convert each to a `holdMs`+full-bytes `/show` step, and submit as one batch.

Add a "Sweep" mode, toggleable from the raw byte editor section:

- Clicking a byte's index label (the small gray number above each byte input, e.g. the `<span>{i}</span>` in the existing byte editor) marks that byte as the **sweep target** — highlight it distinctly (e.g. a third border color, not reusing the existing "modified from original" purple).
- Once a target is set, show a small inline panel:
  - **Start value** / **End value** (hex, default `00`–`FF`)
  - **Step** (default `01`)
  - **Dwell per value (ms)** (default 3000, matching the test plan's suggested cadence) — this becomes the `holdMs` for every step but the last
  - **Run sweep** button — builds the full `/show` body (one step per swept value, target byte substituted, rest of the array unchanged, `8301` prefix added per the company-ID rule above), submits it once, then polls `/status` for progress ("Testing 0x4A (37 / 256)") derived from `showStep`/`showTotal`, with a Stop button wired to `POST /stop`
- While a sweep is running, show the current full byte array's hex string prominently (reuse the existing hex display), computed client-side from `showStep` against the sweep's own value list (since `/status` reports step index, not the byte value at that step) — this is what Rob screen-records or narrates against what he's seeing on the LEDs, so it needs to stay accurate to whichever step is actually live.
- After a sweep completes (or is stopped early), prompt to save a **sweep summary log entry** distinct from the regular per-byte-value log: one entry recording the sweep range, step, dwell, and byte position, with a single free-text note field for Rob's overall observation (e.g. "class changes around 0x20, no further change past 0x80") rather than forcing one log entry per value tested. If Rob wants per-value logging later, that's a separate ask — don't over-build this now.

### 2c. Paste-from-capture import — now with explicit source/destination hex conventions

**Problem this solves:** right now, getting a byte sequence from a capture file into the Wand Lab byte editor means manually stripping the `8301` envelope prefix and any trailing bytes Rob doesn't want to replay, by hand, every time. This is exactly the friction in every test plan handoff so far — and per `API.md`, getting the prefix handling backwards is the single most likely bug in this whole feature area, so this needs to be more deliberate than "just strip it."

Extend the existing "Paste hex" input (`hexPaste` state, `applyHexPaste` handler) rather than building a separate control:

- **A capture file's `hex` column already includes the `8301` prefix** (per `API.md`'s table) — this matches what `/show` and Serial `raw <hex>` both want as-is, but is the opposite of what `/send {"hex":...}` wants (payload-only). Since the byte editor's array is presumably used to drive `/send hex` today, pasted capture hex needs the `8301` stripped for that path specifically — but if the paste import is feeding into the new `/show`-based sweep/burst tooling in 2a/2b instead, it should be left intact. Make the destination explicit in the UI (e.g. the paste control should make clear whether it's loading into the single-send byte editor vs. queuing a `/show`), rather than having one silent strip-or-not toggle that's correct for one destination and wrong for the other.
- Detect if the pasted string starts with the known capture envelope prefix `8301` (case-insensitive, optional whitespace) and offer a checkbox or auto-toggle: **"Strip 8301 envelope prefix"**, defaulted appropriately for whichever destination the paste is headed to (on when loading into the payload-only single-send editor, off when queuing a `/show` step). Cursor should confirm with Rob whether `8301` is always the outer envelope or sometimes varies (e.g. `8301e1` vs `8301e2` — from the capture data both exist) — the strip should only remove the fixed `8301` bytes, leaving the `e1`/`e2` session-role byte intact, since that byte appears meaningful (ref: parade capture notes on `e100`/`e200`).
- Support pasting a **full tab-separated capture line** (e.g. copy-pasting directly from a `.txt` capture file row like `1783304853204\t-86\tPING\tCC03 wake ping\t\t\t8301cc03000100\t`) — detect tabs in the pasted input, and if found, extract just the hex column (7th field) automatically rather than requiring Rob to manually copy just the hex portion out of a capture file. This directly removes a manual step every time Rob wants to replay something from a real capture.
- **Multi-line paste support**: since `/show` steps are naturally built from multiple capture rows, support pasting several tab-separated capture lines at once (one per line) and building a `/show` body directly from them — per `API.md`'s guidance, this means deduping consecutive identical `hex` values first (capture rows appear twice per real packet on duplicate BLE channels) and deriving `holdMs` from consecutive **distinct** rows' `ts_ms` delta, with a fallback hold (e.g. 3000ms) for the final step. This turns "replay this chunk of a real capture" into a single paste-and-go action rather than a manual per-row rebuild.
- After import, keep the existing behavior of loading into the byte editor (`setByteArray`) for the single-paste case, but change the success status message to reflect what was stripped or kept, e.g. `"Loaded 9 bytes (stripped 8301 for /send)"` vs `"Loaded 9 bytes (8301 kept for /show)"`, so Rob can confirm the tool did what he expected for the path he's actually using.

### 2d. Small addition: known-family quick-tags

The `WAND_LAB_TAGS` list already exists for the observation log. Given the ongoing opcode research is now organized around specific families (`e9 0c`, `e9 10/11/12`, `cd07`, `c013`/`c00f`, `e409`/`e501`), add these as additional entries in `WAND_LAB_TAGS` (find its definition alongside the other `WAND_LAB_*` constants) so log entries can be filtered by opcode family directly, matching the structure already used in the test plan doc. Confirm the exact current contents of `WAND_LAB_TAGS` before editing — don't guess at what's already there.

### 2e. Named-command shortcuts (leverage the firmware's existing Serial/`/send{"line"}` command set)

**Problem this solves:** the firmware already has a rich, named command set (`mb red`, `mb five <tl> <bl> <br> <tr> <c>`, `sw fx rainbow`, `mbsweep`, `mbloop <color>`, `swfxloop`, `test <segment>`, etc.) reachable via `POST /send {"line": "..."}` — building a byte array by hand for something like "set all five LEDs to specific colors" duplicates work the firmware already does better, since `mb five` handles the E909 encoding itself.

Add a lightweight "Quick commands" section to `WandLabTab`, separate from the raw byte editor, that surfaces the more commonly-needed named commands as actual UI controls rather than requiring Rob to remember/type the exact Serial syntax:

- A palette/color picker feeding `mb <name>` and `mb five <tl> <bl> <br> <tr> <c>` (five separate pickers) — sends via `sendLine`, not `sendHex`, so the company-ID question doesn't even arise for this path.
- Buttons for the built-in loop commands already in firmware — `mbsweep`, `mbloop <color>`, `swfxloop` — each just calling `sendLine` with the right string, plus a shared **Stop** button calling `POST /stop` (which per `API.md` already cancels any of these). **Don't reimplement these loops client-side** — the firmware already runs them server-side; the web UI's job here is just to trigger and display status, not to drive the timing itself.
- `sw fx <name>` as a dropdown of the documented preset names (`rainbow`, `flash`, `sparkle`, `pulse`, `circle`, `fade`, `fade2`, `blink`, `palette5`) plus a Send button.
- `test <segment>` as a quick "highlight this region" control (dropdown of `all`/`inner`/`outer`/`five`/`topLeft`/`topRight`/`bottomLeft`/`bottomRight`/`center`/`band0`–`band7`) — useful for confirming LED wiring/mapping independent of any opcode work.

This section can reuse the existing `sending`/status-message patterns already in `WandLabTab` — it's a thin UI layer over `sendLine`, no new async complexity beyond what single-send already has.

---

## Sequencing recommendation

1. Scaffold Vite project, get a barebones version building and rendering the current App unchanged (Part 1, steps 1–3).
2. Finish the rest of the migration (steps 4–8) and get sign-off from Rob that it behaves identically to the old file before adding any new features.
3. Build Part 2 features one at a time (2a, then 2b, then 2c, then 2d, then 2e), each as a small standalone commit/PR so they're easy to review and roll back independently if one doesn't feel right in practice. Build `wandSimClient.js` (the shared API wrapper) as part of 2a, since 2b/2c/2e all depend on it rather than each reimplementing fetch calls.

Do not combine the migration and the new features into one large change — if something breaks, it needs to be obvious whether the migration or the new feature caused it.

---

## Part 3 — Design tokens for future cross-platform reuse (small, do during Part 1)

This is not a React Native build-out — the Expo companion app is a separate future milestone per Rob's existing project notes. This is just making sure the _values_ (not components) that define the look of the web app live somewhere the future Expo app can import without re-guessing hex codes and spacing by eye.

1. Create `src/styles/tokens.js` as a plain JS module with no Mantine or React import — just exported constants:

   ```js
   export const colors = {
     bg: "#0a0a0f",
     surface: "#12121e",
     surface2: "#1a1a2e",
     border: "#2a2a3e",
     primary: "#a78bfa",
     primaryDim: "#a78bfa22",
     success: "#22c55e",
     warning: "#f59e0b",
     danger: "#ef4444",
     text: "#e8e8f0",
     text2: "#9090b0",
     text3: "#4a4a6a",
     indoor: "#60a5fa",
   };
   // spacing scale, radii — extract from the existing inline styles' most common values
   // rather than inventing a new scale; audit a sample of the existing style={{}} objects
   // for the actual padding/margin/borderRadius numbers already in use.
   export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
   export const radius = { sm: 4, md: 8, lg: 12 };
   ```

   Pull the exact values from the existing `:root` block in `index.html` verbatim for colors — don't approximate them. For spacing/radius, audit a representative sample of existing inline styles (the file has hundreds) to find the de facto scale already in use, since one doesn't currently exist as named constants.

2. `src/styles/theme.js` imports from `tokens.js` and builds the Mantine `createTheme()` object from those values, so there's exactly one source of truth for "what is primary purple" rather than the color living twice (once in Mantine's theme, once in a separate tokens file that could drift).

3. **Do not** attempt to set up any React Native / Expo tooling, shared component abstraction, or cross-platform styling library (Tamagui, NativeWind, etc.) as part of this task. That decision belongs with Rob when the Expo app work actually starts, and depends on choices not yet made (e.g. whether the watch app's SwiftUI target also wants to consume these tokens, which would push toward a format more portable than a JS module, like a JSON or YAML tokens file consumed by a small build step on both sides). Keep this step small and reversible: a plain JS values file costs almost nothing now and can be re-exported as JSON later if a cross-platform tokens pipeline becomes worth building.
