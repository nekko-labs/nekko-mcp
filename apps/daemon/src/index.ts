import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Supervisor, createGateway, REGISTRY, searchRegistry } from '@nekko-mcp/core';
import type {
  ManagedServerConfig,
  GatewayInfo,
  AgentClient,
  AgentClientInfo,
  AnalyticsSnapshot,
} from '@nekko-mcp/shared';

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
const ANALYTICS_PATH = join(DATA_DIR, 'analytics.json');
const CLIENTS_PATH = join(DATA_DIR, 'clients.json');
const PORT = Number(process.env.PORT ?? 7777);
const VERSION = '0.4.0';

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

/** Analytics survive restarts: hydrate from disk on boot, persist (debounced) on each call. */
const loadAnalytics = (): AnalyticsSnapshot | undefined => {
  try {
    if (existsSync(ANALYTICS_PATH)) {
      const raw = readFileSync(ANALYTICS_PATH, 'utf8');
      if (raw.length < 16_000_000) return JSON.parse(raw) as AnalyticsSnapshot;
    }
  } catch {
    /* ignore a corrupt snapshot */
  }
  return undefined;
};

/** Connected agents: named gateway tokens each scoped to an allow-list of servers. */
const loadClients = (): AgentClient[] => {
  try {
    if (existsSync(CLIENTS_PATH)) {
      const arr = JSON.parse(readFileSync(CLIENTS_PATH, 'utf8')) as AgentClient[];
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* fall through to empty */
  }
  return [];
};
const saveClients = (list: AgentClient[]): void => {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CLIENTS_PATH, JSON.stringify(list, null, 2));
};

/** Trailing debounce: coalesce bursts of writes into one. */
const debounce = (fn: () => void, ms: number): (() => void) => {
  let t: ReturnType<typeof setTimeout> | undefined;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
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

// Set to a debounced disk writer in HTTP mode; stays a no-op in stdio mode so a
// transient `--stdio` spawn never clobbers the resident daemon's analytics file.
let persistAnalytics: () => void = () => {};
const supervisor = new Supervisor({ onUsage: () => persistAnalytics() });
let servers = loadConfig();

const startEnabled = async (): Promise<void> => {
  for (const s of servers) if (s.enabled) await supervisor.start(s);
};

// ── stdio gateway mode (the single aggregated endpoint for harnesses) ──────
if (process.argv.includes('--stdio')) {
  await startEnabled();
  const gateway = createGateway(supervisor, { name: 'nekko-mcp-gateway', version: VERSION }, { caller: 'stdio (local)' });
  await gateway.connect(new StdioServerTransport());
  // stdout is the MCP channel now; logs must go to stderr only.
  process.stderr.write(`nekko-mcpd gateway (stdio) up — ${supervisor.ids().length} server(s)\n`);
} else {
  // ── HTTP: management API + web UI + streamable-HTTP MCP gateway ──────────
  // Restore analytics before serving so the first response already reflects history.
  supervisor.hydrate(loadAnalytics());
  const flushAnalytics = (): void => {
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(ANALYTICS_PATH, JSON.stringify(supervisor.snapshot()));
    } catch {
      /* best-effort; analytics are non-critical */
    }
  };
  persistAnalytics = debounce(flushAnalytics, 2000);
  for (const sig of ['SIGINT', 'SIGTERM', 'beforeExit'] as const) {
    process.once(sig, () => {
      flushAnalytics();
      if (sig !== 'beforeExit') process.exit(0);
    });
  }

  // Connected agents (scoped gateway tokens). Bumping lastUsed is debounced.
  let clients = loadClients();
  const persistClients = debounce(() => saveClients(clients), 1500);

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
  const bearer = (req: IncomingMessage): string => {
    const h = req.headers.authorization ?? '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  };
  const tokenEq = (a: string, b: string): boolean =>
    a.length > 0 && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  // Resolve the caller's scope from the bearer token alone (no body needed, so an
  // unauthorized request still 401s before we parse). Master token = full access;
  // a named agent token = that agent's per-server allow-list.
  type Scope = { kind: 'master' } | { kind: 'agent'; agent: AgentClient };
  const authScope = (req: IncomingMessage): Scope | null => {
    if (process.env.NEKKO_MCP_NO_AUTH === '1') return { kind: 'master' };
    const got = bearer(req);
    if (!got) return null;
    if (tokenEq(got, TOKEN)) return { kind: 'master' };
    const agent = clients.find((c) => tokenEq(got, c.token));
    return agent ? { kind: 'agent', agent } : null;
  };
  // Best-effort caller identity for analytics. The gateway is stateless (a fresh
  // instance per request), so we can't correlate by session; instead we capture
  // the MCP handshake's clientInfo on `initialize` and attribute the tool calls
  // that follow to that client. Falls back to an X-Client-Name header or the
  // User-Agent. All local; nothing leaves the machine.
  let lastClient: { name: string; at: number } | undefined;
  const shortUa = (ua: string): string => {
    const first = ua.split(/[\s/]/)[0]?.trim();
    return first ? first : 'http client';
  };
  const callerFor = (req: IncomingMessage, body: unknown): string => {
    const b = body as { method?: string; params?: { clientInfo?: { name?: string; version?: string } } } | undefined;
    if (b?.method === 'initialize') {
      const ci = b.params?.clientInfo;
      const name = ci?.name ? `${ci.name}${ci.version ? ` ${ci.version}` : ''}` : undefined;
      if (name) lastClient = { name, at: Date.now() };
    }
    if (lastClient && Date.now() - lastClient.at < 10 * 60_000) return lastClient.name;
    const hdr = req.headers['x-client-name'];
    if (typeof hdr === 'string' && hdr.trim()) return hdr.trim();
    return shortUa(req.headers['user-agent'] ?? '');
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

  // An agent + its ready-to-paste connect snippet (scoped to the agent's token).
  const agentInfo = (a: AgentClient): AgentClientInfo => {
    const url = `http://localhost:${PORT}/mcp`;
    return {
      ...a,
      url,
      connectCommand: `claude mcp add -t http nekko-mcp-${a.id} ${url} -H "Authorization: Bearer ${a.token}"`,
      clientSnippet: {
        mcpServers: { [`nekko-mcp-${a.id}`]: { type: 'http', url, headers: { Authorization: `Bearer ${a.token}` } } },
      },
    };
  };

  const slugId = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'agent';
  /** Normalize a servers allow-list from a request body to `'*' | string[]`. */
  const normServers = (v: unknown): '*' | string[] =>
    v === '*' ? '*' : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

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
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version',
      });
      return res.end();
    }

    // ── the aggregated MCP endpoint (streamable HTTP, stateless) ──────────
    if (pathname === '/mcp') {
      const scope = authScope(req);
      if (!scope) return json(res, 401, { error: 'unauthorized' });
      if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
      try {
        const body = JSON.parse(await readBody(req));
        let caller: string;
        let allowServer: ((id: string) => boolean) | undefined;
        if (scope.kind === 'agent') {
          caller = scope.agent.name;
          const allow = scope.agent.servers;
          allowServer = (id) => allow === '*' || allow.includes(id);
          scope.agent.lastUsed = new Date().toISOString();
          persistClients();
        } else {
          caller = callerFor(req, body);
        }
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        const gateway = createGateway(supervisor, { name: 'nekko-mcp-gateway', version: VERSION }, { caller, allowServer });
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

    // Search the official MCP Registry. The one deliberate outbound call, and only
    // on an explicit user search — never on boot. Soft-fails to [] so the UI degrades.
    if (pathname === '/api/registry/search' && req.method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        return json(res, 200, await searchRegistry(q, { limit, signal: ctrl.signal }));
      } catch (e) {
        process.stderr.write(`[registry] search failed: ${e instanceof Error ? e.message : String(e)}\n`);
        return json(res, 200, []);
      } finally {
        clearTimeout(timer);
      }
    }
    if (pathname === '/api/gateway') return json(res, 200, gatewayInfo());
    if (pathname === '/api/analytics') return json(res, 200, supervisor.analytics());

    // ── connected agents (scoped gateway tokens) ─────────────────────────────
    if (pathname === '/api/clients' && req.method === 'GET') return json(res, 200, clients.map(agentInfo));
    if (pathname === '/api/clients' && req.method === 'POST') {
      try {
        const b = JSON.parse(await readBody(req)) as { name?: string; servers?: unknown };
        const name = (b.name ?? '').trim();
        if (!name) return json(res, 400, { error: 'name required' });
        const agent: AgentClient = {
          id: `${slugId(name)}-${randomBytes(2).toString('hex')}`,
          name,
          token: randomBytes(24).toString('hex'),
          servers: normServers(b.servers),
          createdAt: new Date().toISOString(),
        };
        clients.push(agent);
        saveClients(clients);
        return json(res, 200, agentInfo(agent));
      } catch {
        return json(res, 400, { error: 'invalid_json' });
      }
    }
    const clientM = /^\/api\/clients\/([^/]+)$/.exec(pathname);
    if (clientM && req.method === 'PATCH') {
      const agent = clients.find((c) => c.id === clientM[1]);
      if (!agent) return json(res, 404, { error: 'not_found' });
      try {
        const b = JSON.parse(await readBody(req)) as { name?: string; servers?: unknown };
        if (typeof b.name === 'string' && b.name.trim()) agent.name = b.name.trim();
        if (b.servers !== undefined) agent.servers = normServers(b.servers);
        saveClients(clients);
        return json(res, 200, agentInfo(agent));
      } catch {
        return json(res, 400, { error: 'invalid_json' });
      }
    }
    if (clientM && req.method === 'DELETE') {
      clients = clients.filter((c) => c.id !== clientM[1]);
      saveClients(clients);
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/servers' && req.method === 'GET') return json(res, 200, supervisor.list());

    // add a server (custom config, or a registry entry merged with overrides)
    if (pathname === '/api/servers' && req.method === 'POST') {
      try {
        const cfg = JSON.parse(await readBody(req)) as ManagedServerConfig;
        // A process server needs a command; a docker server needs an image (its
        // entrypoint runs when no command is given), so require one of the two.
        if (!cfg.id || !cfg.name || (!cfg.command && !cfg.image)) return json(res, 400, { error: 'id, name, and a command or image required' });
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
