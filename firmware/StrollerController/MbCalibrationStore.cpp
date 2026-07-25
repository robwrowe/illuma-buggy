#include "MbCalibrationStore.h"
#include "Globals.h"
#include <ArduinoJson.h>
#include <FS.h>
#include <SPIFFS.h>
#include <math.h>

#define MB_CALIBRATION_PATH "/mb_calibration.json"

bool mbCalibrationFsBegin() {
  if (SPIFFS.begin(true)) return true;
  Serial.println("[FS] SPIFFS mount failed (calibration)");
  return false;
}

void mbCalibrationFsClear() {
  if (!SPIFFS.begin(true)) return;
  if (SPIFFS.exists(MB_CALIBRATION_PATH)) {
    SPIFFS.remove(MB_CALIBRATION_PATH);
    Serial.println("[FS] removed /mb_calibration.json");
  }
}

bool mbCalibrationFsSave(const String& json) {
  if (!SPIFFS.begin(true)) {
    Serial.println("[FS] SPIFFS mount failed — cannot save calibration");
    return false;
  }
  File f = SPIFFS.open(MB_CALIBRATION_PATH, FILE_WRITE);
  if (!f) {
    Serial.println("[FS] open /mb_calibration.json for write failed");
    return false;
  }
  size_t wrote = f.print(json);
  f.close();
  if (wrote != json.length()) {
    Serial.printf("[FS] calibration write incomplete wrote=%u want=%u\n",
                  (unsigned)wrote, (unsigned)json.length());
    SPIFFS.remove(MB_CALIBRATION_PATH);
    return false;
  }
  Serial.printf("[FS] saved /mb_calibration.json (%u bytes)\n", (unsigned)wrote);
  return true;
}

String mbCalibrationFsLoad() {
  if (!SPIFFS.begin(true)) return "";
  if (!SPIFFS.exists(MB_CALIBRATION_PATH)) return "";
  File f = SPIFFS.open(MB_CALIBRATION_PATH, FILE_READ);
  if (!f) {
    Serial.println("[FS] open /mb_calibration.json for read failed");
    return "";
  }
  String out;
  out.reserve(f.size() + 16);
  while (f.available()) {
    out += (char)f.read();
  }
  f.close();
  Serial.printf("[FS] loaded /mb_calibration.json (%u bytes)\n", (unsigned)out.length());
  return out;
}

static void fillIdentityLut(uint8_t* lut) {
  for (int i = 0; i < 256; i++) lut[i] = (uint8_t)i;
}

static void buildLutFromPoints(JsonArray points, uint8_t* lut) {
  if (points.isNull() || points.size() == 0) {
    fillIdentityLut(lut);
    return;
  }

  // Collect up to 32 control points (input, output), sorted by input.
  const int MAX_PTS = 32;
  int xs[MAX_PTS];
  int ys[MAX_PTS];
  int n = 0;
  for (size_t i = 0; i < points.size() && n < MAX_PTS; i++) {
    JsonArray pt = points[i].as<JsonArray>();
    if (pt.isNull() || pt.size() < 2) continue;
    int x = pt[0] | 0;
    int y = pt[1] | 0;
    if (x < 0) x = 0;
    if (x > 255) x = 255;
    if (y < 0) y = 0;
    if (y > 255) y = 255;
    xs[n] = x;
    ys[n] = y;
    n++;
  }
  if (n < 2) {
    fillIdentityLut(lut);
    return;
  }

  // Insertion sort by x (n is tiny).
  for (int i = 1; i < n; i++) {
    int kx = xs[i], ky = ys[i];
    int j = i - 1;
    while (j >= 0 && xs[j] > kx) {
      xs[j + 1] = xs[j];
      ys[j + 1] = ys[j];
      j--;
    }
    xs[j + 1] = kx;
    ys[j + 1] = ky;
  }

  for (int i = 0; i < 256; i++) {
    if (i <= xs[0]) {
      lut[i] = (uint8_t)ys[0];
      continue;
    }
    if (i >= xs[n - 1]) {
      lut[i] = (uint8_t)ys[n - 1];
      continue;
    }
    int out = i;
    for (int k = 0; k < n - 1; k++) {
      if (i >= xs[k] && i <= xs[k + 1]) {
        int x0 = xs[k], y0 = ys[k];
        int x1 = xs[k + 1], y1 = ys[k + 1];
        if (x1 == x0) {
          out = y0;
        } else {
          float t = (float)(i - x0) / (float)(x1 - x0);
          out = (int)lroundf((float)y0 + t * (float)(y1 - y0));
        }
        break;
      }
    }
    if (out < 0) out = 0;
    if (out > 255) out = 255;
    lut[i] = (uint8_t)out;
  }
}

void mbCalibrationInitIdentity() {
  mbCalibrationEnabled = false;
  fillIdentityLut(mbCalCurveR);
  fillIdentityLut(mbCalCurveG);
  fillIdentityLut(mbCalCurveB);
}

void mbCalibrationApply(const String& json) {
  if (json.length() == 0) {
    mbCalibrationInitIdentity();
    return;
  }
  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.printf("[Cal] parse failed: %s — keeping previous LUTs\n", err.c_str());
    return;
  }
  mbCalibrationEnabled = doc["enabled"] | false;
  buildLutFromPoints(doc["curves"]["r"].as<JsonArray>(), mbCalCurveR);
  buildLutFromPoints(doc["curves"]["g"].as<JsonArray>(), mbCalCurveG);
  buildLutFromPoints(doc["curves"]["b"].as<JsonArray>(), mbCalCurveB);
  Serial.printf("[Cal] applied enabled=%d\n", mbCalibrationEnabled ? 1 : 0);
}
