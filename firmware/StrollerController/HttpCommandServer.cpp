#include "HttpCommandServer.h"
#include "Globals.h"
#include "BleCommandHandler.h"
#include "WledClient.h"
#include "Reboot.h"
#include <WebServer.h>
#include <WiFi.h>

// Reuses the board's existing WIFI_STA join (GLEDOPTO AP / StrollerNet) —
// no new AP, no new WiFi credentials.
//
//   curl -X POST http://illuma-logic.local:8080/reboot
//   curl -X POST http://192.168.1.66:8080/cmd -d '{"type":"reboot"}'
//   curl -X POST http://192.168.1.66:8080/cmd -d '{"type":"wled_net_config","ip":"192.168.1.50","port":80}'
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
  WifiNetInfo net = getWifiNetInfo();
  String json = "{\"role\":\"logic\","
                "\"ip\":\"" + net.ip + "\","
                "\"gateway\":\"" + net.gateway + "\","
                "\"subnet\":\"" + net.subnet + "\","
                "\"wled_ssid\":\"" + wledSsid + "\","
                "\"wled_ip\":\"" + wledIp + "\","
                "\"wled_port\":" + String(wledPort) + ","
                "\"wled_effective\":\"" + wledEffectiveHostPort() + "\","
                "\"freeHeap\":" + String((unsigned)ESP.getFreeHeap()) + "}";
  sendJson(200, json);
}

static void handleReboot() {
  if (httpServer.method() == HTTP_OPTIONS) {
    handleOptions();
    return;
  }
  if (httpServer.method() != HTTP_POST) {
    sendJson(405, "{\"error\":\"POST only\"}");
    return;
  }
  sendJson(200, "{\"ok\":true,\"action\":\"reboot\"}");
  requestReboot("http");
}

static bool httpListening = false;

void httpCommandServerInit() {
  httpServer.on("/cmd", HTTP_ANY, handleCommand);
  httpServer.on("/status", HTTP_ANY, handleStatus);
  httpServer.on("/reboot", HTTP_ANY, handleReboot);
  // Listen is deferred until STA is up. Calling NetworkServer::begin() here
  // (before WiFi.mode/begin) can take a still-null lwIP/wifi queue and abort
  // with xQueueSemaphoreTake on pxQueue == NULL — same boot-loop as a null
  // WLED send queue, and it lands right after that init print.
  Serial.println("[HTTP] routes registered (listen deferred until WiFi STA)");
}

void httpCommandServerPoll() {
  if (!httpListening) {
    if (WiFi.status() != WL_CONNECTED) return;
    httpServer.begin();
    httpListening = true;
    Serial.println("[HTTP] command server listening on :8080 (/cmd, /status, /reboot)");
  }
  httpServer.handleClient();
}
