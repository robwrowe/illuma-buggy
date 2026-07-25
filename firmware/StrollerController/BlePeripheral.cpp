#include "BlePeripheral.h"
#include "Globals.h"
#include "BleCommandHandler.h"
#include "Config.h"
#include <esp_heap_caps.h>

void resetCmdChunkBuffer() {
  if (cmdChunkBuffer) {
    heap_caps_free(cmdChunkBuffer);
    cmdChunkBuffer = nullptr;
  }
  cmdChunkBufferLen = 0;
  cmdChunkBufferCap = 0;
  cmdChunkNextSeq = 0;
}

void bleNotify(const String& json) {
  if (!bleConnected || notifyChar == nullptr) return;
  notifyChar->setValue(json.c_str());
  notifyChar->notify();
}

void bleNotifyChunked(const String& type, const String& payload) {
  if (!bleConnected) {
    Serial.printf("[BLE] Not connected, skipping %s\n", type.c_str());
    return;
  }

  const int CHUNK = 100;  // must fit in single MTU packet (247 bytes) after base64+JSON wrapper
  int total  = payload.length();
  int offset = 0;
  int seq    = 0;

  Serial.printf("[BLE] Sending %s total=%d\n", type.c_str(), total);

  while (offset < total) {
    if (!bleConnected) {
      Serial.println("[BLE] Disconnected mid-chunk, aborting");
      return;
    }

    int end  = min(offset + CHUNK, total);
    bool last = (end >= total);
    String chunk = payload.substring(offset, end);

    String msg = "{\"type\":\"" + type + "\","
                 "\"seq\":" + String(seq) + ","
                 "\"last\":" + (last ? "true" : "false") + ","
                 "\"data\":\"";

    for (int i = 0; i < (int)chunk.length(); i++) {
      char c = chunk[i];
      if      (c == '"')  msg += "\\\"";
      else if (c == '\\') msg += "\\\\";
      else if (c == '\n') msg += "\\n";
      else if (c == '\r') msg += "\\r";
      else                msg += c;
    }
    msg += "\"}";

    bleNotify(msg);
    delay(50);       // let BLE stack process
    vTaskDelay(1);   // yield to FreeRTOS scheduler

    offset = end;
    seq++;
  }

  Serial.printf("[BLE] Done: %s (%d chunks)\n", type.c_str(), seq);
}

// ─────────────────────────────────────────────

void processBleCmdChunk(int seq, bool last, const String& data) {
  if (seq == 0) {
    resetCmdChunkBuffer();
    // +1 for NUL when handing off to enqueueBleCommandOwned / handleBLECommand.
    cmdChunkBufferCap = BLE_CMD_BUF_SIZE;
    const size_t alloc = cmdChunkBufferCap + 1;
    cmdChunkBuffer = (char*)heap_caps_malloc(alloc, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (!cmdChunkBuffer) {
      cmdChunkBuffer = (char*)heap_caps_malloc(alloc, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
    }
    if (!cmdChunkBuffer) {
      Serial.printf("[BLE] cmdChunkBuffer alloc failed (%u, freeHeap=%u, psramFree=%u)\n",
                    (unsigned)alloc,
                    (unsigned)ESP.getFreeHeap(),
                    ESP.getPsramSize() ? (unsigned)ESP.getFreePsram() : 0u);
      bleNotify("{\"type\":\"chunk_sync_failed\",\"reason\":\"alloc_failed\"}");
      return;
    }
    cmdChunkBufferLen = 0;
    Serial.printf("[BLE] cmdChunkBuffer ready cap=%u psramFree=%u freeHeap=%u\n",
                  (unsigned)cmdChunkBufferCap,
                  ESP.getPsramSize() ? (unsigned)ESP.getFreePsram() : 0u,
                  (unsigned)ESP.getFreeHeap());
  }
  if (!cmdChunkBuffer) {
    bleNotify("{\"type\":\"chunk_sync_failed\",\"reason\":\"alloc_failed\"}");
    return;
  }
  if (seq != cmdChunkNextSeq) {
    Serial.printf("[BLE] Chunk seq mismatch (got %d, expected %d)\n", seq, cmdChunkNextSeq);
    bleNotify(String("{\"type\":\"chunk_sync_failed\",\"expectedSeq\":") +
              String(cmdChunkNextSeq) + ",\"gotSeq\":" + String(seq) + "}");
    resetCmdChunkBuffer();
    return;
  }
  if (cmdChunkBufferLen + data.length() > cmdChunkBufferCap) {
    Serial.printf("[BLE] Chunk buffer overflow (have=%u +%u > %u), aborting\n",
                  (unsigned)cmdChunkBufferLen, (unsigned)data.length(),
                  (unsigned)cmdChunkBufferCap);
    bleNotify("{\"type\":\"chunk_sync_failed\",\"reason\":\"overflow\"}");
    resetCmdChunkBuffer();
    return;
  }
  memcpy(cmdChunkBuffer + cmdChunkBufferLen, data.c_str(), data.length());
  cmdChunkBufferLen += data.length();
  cmdChunkNextSeq++;
  if (last) {
    // Transfer ownership — no second full-size copy into a String.
    char* owned = cmdChunkBuffer;
    size_t len = cmdChunkBufferLen;
    cmdChunkBuffer = nullptr;
    cmdChunkBufferLen = 0;
    cmdChunkBufferCap = 0;
    cmdChunkNextSeq = 0;
    Serial.printf("[BLE] Chunk assembly complete (%u bytes, freeHeap=%u, psramFree=%u)\n",
                  (unsigned)len,
                  (unsigned)ESP.getFreeHeap(),
                  ESP.getPsramSize() ? (unsigned)ESP.getFreePsram() : 0u);
    enqueueBleCommandOwned(owned, len);
  }
}

void enqueueBleCommandOwned(char* buf, size_t len) {
  if (!buf) return;
  if (!bleConnected || bleCmdQueue == nullptr) {
    heap_caps_free(buf);
    return;
  }
  if (len == 0 || len > BLE_CMD_BUF_SIZE) {
    Serial.printf("[BLE] Command size %u rejected\n", (unsigned)len);
    heap_caps_free(buf);
    return;
  }
  buf[len] = '\0';
  PendingBleCmd item = { buf };
  if (xQueueSend(bleCmdQueue, &item, 0) != pdTRUE) {
    static uint32_t bleCmdDropCount = 0;
    bleCmdDropCount++;
    Serial.printf("[BLE] Command queue full (depth=%u, dropped=%lu)\n",
                  (unsigned)BLE_CMD_QUEUE_DEPTH, (unsigned long)bleCmdDropCount);
    heap_caps_free(buf);
  }
}

void enqueueBleCommand(const String& msg) {
  if (!bleConnected || bleCmdQueue == nullptr) return;
  if (msg.length() == 0 || msg.length() > BLE_CMD_BUF_SIZE) {
    Serial.printf("[BLE] Command size %u rejected\n", (unsigned)msg.length());
    return;
  }
  const size_t need = msg.length() + 1;
  // Prefer PSRAM for large infrequent command buffers (rules JSON) so we do not
  // fragment the internal heap used by BLE / ESP-NOW / HTTP.
  char* buf = (char*)heap_caps_malloc(need, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buf) {
    buf = (char*)heap_caps_malloc(need, MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);
  }
  if (!buf) {
    Serial.printf("[BLE] Command alloc failed (%u bytes, freeHeap=%u, largestFreeBlock=%u, psramFree=%u)\n",
                  (unsigned)need,
                  (unsigned)ESP.getFreeHeap(),
                  (unsigned)ESP.getMaxAllocHeap(),
                  ESP.getPsramSize() ? (unsigned)ESP.getFreePsram() : 0u);
    bleNotify("{\"type\":\"cmd_alloc_failed\",\"needed\":" + String((unsigned)need) +
              ",\"freeHeap\":" + String(ESP.getFreeHeap()) +
              ",\"maxAllocHeap\":" + String(ESP.getMaxAllocHeap()) + "}");
    return;
  }
  memcpy(buf, msg.c_str(), need);
  enqueueBleCommandOwned(buf, msg.length());
}

void drainBleCmdQueue() {
  if (bleCmdQueue == nullptr) return;
  PendingBleCmd item;
  while (xQueueReceive(bleCmdQueue, &item, 0) == pdTRUE) {
    if (item.data) heap_caps_free(item.data);
  }
}

void processBleCmdQueue() {
  if (bleCmdQueue == nullptr) return;
  PendingBleCmd item;
  int drained = 0;
  while (drained < BLE_CMD_DRAIN_PER_LOOP &&
         xQueueReceive(bleCmdQueue, &item, 0) == pdTRUE) {
    if (item.data) {
      handleBLECommand(String(item.data));
      heap_caps_free(item.data);
    }
    drained++;
  }
}

/** Cheap gate: chunk envelopes always contain this exact type token (JSON.stringify). */
static bool looksLikeChunkEnvelope(const String& val) {
  return val.indexOf("\"type\":\"ble_cmd_chunk\"") >= 0;
}

/**
 * Reassemble ble_cmd_chunk envelopes on the write callback — string append only,
 * no WLED/network. Must not go through bleCmdQueue (depth cannot absorb a large
 * sync's fragment flood). Fully assembled commands still enqueue via processBleCmdChunk.
 */
static void handleChunkEnvelopeDirect(const String& val) {
  // Envelope is ≤ BLE_MAX_WRITE_BYTES (512); leave headroom for ArduinoJson copies.
  StaticJsonDocument<1536> doc;
  DeserializationError err = deserializeJson(doc, val);
  if (err) {
    Serial.printf("[BLE] Chunk envelope parse error: %s\n", err.c_str());
    return;
  }
  const char* type = doc["type"] | "";
  if (strcmp(type, "ble_cmd_chunk") != 0) {
    enqueueBleCommand(val);
    return;
  }
  processBleCmdChunk(doc["seq"].as<int>(), doc["last"].as<bool>(), doc["data"].as<String>());
}

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) override {
    bleConnected = true;
    Serial.println("[BLE] App connected");
  }
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) override {
    bleConnected = false;
    resetCmdChunkBuffer();
    drainBleCmdQueue();
    Serial.println("[BLE] App disconnected — restarting advertising");
    NimBLEDevice::startAdvertising();
  }
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo& connInfo) override {
    String val = chr->getValue().c_str();
    if (val.length() <= 120) Serial.printf("[BLE] Received: %s\n", val.c_str());
    else Serial.printf("[BLE] Received %u bytes\n", (unsigned)val.length());

    // Chunk envelopes: reassemble synchronously so fragments are never dropped by
    // queue pressure. Only the completed command (or a non-chunked write) is queued.
    if (looksLikeChunkEnvelope(val)) {
      handleChunkEnvelopeDirect(val);
      return;
    }
    enqueueBleCommand(val);
  }
};

void startBLEPeripheral() {
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new ServerCallbacks());

  NimBLEService* svc = bleServer->createService(SERVICE_UUID);

  NimBLECharacteristic* cmdChar = svc->createCharacteristic(
    CMD_CHAR_UUID,
    NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR
  );
  cmdChar->setCallbacks(new CommandCallbacks());

  notifyChar = svc->createCharacteristic(NOTIFY_CHAR_UUID, NIMBLE_PROPERTY::NOTIFY);

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  NimBLEAdvertisementData advData;
  advData.setCompleteServices(NimBLEUUID(SERVICE_UUID));
  advData.setName(BLE_NAME);
  adv->setAdvertisementData(advData);
  adv->start();

  Serial.printf("[BLE] Peripheral advertising as: %s\n", BLE_NAME);
}

// ─────────────────────────────────────────────
// WAND TX BEACON — advertise as another Starlight wand (pairing / cast tests)
// ─────────────────────────────────────────────

