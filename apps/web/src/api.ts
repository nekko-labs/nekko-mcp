import type { ServerStatus, RegistryEntry, GatewayInfo, ManagedServerConfig, AnalyticsSummary } from '@nekko-mcp/shared';

// Dev proxies /api → daemon; in a packaged build set VITE_DAEMON_URL.
const BASE = (import.meta.env.VITE_DAEMON_URL ?? '').replace(/\/$/, '');
const j = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
};

export const api = {
  servers: () => j<ServerStatus[]>('/api/servers'),
  registry: () => j<RegistryEntry[]>('/api/registry'),
  gateway: () => j<GatewayInfo>('/api/gateway'),
  analytics: () => j<AnalyticsSummary>('/api/analytics'),
  logs: (id: string) => j<{ logs: string[] }>(`/api/servers/${id}/logs`),
  add: (cfg: ManagedServerConfig) => j<ServerStatus>('/api/servers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cfg) }),
  action: (id: string, action: 'start' | 'stop' | 'restart') => j<ServerStatus>(`/api/servers/${id}/${action}`, { method: 'POST' }),
  remove: (id: string) => j<{ ok: boolean }>(`/api/servers/${id}`, { method: 'DELETE' }),
};
