import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Supervisor, createGateway, REGISTRY } from '@nekko-mcp/core';
import type { ManagedServerConfig, GatewayInfo } from '@nekko-mcp/shared';

/**
 * nekko-mcpd — the NekkoMCP daemon. Two modes:
 *   • default: an HTTP management API (the UI talks to this) that supervises
 *     servers from a local config file.
 *   • `--stdio`: connect the aggregating gateway to stdio so an agent harness
 *     (Claude Code, Cursor) can spawn `nekko-mcpd --stdio` as ONE MCP endpoint
 *     that fans out to all enabled servers.
 *
 * Local-first: binds to localhost; the daemon makes no network calls itself.
 */
const DATA_DIR = process.env.NEKKO_MCP_DIR ?? join(homedir(), '.nekko-mcp');
const CONFIG_PATH = join(DATA_DIR, 'servers.json');
const PORT = Number(process.env.PORT ?? 7777);
const VERSION = '0.1.0';

const loadConfig = (): ManagedServerConfig[] => {
  try {
    if (existsSync(CONFIG_PATH)) return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as ManagedServerConfig[];
  } catch {
    /* fall through to empty */
  }
  return [];
};
const saveConfig = (servers: ManagedServerConfig[]): void => {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(servers, null, 2));
};

const supervisor = new Supervisor();
let servers = loadConfig();

const startEnabled = async (): Promise<void> => {
  for (const s of servers) if (s.enabled) await supervisor.start(s);
};

// ── stdio gateway mode (the single aggregated endpoint for harnesses) ──────
if (process.argv.includes('--stdio')) {
  await startEnabled();
  const gateway = createGateway(supervisor);
  await gateway.connect(new StdioServerTransport());
  // stdout is the MCP channel now; logs must go to stderr only.
  process.stderr.write(`nekko-mcpd gateway (stdio) up — ${supervisor.ids().length} server(s)\n`);
} else {
  // ── HTTP management API ──────────────────────────────────────────────────
  await startEnabled();
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };
  const gatewayInfo = (): GatewayInfo => ({
    url: `http://localhost:${PORT}/mcp`,
    stdioCommand: 'nekko-mcpd --stdio',
    clientSnippet: { mcpServers: { 'nekko-mcp': { command: 'nekko-mcpd', args: ['--stdio'] } } },
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const { pathname } = url;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (pathname === '/health') return json(res, 200, { ok: true, service: 'nekko-mcpd', version: VERSION, servers: supervisor.list().length });
    if (pathname === '/api/registry') return json(res, 200, REGISTRY);
    if (pathname === '/api/gateway') return json(res, 200, gatewayInfo());
    if (pathname === '/api/servers' && req.method === 'GET') return json(res, 200, supervisor.list());

    const m = /^\/api\/servers\/([^/]+)\/(start|stop|restart)$/.exec(pathname);
    if (m && req.method === 'POST') {
      const [, id, action] = m;
      const cfg = servers.find((s) => s.id === id);
      if (!cfg) return json(res, 404, { error: 'not_found' });
      if (action === 'stop') await supervisor.stop(id);
      else if (action === 'restart') await supervisor.restart(cfg);
      else await supervisor.start(cfg);
      return json(res, 200, supervisor.status(id));
    }
    return json(res, 404, { error: 'not_found' });
  });
  server.listen(PORT, '127.0.0.1', () => process.stdout.write(`nekko-mcpd HTTP API on http://localhost:${PORT}\n`));
}

// keep `servers`/`saveConfig` reachable for the (forthcoming) add/remove routes
void saveConfig;
void servers;
