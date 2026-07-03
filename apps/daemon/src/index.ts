import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Supervisor, createGateway, REGISTRY } from '@nekko-mcp/core';
import type { ManagedServerConfig, GatewayInfo } from '@nekko-mcp/shared';

/**
 * nekko-mcpd — the NekkoMCP daemon. Two modes:
 *   • default: one localhost port serving the management API, the web UI, and
 *     the streamable-HTTP MCP gateway at /mcp (bearer-token auth).
 *   • `--stdio`: connect the aggregating gateway to stdio so an agent harness
 *     (Claude Code, Cursor, Open Paw) can spawn `nekko-mcpd --stdio` as ONE
 *     MCP endpoint that fans out to all enabled servers.
 *
 * Local-first: binds to localhost; the daemon makes no network calls itself.
 */
const DATA_DIR = process.env.NEKKO_MCP_DIR ?? join(homedir(), '.nekko-mcp');
const CONFIG_PATH = join(DATA_DIR, 'servers.json');
const TOKEN_PATH = join(DATA_DIR, 'gateway-token');
const PORT = Number(process.env.PORT ?? 7777);
const VERSION = '0.2.0';

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

/** The gateway bearer token: generated once, persisted, never logged. */
const loadToken = (): string => {
  try {
    if (existsSync(TOKEN_PATH)) {
      const t = readFileSync(TOKEN_PATH, 'utf8').trim();
      if (t) return t;
    }
  } catch {
    /* regenerate below */
  }
  const t = randomBytes(24).toString('hex');
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(TOKEN_PATH, t);
  return t;
};

const supervisor = new Supervisor();
let servers = loadConfig();

const startEnabled = async (): Promise<void> => {
  for (const s of servers) if (s.enabled) await supervisor.start(s);
};

// ── stdio gateway mode (the single aggregated endpoint for harnesses) ──────
if (process.argv.includes('--stdio')) {
  await startEnabled();
  const gateway = createGateway(supervisor, { name: 'nekko-mcp-gateway', version: VERSION });
  await gateway.connect(new StdioServerTransport());
  // stdout is the MCP channel now; logs must go to stderr only.
  process.stderr.write(`nekko-mcpd gateway (stdio) up — ${supervisor.ids().length} server(s)\n`);
} else {
  // ── HTTP: management API + web UI + streamable-HTTP MCP gateway ──────────
  await startEnabled();
  const TOKEN = process.env.NEKKO_MCP_TOKEN ?? loadToken();
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 4_000_000) req.destroy();
      });
      req.on('end', () => resolve(data));
    });
  const authOk = (req: IncomingMessage): boolean => {
    if (process.env.NEKKO_MCP_NO_AUTH === '1') return true;
    const h = req.headers.authorization ?? '';
    const got = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (got.length !== TOKEN.length) return false;
    return timingSafeEqual(Buffer.from(got), Buffer.from(TOKEN));
  };
  const gatewayInfo = (): GatewayInfo => {
    const url = `http://localhost:${PORT}/mcp`;
    return {
      url,
      token: TOKEN,
      stdioCommand: 'nekko-mcpd --stdio',
      clientSnippet: {
        mcpServers: { 'nekko-mcp': { type: 'http', url, headers: { Authorization: `Bearer ${TOKEN}` } } },
      },
      stdioSnippet: { mcpServers: { 'nekko-mcp': { command: 'nekko-mcpd', args: ['--stdio'] } } },
      uiUrl: `http://localhost:${PORT}/`,
    };
  };

  // Built web UI (apps/web/dist) — same relative path from src/ and dist/.
  const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.woff2': 'font/woff2',
  };
  const serveUi = (res: ServerResponse, pathname: string): void => {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = resolve(UI_DIR, rel);
    if (file.startsWith(UI_DIR) && existsSync(file) && extname(file) in MIME) {
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] });
      res.end(readFileSync(file));
      return;
    }
    if (existsSync(join(UI_DIR, 'index.html'))) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(UI_DIR, 'index.html')));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`nekko-mcpd ${VERSION} — build the web UI (npm run build) to serve it here.\n`);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    const { pathname } = url;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
      });
      return res.end();
    }

    // ── the aggregated MCP endpoint (streamable HTTP, stateless) ──────────
    if (pathname === '/mcp') {
      if (!authOk(req)) return json(res, 401, { error: 'unauthorized' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
      try {
        const body = JSON.parse(await readBody(req));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        const gateway = createGateway(supervisor, { name: 'nekko-mcp-gateway', version: VERSION });
        res.on('close', () => {
          void transport.close();
          void gateway.close();
        });
        await gateway.connect(transport);
        await transport.handleRequest(req, res, body);
      } catch (e) {
        if (!res.headersSent) json(res, 400, { error: e instanceof Error ? e.message : 'bad_request' });
      }
      return;
    }

    if (pathname === '/health') return json(res, 200, { ok: true, service: 'nekko-mcpd', version: VERSION, servers: supervisor.list().length });
    if (pathname === '/api/registry') return json(res, 200, REGISTRY);
    if (pathname === '/api/gateway') return json(res, 200, gatewayInfo());
    if (pathname === '/api/servers' && req.method === 'GET') return json(res, 200, supervisor.list());

    // add a server (custom config, or a registry entry merged with overrides)
    if (pathname === '/api/servers' && req.method === 'POST') {
      try {
        const cfg = JSON.parse(await readBody(req)) as ManagedServerConfig;
        if (!cfg.id || !cfg.name || !cfg.command) return json(res, 400, { error: 'id, name, command required' });
        if (servers.some((s) => s.id === cfg.id)) return json(res, 409, { error: 'id_exists' });
        cfg.runtime = cfg.runtime === 'docker' ? 'docker' : 'process';
        cfg.enabled = cfg.enabled ?? true;
        servers.push(cfg);
        saveConfig(servers);
        if (cfg.enabled) await supervisor.start(cfg);
        return json(res, 200, supervisor.status(cfg.id) ?? { id: cfg.id, state: 'stopped' });
      } catch {
        return json(res, 400, { error: 'invalid_json' });
      }
    }

    const logsM = /^\/api\/servers\/([^/]+)\/logs$/.exec(pathname);
    if (logsM && req.method === 'GET') return json(res, 200, { logs: supervisor.logs(logsM[1]) });

    const rmM = /^\/api\/servers\/([^/]+)$/.exec(pathname);
    if (rmM && req.method === 'DELETE') {
      const id = rmM[1];
      await supervisor.remove(id);
      servers = servers.filter((s) => s.id !== id);
      saveConfig(servers);
      return json(res, 200, { ok: true });
    }

    const m = /^\/api\/servers\/([^/]+)\/(start|stop|restart)$/.exec(pathname);
    if (m && req.method === 'POST') {
      const [, id, action] = m;
      const cfg = servers.find((s) => s.id === id);
      if (!cfg) return json(res, 404, { error: 'not_found' });
      cfg.enabled = action !== 'stop';
      saveConfig(servers);
      if (action === 'stop') await supervisor.stop(id);
      else if (action === 'restart') await supervisor.restart(cfg);
      else await supervisor.start(cfg);
      return json(res, 200, supervisor.status(id));
    }

    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
    // Anything else is the web UI.
    return serveUi(res, pathname);
  });
  server.listen(PORT, '127.0.0.1', () => process.stdout.write(`nekko-mcpd up — UI + API on http://localhost:${PORT} · MCP gateway at /mcp\n`));
}
