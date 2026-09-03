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
| Local APK on this Mac (no EAS) | [Local Gradle](#local-gradle-build) — `./build-apk.sh prod` or `dev` |
| Daily JS iteration with BLE | Local debug APK + Metro (`npm run start:clear`) |
| New native module (`react-native-*`, Expo plugin) | Clean prod for park; local `--clean` for bench |

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

## Local Gradle build

Use this when you want an APK from this Mac without waiting on EAS: bench testing, no network, or iterating on native code. The helper is `app/build-apk.sh` **without** `--eas`.

Local **release** embeds JS (no Metro), but **still includes the expo-dev-client binary**. Local **debug** is a true dev client and needs Metro. Neither is a park APK — for that, use the [clean production build](#clean-production-build-field-release).

A leftover `app/android/` from a local build will break the next EAS job. Delete it (`rm -rf android .expo`) or use `--clean` on the EAS command before kicking a cloud build.

### Local toolchain (once)

On this Mac:

1. **Node 18+** (`cd app && npm install --legacy-peer-deps`).
2. **Android Studio** — install via [developer.android.com](https://developer.android.com/studio). Open **SDK Manager** and install:
   - Android SDK Platform (current compile SDK is fine)
   - Android SDK Build-Tools
   - NDK (Side by side)
   - Android SDK Platform-Tools (`adb`)
3. **JDK 17–23** (Gradle 8.13). Android Studio’s bundled JBR 21 is enough. The script looks for:
   - `$JAVA_HOME` if it is already 17–23
   - `/Applications/Android Studio.app/Contents/jbr/Contents/Home`
   - `/usr/libexec/java_home -v 21` then `-v 17`

   If your default `java` is 24+, set:

   ```bash
   brew install openjdk@21   # only if Studio’s JBR is missing
   export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
   ```

4. **SDK path.** The script writes `android/local.properties` from the first of `$ANDROID_HOME`, `$ANDROID_SDK_ROOT`, `~/Library/Android/sdk`, `~/Android/Sdk`.
5. **Maps key in `app/.env`** (not the EAS secret):

   ```bash
   # app/.env  — gitignored
   GOOGLE_MAPS_API_KEY=your-key-here
   ```

   Or `export GOOGLE_MAPS_API_KEY=...` in the shell. Without it, zone maps are blank; the script asks before continuing.

USB debugging: on the Pixel, enable Developer options → USB debugging, then `adb devices` must show `device` (not `unauthorized`).

### Local release APK (embedded JS)

JS is baked into the APK. The app opens without Metro. The expo-dev-client launcher can still appear.

```bash
cd app
./build-apk.sh prod                         # → app/dist/illuma-buggy-prod.apk
./build-apk.sh prod --install               # same, then adb install -r
./build-apk.sh prod --clean                 # wipe android/ + .expo, prebuild, then release
./build-apk.sh prod --clean --install       # clean rebuild + install
```

Same via npm: `npm run build:apk:prod`.

What `./build-apk.sh prod` does:

1. Picks a JDK 17–23
2. `npm install --legacy-peer-deps` if `node_modules/` is missing
3. `npx expo prebuild --platform android --no-install` if `android/gradlew` is missing (`--clean` always wipes and re-prebuilds)
4. `./gradlew :app:assembleRelease` for `arm64-v8a` (Pixel). Add `--all-archs` for every ABI
5. Copies `android/app/build/outputs/apk/release/app-release.apk` → `app/dist/illuma-buggy-prod.apk`

### Local debug APK (Metro)

Use this for day-to-day JS work with BLE. The phone loads JS from the laptop.

```bash
cd app
./build-apk.sh dev --install
# on the Mac:
npm run start:clear
```

Same via npm: `npm run build:apk:dev`. Output: `app/dist/illuma-buggy-dev.apk`.

Phone and Mac must be on the same LAN (or an Expo tunnel). Open Illuma Buggy on the Pixel; it should attach to Metro. BLE works in this build — Expo Go does not.

After a JS-only change, rebuild is not required: reload Metro. After a **native** change (new `react-native-*` dep, Expo plugin, `app.config.js` permissions), rebuild with `--clean`.

### Clean local rebuild

Needed after native deps, a broken `android/` tree, or a Gradle cache that will not recover:

```bash
cd app
./build-apk.sh prod --clean --install    # local release
./build-apk.sh dev --clean --install     # local debug
```

`--clean` locally deletes `android/` and `.expo/`, then runs `expo prebuild`. It does **not** delete `node_modules/` (unlike EAS `--clean`).

### Manual equivalent

```bash
cd app
npm install --legacy-peer-deps

# Maps key must be in the environment for prebuild to bake it into the Android manifest
export GOOGLE_MAPS_API_KEY="$(grep -E '^GOOGLE_MAPS_API_KEY=' .env | cut -d= -f2- | tr -d "'\"")"

rm -rf android .expo
npx expo prebuild --platform android --no-install

# JDK 17–23; SDK in local.properties
export JAVA_HOME="$(/usr/libexec/java_home -v 21)"
printf 'sdk.dir=%s\n' "$HOME/Library/Android/sdk" > android/local.properties

cd android
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a
# debug instead:  ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a
cd ..

mkdir -p dist
cp android/app/build/outputs/apk/release/app-release.apk dist/illuma-buggy-prod.apk
adb install -r dist/illuma-buggy-prod.apk
```

Pass extra Gradle flags after `--`, e.g. `./build-apk.sh prod -- --stacktrace`.

### Local vs EAS signing

Local Gradle uses the **debug keystore** (Expo prebuild default) unless you have configured a release keystore. EAS uses the project keystore on expo.dev. Android will refuse `adb install -r` across those signatures — uninstall `com.illumabuggy.app` first (this wipes app data: presets, zones, etc.).

Local `versionCode` does not auto-increment. If install fails as a downgrade, uninstall first.

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

- An EAS **preview/production** APK launches by itself — no Metro.
- A local **release** APK also embeds JS, but may still show the expo-dev-client UI.
- A **development** / local **debug** APK waits for Metro on the laptop:

  ```bash
  cd app && npm run start:clear
  ```

  Phone and Mac must be on the same LAN (or use a tunnel). BLE still works in the dev client; only JS is loaded from Metro.

---

## Verify the release

Do this on the phone that will go to the park, with the logic board powered.

| # | Check | Pass |
|---|--------|------|
| V1 | App icon / splash | Opens; no expo-dev-client launcher (EAS clean prod / Path A). Local release may still show the dev-client UI |
| V2 | Permissions | Bluetooth, location (precise), notifications — grant all; background location if you use zones |
| V3 | BLE connect | Home → connect to **IllumaBuggy**; session becomes ready (not just “connected”) |
| V4 | Maps | Zones screen shows the map (proves the Maps key made it into the binary) |
| V5 | Preset apply | Fire a known preset; strip changes |
| V6 | Config sync | After connect, rules / MB mapping / brightness look current (or use **Sync board config**) |
| V7 | GPS zones | Outdoor: enter a drawn zone → preset triggers (zones enabled) |
| V8 | Kill & reopen | Force-stop, reopen, reconnect — no Metro prompt |

If V4 fails but V3 works, the Maps key was empty at build time. EAS: set the secret and rebuild. Local: put it in `app/.env` and rebuild with `--clean` so prebuild picks it up.

---

## Profiles cheat sheet (`app/eas.json`)

| Profile | `developmentClient` | Android output | Auto `versionCode` | Helper |
|---------|---------------------|----------------|--------------------|--------|
| `development` | yes | APK (internal) | no | `./build.sh` or `./build-apk.sh dev --eas` |
| `preview` | no | APK | no | `./build-apk.sh prod --eas` |
| `production` | no | APK | yes | `npm run build:apk:prod:clean` |

All three are APKs. None of them produce an AAB. `npm run build:clean` is the **development** profile with a local wipe — not production.

Local Gradle (`./build-apk.sh prod` / `dev`) is not an EAS profile. It uses the debug keystore and still ships expo-dev-client.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| EAS `ENOENT ... gradlew` | Local `app/android/` present; CNG prebuild skipped | `npm run build:apk:prod:clean` (or `rm -rf android .expo` then rebuild). Never prebuild before EAS |
| Script exits: `android/ exists` | Leftover local prebuild on an EAS command | Re-run with `--clean`, or delete `android/` |
| Zones map is blank / grey | Missing Maps key in that binary | EAS: `eas secret:list` and rebuild. Local: `app/.env` + `--clean` so prebuild rebakes the key |
| App asks for Metro / shows dev menu | Dev-client APK (`development` profile, `npm run build:clean`, or local debug/release) | Park phone: `npm run build:apk:prod:clean`. Bench debug: start Metro (`npm run start:clear`) |
| `adb install` fails: signatures | Local debug keystore vs EAS keystore (or a different machine) | Uninstall `com.illumabuggy.app` (wipes local app data), then reinstall |
| `adb install` fails: version downgrade | `versionCode` not higher | EAS production autoIncrement, or uninstall first |
| BLE missing / crash on scan | Built with Expo Go, or stale native project after adding a native dep | Always custom build; local `--clean` or EAS clean prod |
| New `react-native-*` dep does nothing | Metro-only; native code not in the APK | Local: `./build-apk.sh prod --clean`. Park: clean prod. Hot reload is not enough |
| `No compatible JDK found` / Gradle fails | Java 24+ as default, or `$JAVA_HOME` wrong | `export JAVA_HOME="$(/usr/libexec/java_home -v 21)"` or install Android Studio’s JBR |
| `Android SDK not found` | Studio SDK not installed, or not in the usual path | SDK Manager → Platform + Build-Tools + NDK; or set `ANDROID_HOME` |
| `No adb device found` | USB debugging off, or unauthorized | Enable USB debugging; accept the RSA prompt; `adb devices` → `device` |
| Metro never connects | Debug APK but Metro not running, or different LAN | `cd app && npm run start:clear`; same Wi-Fi, or use a tunnel |
| Build queued forever | EAS plan / concurrent limit | Cancel old builds on expo.dev, or wait |
| Wrong JS in the APK | Uncommitted files, or built from the wrong directory | Run from `app/`; confirm `git status` before kicking EAS |

---

## Related

- `app/build-apk.sh` — APK helper (`prod --eas --clean --production` = EAS field release; `prod` / `dev` = local Gradle)
- `app/package.json` — `npm run build:apk:prod:clean` (EAS); `npm run build:apk:prod` / `build:apk:dev` (local)
- `app/build.sh` — EAS **development** profile only (`npm run build:clean` is not prod)
- `app/eas.json` — profiles
- `app/app.config.js` — package id, Maps key, EAS project id
- [app/README.md](../app/README.md) — day-to-day Expo / Metro setup
- [mb-sw-test-checklist.md](./mb-sw-test-checklist.md) — park / bench BLE checks after the app is on the phone
