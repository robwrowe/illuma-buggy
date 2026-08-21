#include "MbRulesStore.h"
#include "Globals.h"
#include <FS.h>
#include <SPIFFS.h>

#define MB_RULES_PATH      "/mb_rules.json"
#define MB_RULES_TMP_PATH  "/mb_rules.json.tmp"

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
  if (SPIFFS.exists(MB_RULES_TMP_PATH)) {
    SPIFFS.remove(MB_RULES_TMP_PATH);
  }
}

/** Copy a verified temp file into place if SPIFFS.rename() is unavailable. */
static bool copyTempToFinal() {
  File src = SPIFFS.open(MB_RULES_TMP_PATH, FILE_READ);
  File dst = SPIFFS.open(MB_RULES_PATH, FILE_WRITE);
  if (!src || !dst) {
    if (src) src.close();
    if (dst) dst.close();
    return false;
  }
  uint8_t buf[256];
  bool ok = true;
  while (src.available()) {
    size_t n = src.read(buf, sizeof(buf));
    if (n == 0) break;
    if (dst.write(buf, n) != n) {
      ok = false;
      break;
    }
  }
  size_t want = src.size();
  src.close();
  dst.flush();
  size_t got = dst.size();
  dst.close();
  if (!ok || got != want) {
    SPIFFS.remove(MB_RULES_PATH);
    return false;
  }
  SPIFFS.remove(MB_RULES_TMP_PATH);
  return true;
}

bool mbRulesFsSave(const String& json) {
  if (!SPIFFS.begin(true)) {
    Serial.println("[FS] SPIFFS mount failed — cannot save rules");
    mbRulesFsDegraded = true;
    return false;
  }

  // Drop a leftover temp from a previous failed attempt before measuring
  // free space, so its bytes don't make a recoverable FS look full.
  if (SPIFFS.exists(MB_RULES_TMP_PATH)) {
    SPIFFS.remove(MB_RULES_TMP_PATH);
  }

  // Report free space before attempting a large write — this makes
  // capacity-related failures diagnosable from the serial log instead of
  // showing up only as "wrote=0".
  size_t totalBytes = SPIFFS.totalBytes();
  size_t usedBytes = SPIFFS.usedBytes();
  size_t freeBytes = (totalBytes > usedBytes) ? (totalBytes - usedBytes) : 0;
  Serial.printf("[FS] SPIFFS free=%u used=%u total=%u before write of %u bytes\n",
                (unsigned)freeBytes, (unsigned)usedBytes, (unsigned)totalBytes,
                (unsigned)json.length());
  // SPIFFS needs headroom beyond the raw payload size for metadata; refuse
  // early rather than truncating the live file and then failing mid-write.
  if (freeBytes < json.length() + 8192) {
    Serial.printf("[FS] insufficient headroom (need ~%u, have %u) — aborting save, "
                  "existing /mb_rules.json left untouched\n",
                  (unsigned)(json.length() + 8192), (unsigned)freeBytes);
    mbRulesFsDegraded = true;
    return false;
  }

  File f = SPIFFS.open(MB_RULES_TMP_PATH, FILE_WRITE);
  if (!f) {
    Serial.println("[FS] open /mb_rules.json.tmp for write failed");
    mbRulesFsDegraded = true;
    return false;
  }
  size_t wrote = f.print(json);
  f.flush();
  f.close();

  if (wrote != json.length()) {
    Serial.printf("[FS] write incomplete wrote=%u want=%u — discarding temp file, "
                  "existing /mb_rules.json left untouched\n",
                  (unsigned)wrote, (unsigned)json.length());
    SPIFFS.remove(MB_RULES_TMP_PATH);
    mbRulesFsDegraded = true;
    return false;
  }

  // Verify by re-reading the temp file's size before committing. Cheap
  // insurance against a write that reported success but wrote garbage.
  File verify = SPIFFS.open(MB_RULES_TMP_PATH, FILE_READ);
  if (!verify || verify.size() != json.length()) {
    Serial.printf("[FS] verify failed (size=%u want=%u) — discarding temp file, "
                  "existing /mb_rules.json left untouched\n",
                  (unsigned)(verify ? verify.size() : 0), (unsigned)json.length());
    if (verify) verify.close();
    SPIFFS.remove(MB_RULES_TMP_PATH);
    mbRulesFsDegraded = true;
    return false;
  }
  verify.close();

  // Commit: remove old file, rename temp into place. The temp file is fully
  // written and verified BEFORE the live file is touched. If rename isn't
  // available on this core, copy tmp → final (old file already removed).
  if (SPIFFS.exists(MB_RULES_PATH)) {
    SPIFFS.remove(MB_RULES_PATH);
  }
  if (!SPIFFS.rename(MB_RULES_TMP_PATH, MB_RULES_PATH) && !copyTempToFinal()) {
    Serial.println("[FS] rename tmp->final failed — rules NOT persisted this boot, "
                    "temp file left on disk for manual recovery");
    mbRulesFsDegraded = true;
    return false;
  }

  Serial.printf("[FS] saved /mb_rules.json (%u bytes)\n", (unsigned)wrote);
  mbRulesFsDegraded = false;
  return true;
}

String mbRulesFsLoad() {
  if (!SPIFFS.begin(true)) return "";
  if (!SPIFFS.exists(MB_RULES_PATH)) {
    // Recovery path: if the final file is missing but a fully-written temp
    // file survived a reboot mid-commit, promote it rather than losing the
    // data. Only promote if it parses as non-trivial JSON size (cheap sanity
    // check; full validation happens via mbRulesJsonUsable() by the caller).
    if (SPIFFS.exists(MB_RULES_TMP_PATH)) {
      File tmp = SPIFFS.open(MB_RULES_TMP_PATH, FILE_READ);
      if (tmp && tmp.size() > 0) {
        tmp.close();
        Serial.println("[FS] /mb_rules.json missing but .tmp found — promoting .tmp");
        if (!SPIFFS.rename(MB_RULES_TMP_PATH, MB_RULES_PATH) && !copyTempToFinal()) {
          Serial.println("[FS] .tmp promote failed");
        }
      } else if (tmp) {
        tmp.close();
      }
    }
    if (!SPIFFS.exists(MB_RULES_PATH)) return "";
  }
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
