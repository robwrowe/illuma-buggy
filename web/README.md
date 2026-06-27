# Illuma Buggy — Web Config Tool

A local web app for configuring zones, presets, palettes, and settings
without needing to be at a theme park.

## Setup

1. Open `index.html` in the file and find this line near the top:
   ```
   <script src="https://maps.googleapis.com/maps/api/js?key=PASTE_YOUR_GOOGLE_MAPS_KEY_HERE&libraries=drawing,geometry"></script>
   ```
   Replace `PASTE_YOUR_GOOGLE_MAPS_KEY_HERE` with your Google Maps API key.

2. Launch the dev server (required — can't run from file://):
   ```
   ./serve.sh
   ```
   This starts a Python HTTP server and opens your browser automatically.
   Or manually: `python3 -m http.server 3000` then open http://localhost:3000

## Features

- **Map & Zones** — Draw preset zones and indoor zones on satellite map.
  Click existing zones to edit them. Pin selection: click a pin then click
  the map to move it.
- **Presets** — Create and edit presets with effect ID, palette, speed,
  intensity, and recall memory settings.
- **Palettes** — Create custom color palettes with up to 16 colors.
  Preview as a gradient. Assign to presets.
- **Brightness** — Configure daytime/nighttime/indoor brightness and
  solar threshold settings. Shows current sun elevation at Walt Disney World.
- **Settings** — Override behavior, MagicBand+ 5-point mode, recall state.

## Workflow

1. Configure everything in the web tool
2. Click **Export** to download a JSON file
3. In the Illuma Buggy app → Settings → Import → select the file
4. All your zones, presets, and settings are loaded

## Notes

- Data is auto-saved to browser localStorage as you work
- The map defaults to Walt Disney World — navigate anywhere
- Custom palettes are stored in the app config; WLED custom palette
  support requires the firmware to receive the palette data (future feature)
