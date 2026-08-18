import { NativeModules } from 'react-native';
import Zeroconf from 'react-native-zeroconf';

export interface DiscoveredBoard {
  host: string;       // e.g. "illuma-logic.local."
  ip: string;         // resolved IPv4, e.g. "192.168.1.42"
  role: string | null; // from the "role" TXT record: "logic" | "wandsim"
}

type ZeroconfService = {
  name?: string;
  host?: string;
  addresses?: string[];
  txt?: Record<string, string> | string[] | null;
};

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function parseTxtRole(txt: ZeroconfService['txt']): string | null {
  if (!txt) return null;
  if (Array.isArray(txt)) {
    for (const item of txt) {
      const m = /^role=(.+)$/i.exec(String(item));
      if (m) return m[1];
    }
    return null;
  }
  const role = txt.role ?? (txt as Record<string, string>).ROLE;
  return typeof role === 'string' && role ? role : null;
}

function inferRoleFromHost(host: string): string | null {
  const h = host.toLowerCase();
  if (h.includes('illuma-logic')) return 'logic';
  if (h.includes('illuma-wandsim')) return 'wandsim';
  return null;
}

function pickIpv4(service: ZeroconfService): string | null {
  const addrs = Array.isArray(service.addresses) ? service.addresses : [];
  const ipv4 = addrs.find(a => typeof a === 'string' && IPV4_RE.test(a));
  if (ipv4) return ipv4;
  const first = addrs.find(a => typeof a === 'string' && a.length > 0);
  return first ?? null;
}

let zeroconf: Zeroconf | null = null;

function getZeroconf(): Zeroconf | null {
  if (!NativeModules.RNZeroconf) return null;
  if (!zeroconf) {
    try {
      zeroconf = new Zeroconf();
    } catch {
      return null;
    }
  }
  return zeroconf;
}

/**
 * Scan for illuma-* HTTP services on the local network for `timeoutMs`,
 * resolving hostnames to IPs via NSD (Android) / NSNetServiceBrowser (iOS).
 * Returns whatever was found when the timeout hits — mDNS is best-effort,
 * so callers should always have a manual-IP fallback in the UI.
 */
export function discoverBoards(timeoutMs = 5000): Promise<DiscoveredBoard[]> {
  return new Promise((resolve) => {
    const zc = getZeroconf();
    if (!zc) {
      resolve([]);
      return;
    }

    const found: DiscoveredBoard[] = [];
    const seen = new Set<string>();
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try { zc.stop(); } catch { /* already stopped */ }
      zc.removeAllListeners('resolved');
      zc.removeAllListeners('error');
      resolve(found);
    };

    const onResolved = (service: ZeroconfService) => {
      const host = service.host ?? service.name ?? '';
      const ip = pickIpv4(service);
      if (!ip) return;
      const role = parseTxtRole(service.txt) ?? inferRoleFromHost(host);
      const key = `${role ?? ''}|${ip}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push({ host, ip, role });
    };

    zc.on('resolved', onResolved);
    zc.on('error', () => { /* swallow — best-effort discovery, fallback is manual IP entry */ });

    try {
      zc.scan('http', 'tcp', 'local.');
    } catch {
      finish();
      return;
    }

    setTimeout(finish, timeoutMs);
  });
}

/** Convenience: find the first discovered board with role === 'logic'. */
export async function discoverLogicBoardIp(timeoutMs = 5000): Promise<string | null> {
  const boards = await discoverBoards(timeoutMs);
  return boards.find((b) => b.role === 'logic')?.ip ?? null;
}
