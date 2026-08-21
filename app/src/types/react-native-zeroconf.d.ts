declare module 'react-native-zeroconf' {
  export const ImplType: { NSD: string; DNSSD: string };

  export default class Zeroconf {
    on(event: string, listener: (...args: unknown[]) => void): this;
    removeAllListeners(event?: string): this;
    scan(type?: string, protocol?: string, domain?: string, implType?: string): void;
    stop(implType?: string): void;
    getServices(): Record<string, unknown>;
    removeDeviceListeners(): void;
  }
}
