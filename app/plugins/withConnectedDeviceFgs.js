/**
 * Let the location foreground service also declare connectedDevice so a future
 * BLE-typed start is legal. expo-location still starts it as a location service;
 * listing both types in the manifest is a superset and does not change that call.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

function withConnectedDeviceFgs(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const services = app?.service ?? [];
    for (const svc of services) {
      const name = svc.$?.['android:name'] ?? '';
      if (!name.includes('LocationTaskService')) continue;
      const cur = svc.$['android:foregroundServiceType'] || 'location';
      if (!String(cur).includes('connectedDevice')) {
        svc.$['android:foregroundServiceType'] = `${cur}|connectedDevice`;
      }
    }
    return cfg;
  });
}

module.exports = withConnectedDeviceFgs;
