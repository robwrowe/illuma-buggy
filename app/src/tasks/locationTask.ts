import * as TaskManager from 'expo-task-manager';
import type * as Location from 'expo-location';
import { BACKGROUND_LOCATION_TASK } from './locationTaskName';

export { BACKGROUND_LOCATION_TASK };

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[LocationTask] error:', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  const loc = locations?.[0];
  if (!loc) return;
  const { handleBackgroundLocationTick } =
    require('../utils/backgroundLocation') as typeof import('../utils/backgroundLocation');
  console.log(
    '[LocationTask] tick',
    loc.coords.latitude.toFixed(5),
    loc.coords.longitude.toFixed(5),
  );
  try {
    await handleBackgroundLocationTick({
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    });
  } catch (e: unknown) {
    console.warn('[LocationTask] handler failed:', e);
  }
});
