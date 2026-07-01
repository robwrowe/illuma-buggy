#!/usr/bin/env bash
# build-apk.sh — Build Android APKs for sideloading on your Pixel
#
# Usage:
#   ./build-apk.sh dev              # dev client debug APK (needs Metro after install)
#   ./build-apk.sh prod             # release APK with embedded JS (no Metro)
#   ./build-apk.sh dev --install    # build + adb install to connected Pixel
#   ./build-apk.sh prod --eas       # cloud build via EAS (true prod, no dev client)
#   ./build-apk.sh dev --clean      # wipe android/ and re-prebuild first
#
# After installing a dev build, start Metro on your Mac:
#   npx expo start --dev-client

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODE=""
USE_EAS=false
CLEAN=false
INSTALL=false
ALL_ARCHS=false

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  echo ""
  echo "Options:"
  echo "  --eas         Build on EAS cloud instead of local Gradle (uses EAS secrets)"
  echo "  --clean       Remove android/ and .expo, then run expo prebuild"
  echo "  --install     adb install -r the APK after a local build"
  echo "  --all-archs   Build all ABIs (slower; default is arm64-v8a for Pixel)"
  echo "  -- <args>     Pass extra args to Gradle (e.g. -- --stacktrace)"
  echo "  -h, --help    Show this help"
}

GRADLE_EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    dev|prod) MODE="$1" ;;
    --eas) USE_EAS=true ;;
    --clean) CLEAN=true ;;
    --install) INSTALL=true ;;
    --all-archs) ALL_ARCHS=true ;;
    -h|--help) usage; exit 0 ;;
    --)
      shift
      GRADLE_EXTRA_ARGS=("$@")
      break
      ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
  shift
done

if [[ -z "$MODE" ]]; then
  usage
  exit 1
fi

if [[ "$USE_EAS" == true && "$INSTALL" == true ]]; then
  echo "Note: --install only applies to local builds. EAS builds save the APK to dist/."
  INSTALL=false
fi

ARCH="arm64-v8a"
if [[ "$ALL_ARCHS" == true ]]; then
  ARCH="armeabi-v7a,arm64-v8a,x86,x86_64"
fi

DIST_DIR="$SCRIPT_DIR/dist"
APK_NAME="illuma-buggy-${MODE}.apk"
APK_PATH="$DIST_DIR/$APK_NAME"

load_maps_key() {
  if [[ -n "${GOOGLE_MAPS_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ -f "$SCRIPT_DIR/.env" ]]; then
    # shellcheck disable=SC2046
    export GOOGLE_MAPS_API_KEY="$(
      grep -E '^GOOGLE_MAPS_API_KEY=' "$SCRIPT_DIR/.env" | head -1 | cut -d= -f2- | tr -d "'\""
    )"
  fi
  if [[ -z "${GOOGLE_MAPS_API_KEY:-}" ]]; then
    echo "⚠️  GOOGLE_MAPS_API_KEY is not set (export it or add to app/.env)."
    echo "   Zone maps will not work without it."
    if [[ "$USE_EAS" == false ]]; then
      read -r -p "Continue without Maps key? (y/N) " confirm
      if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        exit 1
      fi
    fi
  fi
}

ensure_deps() {
  if [[ ! -d node_modules ]]; then
    echo "📦 Installing dependencies..."
    npm install --legacy-peer-deps
  fi
}

ensure_android_project() {
  if [[ "$CLEAN" == true ]]; then
    echo "🧹 Cleaning android/ and .expo..."
    rm -rf android .expo
  fi
  if [[ ! -f android/gradlew ]]; then
    echo "🔧 Running expo prebuild (android)..."
    load_maps_key
    npx expo prebuild --platform android --no-install
  fi
}

java_major_version() {
  local java_bin="$1"
  "$java_bin" -version 2>&1 | head -1 | sed -E 's/.*version "([0-9]+).*/\1/'
}

java_is_compatible() {
  local major="$1"
  case "$major" in
    17|18|19|20|21|22|23) return 0 ;;
    *) return 1 ;;
  esac
}

setup_java() {
  if [[ -n "${JAVA_HOME:-}" && -x "${JAVA_HOME}/bin/java" ]]; then
    local major
    major="$(java_major_version "${JAVA_HOME}/bin/java")"
    if java_is_compatible "$major"; then
      echo "☕ Using JAVA_HOME (Java $major): $JAVA_HOME"
      return 0
    fi
    echo "⚠️  JAVA_HOME points to Java $major (Gradle needs 17–23)."
  fi

  local candidates=(
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  )

  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    while IFS= read -r home; do
      [[ -n "$home" ]] && candidates+=("$home")
    done < <(
      /usr/libexec/java_home -v 21 2>/dev/null
      /usr/libexec/java_home -v 17 2>/dev/null
    )
  fi

  for home in "${candidates[@]}"; do
    [[ -x "$home/bin/java" ]] || continue
    local major
    major="$(java_major_version "$home/bin/java")"
    if java_is_compatible "$major"; then
      export JAVA_HOME="$home"
      export PATH="$JAVA_HOME/bin:$PATH"
      echo "☕ Using Java $major: $JAVA_HOME"
      return 0
    fi
  done

  local system_major=""
  if command -v java >/dev/null 2>&1; then
    system_major="$(java_major_version java)"
  fi

  echo "❌ No compatible JDK found (need Java 17–23 for Gradle 8.13)."
  if [[ -n "$system_major" ]]; then
    echo "   Your default java is version $system_major, which is too new."
  fi
  echo "   Android Studio bundles JDK 21 — install it, or:"
  echo "   brew install openjdk@21"
  echo "   export JAVA_HOME=\"\$(/usr/libexec/java_home -v 21)\""
  exit 1
}

setup_android_sdk() {
  local candidates=()

  if [[ -n "${ANDROID_HOME:-}" ]]; then
    candidates+=("$ANDROID_HOME")
  fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" && "${ANDROID_SDK_ROOT}" != "${ANDROID_HOME:-}" ]]; then
    candidates+=("$ANDROID_SDK_ROOT")
  fi
  candidates+=(
    "$HOME/Library/Android/sdk"
    "$HOME/Android/Sdk"
  )

  local sdk=""
  for candidate in "${candidates[@]}"; do
    if [[ -d "$candidate/platforms" ]]; then
      sdk="$candidate"
      break
    fi
  done

  if [[ -z "$sdk" ]]; then
    echo "❌ Android SDK not found."
    echo "   Install Android Studio, open SDK Manager, and install:"
    echo "   - Android SDK Platform"
    echo "   - Android SDK Build-Tools"
    echo "   - NDK (Side by side)"
    echo "   Or use --eas for a cloud build."
    exit 1
  fi

  export ANDROID_HOME="$sdk"
  export ANDROID_SDK_ROOT="$sdk"
  export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

  if [[ ! -d android ]]; then
    echo "❌ android/ project not found — run prebuild first."
    exit 1
  fi

  printf 'sdk.dir=%s\n' "$sdk" > android/local.properties
  echo "🤖 Android SDK: $sdk"
}

check_local_toolchain() {
  setup_java
}

run_gradle() {
  local variant="$1"
  setup_android_sdk
  echo "🏗️  Gradle assemble${variant} (${ARCH})..."
  (
    cd android
    if ((${#GRADLE_EXTRA_ARGS[@]} > 0)); then
      ./gradlew ":app:assemble${variant}" -PreactNativeArchitectures="$ARCH" "${GRADLE_EXTRA_ARGS[@]}"
    else
      ./gradlew ":app:assemble${variant}" -PreactNativeArchitectures="$ARCH"
    fi
  )
}

copy_apk() {
  local src="$1"
  mkdir -p "$DIST_DIR"
  cp "$src" "$APK_PATH"
  echo ""
  echo "✅ APK ready: $APK_PATH"
  ls -lh "$APK_PATH"
}

maybe_install() {
  if [[ "$INSTALL" != true ]]; then
    return 0
  fi
  if ! command -v adb >/dev/null 2>&1; then
    echo "⚠️  adb not found — copy the APK to your Pixel manually."
    return 0
  fi
  if ! adb devices 2>/dev/null | grep -q '[[:space:]]device$'; then
    echo "⚠️  No adb device found — copy the APK to your Pixel manually."
    return 0
  fi
  echo "📲 Installing on connected device..."
  adb install -r "$APK_PATH"
}

build_local_dev() {
  check_local_toolchain
  ensure_deps
  ensure_android_project
  run_gradle "Debug"
  copy_apk "android/app/build/outputs/apk/debug/app-debug.apk"
  maybe_install
  echo ""
  echo "Dev build installed. On your Mac, run:"
  echo "  cd app && npm run start:clear"
  echo "Then open Illuma Buggy on the Pixel — it loads JS from Metro."
}

build_local_prod() {
  check_local_toolchain
  ensure_deps
  ensure_android_project
  run_gradle "Release"
  copy_apk "android/app/build/outputs/apk/release/app-release.apk"
  maybe_install
  echo ""
  echo "Prod build ready — JS is embedded, no Metro required."
  echo "Note: local release builds still include the dev-client binary."
  echo "      Use --eas for a clean production APK without the dev launcher."
}

build_eas() {
  ensure_deps
  if ! command -v eas >/dev/null 2>&1; then
    echo "❌ eas-cli not found. Run: npm install -g eas-cli"
    exit 1
  fi

  local profile
  case "$MODE" in
    dev) profile="development" ;;
    prod) profile="preview" ;;
  esac

  echo "☁️  Submitting $profile build to EAS..."
  eas build --platform android --profile "$profile" --wait --non-interactive

  mkdir -p "$DIST_DIR"
  echo "⬇️  Downloading latest APK..."
  eas build:download --platform android --profile "$profile" --latest -o "$APK_PATH"

  echo ""
  echo "✅ APK ready: $APK_PATH"
  ls -lh "$APK_PATH"

  if [[ "$MODE" == "dev" ]]; then
    echo ""
    echo "Dev build downloaded. On your Mac, run:"
    echo "  cd app && npm run start:clear"
  else
    echo ""
    echo "Prod build ready — standalone APK, no Metro required."
  fi
}

echo "🔦 Illuma Buggy — Android APK ($MODE)"
echo "======================================"

if [[ "$USE_EAS" == true ]]; then
  build_eas
else
  case "$MODE" in
    dev) build_local_dev ;;
    prod) build_local_prod ;;
  esac
fi
