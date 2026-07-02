import * as TaskManager from 'expo-task-manager';
import type * as Location from 'expo-location';
import { BACKGROUND_LOCATION_TASK } from './locationTaskName';

export { BACKGROUND_LOCATION_TASK };

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ({ data, error }) => {
  if (error) {
    console.warn('[LocationTask] error:', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  const loc = locations?.[0];
  if (!loc) return;
  // Lazy import — zoneLocationCore pulls in store/BLE; defer until task runs.
  const { processLocationUpdate } = require('../utils/zoneLocationCore') as typeof import('../utils/zoneLocationCore');
  console.log(
    '[LocationTask] tick',
    loc.coords.latitude.toFixed(5),
    loc.coords.longitude.toFixed(5),
  );
  processLocationUpdate(
    { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
    { background: true },
  );
});
