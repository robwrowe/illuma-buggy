#include "HttpCommandServer.h"
#include "Globals.h"
#include "BleCommandHandler.h"
#include <WebServer.h>
#include <WiFi.h>

// Reuses the board's existing WIFI_STA join (GLEDOPTO AP / StrollerNet) —
// no new AP, no new WiFi credentials.
static WebServer httpServer(8080);  // distinct from WLED's own :80

String* httpCaptureTarget = nullptr;

static void sendCorsHeaders() {
  httpServer.sendHeader("Access-Control-Allow-Origin", "*");
  httpServer.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  httpServer.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

static void sendJson(int code, const String& body) {
  sendCorsHeaders();
  httpServer.send(code, "application/json", body);
}

static void handleOptions() {
  sendCorsHeaders();
  httpServer.send(204);
}

static String readPostBody() {
  if (httpServer.hasArg("plain")) return httpServer.arg("plain");
  return "";
}

static void handleCommand() {
  if (httpServer.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  if (httpServer.method() != HTTP_POST) {
    sendJson(405, "{\"error\":\"POST only\"}");
    return;
  }
  String body = readPostBody();
  if (body.length() == 0) {
    sendJson(400, "{\"error\":\"empty body\"}");
    return;
  }

  String captured;
  httpCaptureTarget = &captured;
  handleBLECommand(body);   // identical parse/dispatch/persist path as BLE
  httpCaptureTarget = nullptr;

  if (captured.length() > 0) {
    sendJson(200, captured);
  } else {
    // Some handlers (e.g. queued GETs) may not ack via bleNotify in every
    // branch — treat silence as success, matching existing BLE behavior.
    sendJson(200, "{\"ok\":true}");
  }
}

static void handleStatus() {
  if (httpServer.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  String json = "{\"role\":\"logic\",\"ip\":\"" + WiFi.localIP().toString() +
                "\",\"freeHeap\":" + String((unsigned)ESP.getFreeHeap()) + "}";
  sendJson(200, json);
}

void httpCommandServerInit() {
  httpServer.on("/cmd", HTTP_ANY, handleCommand);
  httpServer.on("/status", HTTP_ANY, handleStatus);
  httpServer.begin();
  Serial.println("[HTTP] command server listening on :8080 (/cmd, /status)");
}

void httpCommandServerPoll() {
  httpServer.handleClient();
}
