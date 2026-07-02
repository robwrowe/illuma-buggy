/**
 * useBLE.ts
 * React hook that wraps BLEService for use in components.
 * Provides reactive connection state and message dispatching.
 */

import { useState, useEffect, useCallback } from 'react';
import { bleService, ConnectionState, BLEMessage } from '../services/BLEService';

export function useBLE() {
  const [connectionState, setConnectionState] = useState<ConnectionState>(
    bleService.getConnectionState()
  );
  const [sessionReady, setSessionReady] = useState(bleService.isSessionReady());
  const [lastMessage, setLastMessage] = useState<BLEMessage | null>(null);

  useEffect(() => {
    const unsubState = bleService.onStateChange((state) => {
      setConnectionState(state);
      if (state !== 'connected') setSessionReady(false);
    });
    const unsubMsg   = bleService.onMessage(setLastMessage);
    const unsubReady = bleService.onSessionReady(() => {
      setSessionReady(bleService.isSessionReady());
    });
    return () => {
      unsubState();
      unsubMsg();
      unsubReady();
    };
  }, []);

  const connect    = useCallback(() => bleService.connect(), []);
  const disconnect = useCallback(() => bleService.disconnect(), []);

  return {
    connectionState,
    isConnected: connectionState === 'connected',
    isSessionReady: sessionReady,
    isScanning:  connectionState === 'scanning',
    lastMessage,
    connect,
    disconnect,
    // Expose send wrappers directly
    send:              bleService.send.bind(bleService),
    sendPresetApply:   bleService.sendPresetApply.bind(bleService),
    sendPresetSave:    bleService.sendPresetSave.bind(bleService),
    sendPresetDelete:  bleService.sendPresetDelete.bind(bleService),
    sendPresetList:    bleService.sendPresetList.bind(bleService),
    sendZoneTrigger:   bleService.sendZoneTrigger.bind(bleService),
    sendOverrideClear: bleService.sendOverrideClear.bind(bleService),
    sendOverrideMode:  bleService.sendOverrideMode.bind(bleService),
    sendBrightness:    bleService.sendBrightness.bind(bleService),
    sendWledRaw:       bleService.sendWledRaw.bind(bleService),
    sendStatus:        bleService.sendStatus.bind(bleService),
  };
}

/**
 * useMessageHandler — subscribe to a specific message type
 * Usage:
 *   useMessageHandler('ble_color', (msg) => { ... });
 */
export function useMessageHandler(
  type: string,
  handler: (msg: BLEMessage) => void
) {
  useEffect(() => {
    const unsub = bleService.onMessage((msg) => {
      if (msg.type === type) handler(msg);
    });
    return unsub;
  }, [type, handler]);
}
