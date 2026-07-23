/**
 * Per-channel RGB calibration curves for BLE-extracted colors.
 * Curve editing stays web-only; the app persists, pushes, and toggles enabled.
 */

export type CalibrationCurvePoint = [number, number];

export interface ColorCalibrationCurves {
  r: CalibrationCurvePoint[];
  g: CalibrationCurvePoint[];
  b: CalibrationCurvePoint[];
}

export interface ColorCalibrationConfig {
  enabled: boolean;
  curves: ColorCalibrationCurves;
}

/** Identity 0–255 curve used as the default for each RGB channel. */
export const IDENTITY_CALIBRATION_CURVE: CalibrationCurvePoint[] = [
  [0, 0],
  [128, 128],
  [255, 255],
];

export function createEmptyColorCalibration(
  overrides: Partial<ColorCalibrationConfig> = {},
): ColorCalibrationConfig {
  return {
    enabled: false,
    curves: {
      r: IDENTITY_CALIBRATION_CURVE.map((p) => [...p] as CalibrationCurvePoint),
      g: IDENTITY_CALIBRATION_CURVE.map((p) => [...p] as CalibrationCurvePoint),
      b: IDENTITY_CALIBRATION_CURVE.map((p) => [...p] as CalibrationCurvePoint),
    },
    ...overrides,
  };
}

function normalizeCurvePoints(raw: unknown): CalibrationCurvePoint[] {
  const fallback = IDENTITY_CALIBRATION_CURVE.map(
    (p) => [...p] as CalibrationCurvePoint,
  );
  if (!Array.isArray(raw) || raw.length < 2) return fallback;
  const pts = raw
    .map((p): CalibrationCurvePoint | null => {
      if (!Array.isArray(p) || p.length < 2) return null;
      const x = Math.max(0, Math.min(255, Math.round(Number(p[0]))));
      const y = Math.max(0, Math.min(255, Math.round(Number(p[1]))));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return [x, y];
    })
    .filter((p): p is CalibrationCurvePoint => p != null)
    .sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) return fallback;
  if (pts[0][0] !== 0) pts.unshift([0, pts[0][1]]);
  if (pts[pts.length - 1][0] !== 255) pts.push([255, pts[pts.length - 1][1]]);
  pts[0][0] = 0;
  pts[pts.length - 1][0] = 255;
  return pts;
}

export function normalizeColorCalibration(raw: unknown): ColorCalibrationConfig {
  const d = createEmptyColorCalibration();
  if (!raw || typeof raw !== 'object') return d;
  const obj = raw as { enabled?: unknown; curves?: Partial<ColorCalibrationCurves> };
  return {
    enabled: !!obj.enabled,
    curves: {
      r: normalizeCurvePoints(obj.curves?.r),
      g: normalizeCurvePoints(obj.curves?.g),
      b: normalizeCurvePoints(obj.curves?.b),
    },
  };
}
