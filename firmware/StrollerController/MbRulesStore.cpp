#include "MbRulesStore.h"
#include <FS.h>
#include <SPIFFS.h>

#define MB_RULES_PATH "/mb_rules.json"

bool mbRulesFsBegin() {
  if (SPIFFS.begin(true)) return true;
  Serial.println("[FS] SPIFFS mount failed");
  return false;
}

void mbRulesFsClear() {
  if (!SPIFFS.begin(true)) return;
  if (SPIFFS.exists(MB_RULES_PATH)) {
    SPIFFS.remove(MB_RULES_PATH);
    Serial.println("[FS] removed /mb_rules.json");
  }
}

bool mbRulesFsSave(const String& json) {
  if (!SPIFFS.begin(true)) {
    Serial.println("[FS] SPIFFS mount failed — cannot save rules");
    return false;
  }
  // Write via temp then rename would be nicer; SPIFFS has no rename on all builds —
  // overwrite in place after truncate.
  File f = SPIFFS.open(MB_RULES_PATH, FILE_WRITE);
  if (!f) {
    Serial.println("[FS] open /mb_rules.json for write failed");
    return false;
  }
  size_t wrote = f.print(json);
  f.close();
  if (wrote != json.length()) {
    Serial.printf("[FS] write incomplete wrote=%u want=%u\n",
                  (unsigned)wrote, (unsigned)json.length());
    SPIFFS.remove(MB_RULES_PATH);
    return false;
  }
  Serial.printf("[FS] saved /mb_rules.json (%u bytes)\n", (unsigned)wrote);
  return true;
}

String mbRulesFsLoad() {
  if (!SPIFFS.begin(true)) return "";
  if (!SPIFFS.exists(MB_RULES_PATH)) return "";
  File f = SPIFFS.open(MB_RULES_PATH, FILE_READ);
  if (!f) {
    Serial.println("[FS] open /mb_rules.json for read failed");
    return "";
  }
  String out;
  out.reserve(f.size() + 16);
  while (f.available()) {
    out += (char)f.read();
  }
  f.close();
  Serial.printf("[FS] loaded /mb_rules.json (%u bytes)\n", (unsigned)out.length());
  return out;
}
