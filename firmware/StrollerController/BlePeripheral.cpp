#include "BlePeripheral.h"
#include "Globals.h"
#include "BleCommandHandler.h"
#include "Config.h"
#include <esp_heap_caps.h>

void resetCmdChunkBuffer() {
  cmdChunkBuffer = "";
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
    // Avoid ~N realloc/copies while assembling large set_mb_rules payloads —
    // repeated String growth fragments the internal heap and can make the
    // subsequent enqueueBleCommand malloc fail even when freeHeap looks fine.
    cmdChunkBuffer.reserve(BLE_CMD_BUF_SIZE);
  }
  if (seq != cmdChunkNextSeq) {
    Serial.printf("[BLE] Chunk seq mismatch (got %d, expected %d)\n", seq, cmdChunkNextSeq);
    bleNotify(String("{\"type\":\"chunk_sync_failed\",\"expectedSeq\":") +
              String(cmdChunkNextSeq) + ",\"gotSeq\":" + String(seq) + "}");
    resetCmdChunkBuffer();
    return;
  }
  if (cmdChunkBuffer.length() + data.length() > BLE_CMD_BUF_SIZE) {
    Serial.println("[BLE] Chunk buffer overflow, aborting");
    bleNotify("{\"type\":\"chunk_sync_failed\",\"reason\":\"overflow\"}");
    resetCmdChunkBuffer();
    return;
  }
  cmdChunkBuffer += data;
  cmdChunkNextSeq++;
  if (last) {
    String complete = cmdChunkBuffer;
    resetCmdChunkBuffer();
    Serial.printf("[BLE] Chunk assembly complete (%u bytes)\n", (unsigned)complete.length());
    enqueueBleCommand(complete);
  }
}

void enqueueBleCommand(const String& msg) {
  if (!bleConnected || bleCmdQueue == nullptr) return;
  if (msg.length() == 0 || msg.length() >= BLE_CMD_BUF_SIZE) {
    Serial.printf("[BLE] Command size %u rejected\n", (unsigned)msg.length());
    return;
  }
  const size_t need = msg.length() + 1;
  // Prefer PSRAM for large infrequent command buffers (rules JSON) so we do not
  // fragment the internal heap used by BLE / ESP-NOW / HTTP.
  char* buf = (char*)heap_caps_malloc(need, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (!buf) {
    buf = (char*)malloc(need);
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
  PendingBleCmd item = { buf };
  if (xQueueSend(bleCmdQueue, &item, 0) != pdTRUE) {
    static uint32_t bleCmdDropCount = 0;
    bleCmdDropCount++;
    Serial.printf("[BLE] Command queue full (depth=%u, dropped=%lu)\n",
                  (unsigned)BLE_CMD_QUEUE_DEPTH, (unsigned long)bleCmdDropCount);
    free(buf);
  }
}

void drainBleCmdQueue() {
  if (bleCmdQueue == nullptr) return;
  PendingBleCmd item;
  while (xQueueReceive(bleCmdQueue, &item, 0) == pdTRUE) {
    if (item.data) free(item.data);
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
      free(item.data);
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

