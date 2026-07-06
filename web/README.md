# Illuma Buggy — Web Config Tool

Vite + React + Mantine app for configuring zones, presets, palettes, Wand Lab opcode testing, and settings without needing to be at a theme park.

## Setup

```bash
cd web
npm install
```

### Google Maps API key

On first launch you'll be prompted for a Google Maps API key (stored in browser `localStorage` as `maps-api-key`). Enable **Maps JavaScript API** and **Geocoding API** in [Google Cloud Console](https://console.cloud.google.com/google/maps-apis).

## Development

```bash
./serve.sh
# or: npm run dev
```

Open http://localhost:5173/illuma-buggy/ (Vite uses `/illuma-buggy/` base path to match GitHub Pages).

## Production build

```bash
npm run build    # output in dist/
npm run preview  # preview production build locally
```

GitHub Actions (`.github/workflows/pages.yml`) builds and deploys `web/dist` on push to `main` when `web/**` changes.

**Manual step:** In the repo's GitHub Pages settings, set the source to **GitHub Actions** (not "Deploy from branch").

## Legacy monolith

`index.legacy.html` is the pre-migration single-file Babel app, kept for reference. The live entry is `index.html` + `src/`.

## Features

- **Map & Zones** — Draw preset and indoor zones on satellite map
- **Presets** — Effect, palette, speed, recall memory
- **Palettes** — Custom color palettes
- **Shows** — Parade / fireworks bindings
- **Brightness** — Day/night/indoor solar settings
- **Wand Lab** — WandSimulator testing: byte editor, `/show` burst & sweep, capture paste, quick firmware commands
- **Settings** — BLE mapping, MB segments, recall state, export/import

## Workflow

1. Configure in the web tool (auto-saved to `illuma-buggy-active` in localStorage)
2. **Export** JSON from the header
3. Illuma Buggy app → Settings → Import

## Wand Lab / WandSimulator

See `firmware/WandSimulator/API.md`. The web tool talks to `http://<sim-ip>/status`, `/send`, `/show`, and `/stop`.

- **/send hex** — payload only (no `8301`); byte editor uses this convention
- **/show** — full bytes including `8301`; burst, sweep, and capture replay use this
