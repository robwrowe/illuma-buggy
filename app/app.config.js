// app.config.js
// Dynamic config — reads EAS secrets from environment at build time

module.exports = ({ config }) => ({
  ...config,
  name: "Illuma Buggy",
  slug: "illuma-buggy",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "dark",
  splash: {
    backgroundColor: "#0a0a0f",
    resizeMode: "contain",
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: "com.illumabuggy.app",
    infoPlist: {
      NSBluetoothAlwaysUsageDescription:
        "IllumaBuggy uses Bluetooth to control your stroller LEDs and receive MagicBand+ events.",
      NSBluetoothPeripheralUsageDescription:
        "IllumaBuggy uses Bluetooth to control your stroller LEDs.",
      NSLocationWhenInUseUsageDescription:
        "IllumaBuggy uses your location to trigger LED presets based on where you are in the park.",
      NSLocationAlwaysUsageDescription:
        "IllumaBuggy uses your location in the background to trigger LED presets automatically.",
    },
  },
  android: {
    package: "com.illumabuggy.app",
    config: {
      googleMaps: {
        // Injected from EAS secret at build time
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
    permissions: [
      "BLUETOOTH",
      "BLUETOOTH_ADMIN",
      "BLUETOOTH_SCAN",
      "BLUETOOTH_CONNECT",
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "ACCESS_BACKGROUND_LOCATION",
      "POST_NOTIFICATIONS",
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
    ],
  },
  plugins: [
    [
      "react-native-ble-plx",
      {
        isBackgroundEnabled: false,
        modes: ["peripheral", "central"],
        bluetoothAlwaysPermission:
          "Allow IllumaBuggy to connect to your stroller controller",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "IllumaBuggy uses your location in the background to trigger LED presets when you enter park zones.",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
    "expo-notifications",
    "expo-document-picker",
  ],
  extra: {
    eas: {
      projectId: "e7692aec-8fa3-4506-beb8-2885de76cbf8",
    },
  },
});
