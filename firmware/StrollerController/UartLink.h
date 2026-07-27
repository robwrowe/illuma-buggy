#pragma once
#include <Arduino.h>
#include "Types.h"
#include "Config.h"

#define UART_LINK_MAGIC_0    0xAA
#define UART_LINK_MAGIC_1    0x55
#define UART_MSG_TYPE_PACKET 0x01
#define UART_MSG_TYPE_TIME   0x02

inline uint8_t uartLinkChecksum(const uint8_t* data, size_t len) {
  uint8_t x = 0;
  for (size_t i = 0; i < len; i++) x ^= data[i];
  return x;
}

inline void uartLinkSendPacket(HardwareSerial& port, const ParsedDisneyPacket& pkt) {
  uint8_t len = sizeof(ParsedDisneyPacket);
  port.write(UART_LINK_MAGIC_0);
  port.write(UART_LINK_MAGIC_1);
  port.write(UART_MSG_TYPE_PACKET);
  port.write(len);
  port.write((const uint8_t*)&pkt, len);
  port.write(uartLinkChecksum((const uint8_t*)&pkt, len));
}

inline void uartLinkSendRaw(HardwareSerial& port, uint8_t msgType, const uint8_t* data, uint8_t len) {
  port.write(UART_LINK_MAGIC_0);
  port.write(UART_LINK_MAGIC_1);
  port.write(msgType);
  port.write(len);
  if (len && data) port.write(data, len);
  port.write(uartLinkChecksum(data, len));
}

enum class UartRxState : uint8_t {
  WAIT_MAGIC0, WAIT_MAGIC1, WAIT_TYPE, WAIT_LEN, WAIT_PAYLOAD, WAIT_CHECKSUM
};

/** Poll Serial1 framed link. Handlers are board-specific (set before polling). */
using UartPacketHandler = void (*)(const ParsedDisneyPacket& pkt);
using UartTimeHandler = void (*)(const uint8_t* data, uint8_t len);

struct UartLinkRx {
  UartRxState state = UartRxState::WAIT_MAGIC0;
  uint8_t msgType = 0;
  uint8_t buf[sizeof(ParsedDisneyPacket)];
  uint8_t len = 0;
  uint8_t expectedLen = 0;
  uint32_t rxOk = 0;
  uint32_t checksumFail = 0;
  uint32_t resync = 0;
  UartPacketHandler onPacket = nullptr;
  UartTimeHandler onTime = nullptr;
};

inline void uartLinkPoll(HardwareSerial& port, UartLinkRx& rx) {
  while (port.available()) {
    uint8_t b = (uint8_t)port.read();
    switch (rx.state) {
      case UartRxState::WAIT_MAGIC0:
        if (b == UART_LINK_MAGIC_0) rx.state = UartRxState::WAIT_MAGIC1;
        break;
      case UartRxState::WAIT_MAGIC1:
        if (b == UART_LINK_MAGIC_1) {
          rx.state = UartRxState::WAIT_TYPE;
        } else {
          rx.resync++;
          rx.state = (b == UART_LINK_MAGIC_0) ? UartRxState::WAIT_MAGIC1 : UartRxState::WAIT_MAGIC0;
        }
        break;
      case UartRxState::WAIT_TYPE:
        rx.msgType = b;
        rx.state = UartRxState::WAIT_LEN;
        break;
      case UartRxState::WAIT_LEN:
        if (rx.msgType == UART_MSG_TYPE_PACKET && b != sizeof(ParsedDisneyPacket)) {
          Serial.printf("[UART] unexpected len=%u, resyncing\n", b);
          rx.resync++;
          rx.state = UartRxState::WAIT_MAGIC0;
          break;
        }
        if (b > sizeof(rx.buf)) {
          Serial.printf("[UART] len=%u too large, resyncing\n", b);
          rx.resync++;
          rx.state = UartRxState::WAIT_MAGIC0;
          break;
        }
        rx.expectedLen = b;
        rx.len = 0;
        rx.state = (b == 0) ? UartRxState::WAIT_CHECKSUM : UartRxState::WAIT_PAYLOAD;
        break;
      case UartRxState::WAIT_PAYLOAD:
        rx.buf[rx.len++] = b;
        if (rx.len >= rx.expectedLen) rx.state = UartRxState::WAIT_CHECKSUM;
        break;
      case UartRxState::WAIT_CHECKSUM: {
        uint8_t expected = uartLinkChecksum(rx.buf, rx.expectedLen);
        if (b == expected) {
          rx.rxOk++;
          if (rx.msgType == UART_MSG_TYPE_PACKET && rx.onPacket) {
            ParsedDisneyPacket pkt;
            memcpy(&pkt, rx.buf, sizeof(pkt));
            rx.onPacket(pkt);
          } else if (rx.msgType == UART_MSG_TYPE_TIME && rx.onTime) {
            rx.onTime(rx.buf, rx.expectedLen);
          }
        } else {
          rx.checksumFail++;
          Serial.printf("[UART] checksum mismatch (got %02X want %02X), dropping\n", b, expected);
        }
        rx.state = UartRxState::WAIT_MAGIC0;
        break;
      }
    }
  }
}

inline void uartLinkBegin(HardwareSerial& port) {
  port.begin(UART_LINK_BAUD, SERIAL_8N1, UART_LINK_RX_PIN, UART_LINK_TX_PIN);
  Serial.printf("[UART] Serial1 TX=%d RX=%d baud=%d\n",
                UART_LINK_TX_PIN, UART_LINK_RX_PIN, UART_LINK_BAUD);
}
