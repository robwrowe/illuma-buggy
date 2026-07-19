#include "BlePeripheral.h"
#include "Globals.h"
#include "BleCommandHandler.h"
#include "Config.h"

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
  if (seq == 0) resetCmdChunkBuffer();
  if (seq != cmdChunkNextSeq) {
    Serial.printf("[BLE] Chunk seq mismatch (got %d, expected %d)\n", seq, cmdChunkNextSeq);
    resetCmdChunkBuffer();
    return;
  }
  if (cmdChunkBuffer.length() + data.length() > 32768) {
    Serial.println("[BLE] Chunk buffer overflow, aborting");
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
  char* buf = (char*)malloc(msg.length() + 1);
  if (!buf) {
    Serial.println("[BLE] Command alloc failed");
    return;
  }
  memcpy(buf, msg.c_str(), msg.length() + 1);
  PendingBleCmd item = { buf };
  if (xQueueSend(bleCmdQueue, &item, 0) != pdTRUE) {
    Serial.println("[BLE] Command queue full");
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
  while (drained < 4 && xQueueReceive(bleCmdQueue, &item, 0) == pdTRUE) {
    if (item.data) {
      handleBLECommand(String(item.data));
      free(item.data);
    }
    drained++;
  }
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

