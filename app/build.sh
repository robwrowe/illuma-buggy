#!/bin/bash
# build.sh — Illuma Buggy Android dev build
# Usage: ./build.sh [--clean]

set -e  # exit on any error

echo "🔦 Illuma Buggy — Android Build"
echo "================================"

# ── Clean if requested ──────────────────────────
if [[ "$1" == "--clean" ]]; then
  echo "🧹 Cleaning node_modules, android, .expo..."
  rm -rf node_modules android .expo
fi

# ── Install dependencies ─────────────────────────
echo "📦 Installing dependencies..."
npm install --legacy-peer-deps

# ── Check + fix version compatibility ───────────
echo "🔍 Checking Expo package versions..."
npx expo install --check
# expo install --check auto-fixes mismatches and exits 0 if all good

# ── Run expo-doctor ─────────────────────────────
echo "🩺 Running expo-doctor..."
if ! npx expo-doctor; then
  echo ""
  echo "⚠️  expo-doctor found issues. Review above before continuing."
  read -p "Continue anyway? (y/N) " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborting."
    exit 1
  fi
fi

# ── Prebuild ────────────────────────────────────
echo "🔨 Running prebuild..."
npx expo prebuild --clean --platform android

# ── EAS Build ───────────────────────────────────
echo "🚀 Submitting to EAS..."
eas build --platform android --profile development

echo ""
echo "✅ Done! Install the APK on your Pixel 10 when the build completes."
