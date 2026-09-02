# Runbook — Android app release

Ship a sideload APK of the Illuma Buggy companion app (`com.illumabuggy.app`) onto a Pixel (or other Android phone). This is **not** a Play Store publish. BLE does not work in Expo Go — every field install is a custom build.

```
┌──────────────────────┐     EAS cloud (CNG)      ┌────────────────────┐
│ app/ source          │ ───────────────────────► │ signed APK         │
│ app.config.js        │   expo prebuild + Gradle │ (no Metro needed)  │
│ eas.json profile     │                          │                    │
└──────────────────────┘                          └─────────┬──────────┘
                                                            │ sideload / adb
                                                            ▼
                                                   Pixel: Illuma Buggy
```

| Artifact | Role |
|----------|------|
| **EAS `preview` APK** | Field / park release — standalone JS, no Metro, no expo-dev-client launcher |
| **EAS `production` APK** | Same as preview, plus `versionCode` auto-increment |
| **EAS `development` APK** | Dev client — phone still needs Metro on the laptop |
| **Local Gradle release** | Fast bench APK; **still includes the dev-client binary** |

---

## Quick decision guide

| Goal | Use |
|------|-----|
| **Park / field phone (clean prod)** | **`npm run build:apk:prod:clean`** |
| Incremental field APK (no versionCode bump) | Path A — `./build-apk.sh prod --eas` |
| Daily JS iteration with BLE | Dev client + Metro (`npm run start:clear`) |
| No EAS / no network | Path C — local Gradle (dev-client still in the binary) |
| New native module (`react-native-*`, Expo plugin) | Clean prod (same command as park phone) |

`npm run build:clean` is **not** a production build — it is the EAS **development** profile (needs Metro).

---

## Prerequisites (once)

Do these before the first release, then skip unless something breaks.

1. **Node 18+** and `eas-cli`:

   ```bash
   npm install -g eas-cli
   eas login
   ```

2. **Expo project** is already linked in `app/app.config.js` (`extra.eas.projectId`). Do not re-run `eas build:configure` unless Expo says the project is unlinked.

3. **Google Maps key** as an EAS secret (zones will be blank without it):

   ```bash
   cd app
   eas secret:list
   # if GOOGLE_MAPS_API_KEY is missing:
   eas secret:create --name GOOGLE_MAPS_API_KEY --value '<key>' --scope project
   ```

   `app.config.js` injects `process.env.GOOGLE_MAPS_API_KEY` at EAS build time. Local builds read `app/.env` instead. Never commit `.env`.

4. **Android signing** is stored on EAS (credentials). First build may prompt to generate a keystore. Keep using the same keystore for every later APK, or Android will refuse the install-over.

5. Confirm you are in `app/` (EAS config lives there, not repo root).

---

## Before you build

1. Commit (or stash) the JS you actually want in the APK. EAS uploads the current working tree.
2. Bump the **user-visible version** if this is a named release. It is hardcoded in both places — keep them in sync:

   - `app/app.config.js` → `version`
   - `app/app.json` → `expo.version`

   Android `versionCode` (the integer that decides whether an APK can replace an older one) is **not** in those files. `eas.json` `production.autoIncrement` owns it; `preview` does not auto-increment.
3. Confirm `GOOGLE_MAPS_API_KEY` is still on EAS (`eas secret:list`).
4. **Do not** run `expo prebuild` or leave a half-generated `app/android/` before an EAS job. `android/` is gitignored. A partial local `android/` is uploaded without `gradlew`, and the cloud job skips CNG prebuild → `ENOENT ... gradlew`. The clean prod command below deletes those dirs for you.

---

## Clean production build (field release)

Use this for a park phone, after adding a native dependency, or whenever the previous APK feels stale. It wipes local native/cache dirs, reinstalls JS deps, and submits the EAS **`production`** profile (standalone APK, no Metro, no expo-dev-client, `versionCode` auto-increment).

### One command

```bash
cd app
npm run build:apk:prod:clean
```

That is:

```bash
./build-apk.sh prod --eas --clean --production
```

What it does:

1. Deletes `node_modules/`, `android/`, and `.expo/` — **does not** run local `expo prebuild` (EAS CNG does that in the cloud)
2. `npm install --legacy-peer-deps`
3. `eas build --platform android --profile production --wait --non-interactive`
4. Downloads to `app/dist/illuma-buggy-prod.apk`

Build time is typically 10–20 minutes. Watch logs at [expo.dev](https://expo.dev).

### Manual equivalent

```bash
cd app

# 1. Confirm the JS you want is saved
git status

# 2. Optional: bump the visible version in app.config.js and app.json (keep in sync)

# 3. Maps key must exist on EAS (not only in app/.env)
eas secret:list   # expect GOOGLE_MAPS_API_KEY

# 4. Wipe local native dirs so EAS runs a full cloud prebuild
rm -rf node_modules android .expo

# 5. Reinstall
npm install --legacy-peer-deps

# 6. Production profile — APK, autoIncrement versionCode
eas build --platform android --profile production --wait

# 7. Fetch the artifact
mkdir -p dist
eas build:download --platform android --profile production --latest -o dist/illuma-buggy-prod.apk
```

Then [install on the Pixel](#install-on-the-pixel) and run the [verify](#verify-the-release) table.

`cli.appVersionSource` is `"remote"` — EAS stores the next `versionCode` on the project. Do not mix ad-hoc local signing with this profile if you still want install-over.

`eas.json` `submit.production` exists, but this project sideloads APKs. Do not run `eas submit` unless you are actually publishing to Play.

---

## Path A — Incremental field APK (preview, no versionCode bump)

Standalone APK via the **preview** profile. This is what `build-apk.sh prod --eas` does.

```bash
cd app
./build-apk.sh prod --eas            # preview profile (fails if android/ exists)
./build-apk.sh prod --eas --clean    # same, after wiping local native dirs
```

What it does:

1. `eas build --platform android --profile preview --wait --non-interactive`
2. Downloads the APK to `app/dist/illuma-buggy-prod.apk`

`preview` in `eas.json`: internal distribution, `buildType: apk`, **no** `developmentClient`. JS is baked in. Open the app on the phone with no Metro.

Build time is typically 10–20 minutes on EAS. Watch it at [expo.dev](https://expo.dev) if you want logs.

Equivalent without the helper:

```bash
cd app
eas build --platform android --profile preview --wait
eas build:download --platform android --profile preview --latest -o dist/illuma-buggy-prod.apk
```

---

## Path C — Local Gradle (bench only)

Needs Android Studio / SDK + JDK 17–23 (Gradle 8.13). Default ABI is `arm64-v8a` (Pixel).

```bash
cd app
# maps key: export GOOGLE_MAPS_API_KEY=...  or put it in app/.env
./build-apk.sh prod --install          # release APK + adb install -r
# or
./build-apk.sh prod --clean            # wipe android/ + prebuild first
```

Output: `app/dist/illuma-buggy-prod.apk`.

**Caveat:** local release still ships the expo-dev-client binary. For a park phone, use the [clean production build](#clean-production-build-field-release).

---

## Install on the Pixel

### USB (`adb`)

```bash
adb devices          # must show "device", not "unauthorized"
adb install -r app/dist/illuma-buggy-prod.apk
```

`-r` replaces the existing `com.illumabuggy.app` if the signing key matches and `versionCode` is ≥ the installed one.

### Files app / Drive

1. Copy `illuma-buggy-prod.apk` to the phone.
2. Open it. Allow **Install unknown apps** for Files / Chrome / Drive if prompted.
3. If Android says the app is not an official store app, that is expected for sideload.

### After install

- A **preview/production** APK launches by itself — no Metro.
- A **development** APK waits for Metro on the laptop:

  ```bash
  cd app && npm run start:clear
  ```

  Phone and Mac must be on the same LAN (or use a tunnel). BLE still works in the dev client; only JS is loaded from Metro.

---

## Verify the release

Do this on the phone that will go to the park, with the logic board powered.

| # | Check | Pass |
|---|--------|------|
| V1 | App icon / splash | Opens; no expo-dev-client launcher (clean prod / Path A) |
| V2 | Permissions | Bluetooth, location (precise), notifications — grant all; background location if you use zones |
| V3 | BLE connect | Home → connect to **IllumaBuggy**; session becomes ready (not just “connected”) |
| V4 | Maps | Zones screen shows the map (proves the Maps key made it into the binary) |
| V5 | Preset apply | Fire a known preset; strip changes |
| V6 | Config sync | After connect, rules / MB mapping / brightness look current (or use **Sync board config**) |
| V7 | GPS zones | Outdoor: enter a drawn zone → preset triggers (zones enabled) |
| V8 | Kill & reopen | Force-stop, reopen, reconnect — no Metro prompt |

If V4 fails but V3 works, the APK is fine except `GOOGLE_MAPS_API_KEY` was empty at build time — set the EAS secret and rebuild.

---

## Profiles cheat sheet (`app/eas.json`)

| Profile | `developmentClient` | Android output | Auto `versionCode` | Helper |
|---------|---------------------|----------------|--------------------|--------|
| `development` | yes | APK (internal) | no | `./build.sh` or `./build-apk.sh dev --eas` |
| `preview` | no | APK | no | `./build-apk.sh prod --eas` |
| `production` | no | APK | yes | `npm run build:apk:prod:clean` |

All three are APKs. None of them produce an AAB. `npm run build:clean` is the **development** profile with a local wipe — not production.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| EAS `ENOENT ... gradlew` | Local `app/android/` present; CNG prebuild skipped | `npm run build:apk:prod:clean` (or `rm -rf android .expo` then rebuild). Never prebuild before EAS |
| Script exits: `android/ exists` | Leftover local prebuild | Re-run with `--clean`, or delete `android/` |
| Zones map is blank / grey | Missing Maps key in that binary | `eas secret:list`; recreate `GOOGLE_MAPS_API_KEY`; rebuild clean prod |
| App asks for Metro / shows dev menu | Dev-client APK (`development` profile, `npm run build:clean`, or local Path C) | Rebuild with `npm run build:apk:prod:clean` |
| `adb install` fails: signatures | Different keystore than the installed app | Uninstall `com.illumabuggy.app` (wipes local app data), or keep using the EAS keystore |
| `adb install` fails: version downgrade | `versionCode` not higher | Clean prod (`production` autoIncrement), or uninstall first |
| BLE missing / crash on scan | Built with Expo Go, or stale native project after adding a native dep | Always custom build; for new native deps use clean prod |
| New `react-native-*` dep does nothing | Metro-only; native code not in the APK | Clean prod rebuild. Hot reload is not enough |
| JDK / Gradle errors locally | Java 24+ or no Android SDK | Clean prod (EAS) instead, or JDK 17–21 + Android Studio SDK |
| Build queued forever | EAS plan / concurrent limit | Cancel old builds on expo.dev, or wait |
| Wrong JS in the APK | Uncommitted files, or built from the wrong directory | Run EAS from `app/`; confirm `git status` before kicking the build |

---

## Related

- `app/build-apk.sh` — APK helper (`prod --eas --clean --production` = clean field release)
- `app/package.json` — `npm run build:apk:prod:clean`
- `app/build.sh` — EAS **development** profile only (`npm run build:clean` is not prod)
- `app/eas.json` — profiles
- `app/app.config.js` — package id, Maps key, EAS project id
- [app/README.md](../app/README.md) — day-to-day Expo / Metro setup
- [mb-sw-test-checklist.md](./mb-sw-test-checklist.md) — park / bench BLE checks after the app is on the phone
