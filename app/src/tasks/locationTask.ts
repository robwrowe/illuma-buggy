import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { processLocationUpdate } from '../utils/zoneLocationCore';

export const BACKGROUND_LOCATION_TASK = 'illuma-background-location';

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ({ data, error }) => {
  if (error) {
    console.warn('[LocationTask] error:', error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] })?.locations;
  const loc = locations?.[0];
  if (!loc) return;
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
