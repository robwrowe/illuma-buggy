#include "NvsLargeString.h"

// Stay under ESP-IDF NVS string limit (~4000 incl. NUL).
#define NVS_LARGE_CHUNK 3500
#define NVS_LARGE_MAX_CHUNKS 24  // ~84KB ceiling

static String chunkMetaKey(const char* key, const char* suffix) {
  return String(key) + suffix;
}

static String chunkDataKey(const char* key, uint8_t i) {
  return String(key) + "_" + String(i);
}

void nvsRemoveLargeString(Preferences& p, const char* key) {
  uint8_t n = p.getUChar(chunkMetaKey(key, "_n").c_str(), 0);
  for (uint8_t i = 0; i < n && i < NVS_LARGE_MAX_CHUNKS; i++) {
    p.remove(chunkDataKey(key, i).c_str());
  }
  p.remove(chunkMetaKey(key, "_n").c_str());
  p.remove(chunkMetaKey(key, "_len").c_str());
  p.remove(key);  // legacy single-key blob
}

bool nvsPutLargeString(Preferences& p, const char* key, const String& value) {
  // Clear previous chunk set / legacy key first.
  nvsRemoveLargeString(p, key);

  const size_t len = value.length();
  if (len == 0) {
    // Empty: leave keys absent (same as missing).
    return true;
  }

  if (len <= NVS_LARGE_CHUNK) {
    size_t wrote = p.putString(key, value);
    if (wrote != len) {
      Serial.printf("[NVS] putString(%s) failed wrote=%u want=%u\n",
                    key, (unsigned)wrote, (unsigned)len);
      return false;
    }
    return true;
  }

  uint8_t chunks = (uint8_t)((len + NVS_LARGE_CHUNK - 1) / NVS_LARGE_CHUNK);
  if (chunks > NVS_LARGE_MAX_CHUNKS) {
    Serial.printf("[NVS] %s too large (%u bytes, need %u chunks)\n",
                  key, (unsigned)len, (unsigned)chunks);
    return false;
  }

  for (uint8_t i = 0; i < chunks; i++) {
    size_t start = (size_t)i * NVS_LARGE_CHUNK;
    size_t end = start + NVS_LARGE_CHUNK;
    if (end > len) end = len;
    String piece = value.substring(start, end);
    String ck = chunkDataKey(key, i);
    size_t wrote = p.putString(ck.c_str(), piece);
    if (wrote != piece.length()) {
      Serial.printf("[NVS] putString(%s) chunk %u failed wrote=%u want=%u\n",
                    key, (unsigned)i, (unsigned)wrote, (unsigned)piece.length());
      nvsRemoveLargeString(p, key);
      return false;
    }
  }

  if (p.putUChar(chunkMetaKey(key, "_n").c_str(), chunks) != sizeof(uint8_t)) {
    Serial.printf("[NVS] putUChar(%s_n) failed\n", key);
    nvsRemoveLargeString(p, key);
    return false;
  }
  if (p.putUInt(chunkMetaKey(key, "_len").c_str(), (uint32_t)len) != sizeof(uint32_t)) {
    Serial.printf("[NVS] putUInt(%s_len) failed\n", key);
    nvsRemoveLargeString(p, key);
    return false;
  }

  Serial.printf("[NVS] stored %s as %u chunks (%u bytes)\n",
                key, (unsigned)chunks, (unsigned)len);
  return true;
}

String nvsGetLargeString(Preferences& p, const char* key, const String& def) {
  uint8_t n = p.getUChar(chunkMetaKey(key, "_n").c_str(), 0);
  if (n == 0) {
    // Legacy single-key or empty.
    String legacy = p.getString(key, "");
    return legacy.length() > 0 ? legacy : def;
  }

  if (n > NVS_LARGE_MAX_CHUNKS) {
    Serial.printf("[NVS] %s_n=%u corrupt\n", key, (unsigned)n);
    return def;
  }

  String out;
  uint32_t expectLen = p.getUInt(chunkMetaKey(key, "_len").c_str(), 0);
  if (expectLen > 0) out.reserve(expectLen);

  for (uint8_t i = 0; i < n; i++) {
    String piece = p.getString(chunkDataKey(key, i).c_str(), "");
    if (piece.length() == 0) {
      Serial.printf("[NVS] missing chunk %s_%u\n", key, (unsigned)i);
      return def;
    }
    out += piece;
  }

  if (expectLen > 0 && out.length() != expectLen) {
    Serial.printf("[NVS] %s length mismatch got=%u expect=%u\n",
                  key, (unsigned)out.length(), (unsigned)expectLen);
    return def;
  }
  return out;
}
