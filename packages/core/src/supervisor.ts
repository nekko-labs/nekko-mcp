import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  AnalyticsSummary,
  ClientUsage,
  ManagedServerConfig,
  ServerState,
  ServerStatus,
  ServerUsage,
  UsageEvent,
} from '@nekko-mcp/shared';
import { runtimeFor } from './runtime.js';

const LOG_CAP = 500;
/** Cap on the retained event feed (for the recent-calls feed + time series). */
const EVENT_CAP = 2000;

interface ToolAgg {
  calls: number;
  errors: number;
  totalMs: number;
}
interface ServerAgg {
  name: string;
  calls: number;
  errors: number;
  bytesIn: number;
  bytesOut: number;
  totalMs: number;
  lastUsed?: string;
  tools: Map<string, ToolAgg>;
  clients: Set<string>;
}
interface ClientAgg {
  calls: number;
  errors: number;
  bytesIn: number;
  bytesOut: number;
  lastUsed: string;
}

interface Instance {
  config: ManagedServerConfig;
  client?: Client;
  transport?: StdioClientTransport;
  state: ServerState;
  tools: string[];
  error?: string;
  startedAt?: string;
  restarts: number;
  logs: string[];
}

const toStatus = (i: Instance): ServerStatus => ({
  id: i.config.id,
  name: i.config.name,
  runtime: i.config.runtime,
  state: i.state,
  tools: i.tools,
  error: i.error,
  startedAt: i.startedAt,
  restarts: i.restarts,
});

const pushLog = (i: Instance, chunk: string): void => {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line) continue;
    i.logs.push(line);
    if (i.logs.length > LOG_CAP) i.logs.shift();
  }
};

/**
 * Supervises managed MCP servers: launches each through its RuntimeAdapter,
 * connects an MCP client to it, tracks lifecycle state + tools + stderr logs,
 * and exposes the connected clients to the gateway. Secrets are passed to the
 * child at launch and never stored in status or logs.
 */
export class Supervisor {
  private instances = new Map<string, Instance>();

  // ── usage analytics ────────────────────────────────────────────────────
  // Aggregates persist for the daemon's lifetime; the event feed is a capped
  // ring buffer (older calls roll off the feed but stay counted in aggregates).
  private since = new Date().toISOString();
  private events: UsageEvent[] = [];
  private byServer = new Map<string, ServerAgg>();
  private byClient = new Map<string, ClientAgg>();
  private totals = { calls: 0, errors: 0, bytesIn: 0, bytesOut: 0 };

  list(): ServerStatus[] {
    return [...this.instances.values()].map(toStatus);
  }
  status(id: string): ServerStatus | undefined {
    const i = this.instances.get(id);
    return i ? toStatus(i) : undefined;
  }
  logs(id: string): string[] {
    return this.instances.get(id)?.logs ?? [];
  }
  ids(): string[] {
    return [...this.instances.keys()];
  }
  /** The connected client for a ready server — used by the gateway. */
  client(id: string): Client | undefined {
    const i = this.instances.get(id);
    return i?.state === 'ready' ? i.client : undefined;
  }

  /** Record one gateway tool call for analytics. Called by the gateway. */
  record(e: UsageEvent): void {
    this.events.push(e);
    if (this.events.length > EVENT_CAP) this.events.shift();

    this.totals.calls += 1;
    this.totals.bytesIn += e.bytesIn;
    this.totals.bytesOut += e.bytesOut;
    if (!e.ok) this.totals.errors += 1;

    let s = this.byServer.get(e.serverId);
    if (!s) {
      s = { name: e.server, calls: 0, errors: 0, bytesIn: 0, bytesOut: 0, totalMs: 0, tools: new Map(), clients: new Set() };
      this.byServer.set(e.serverId, s);
    }
    s.name = e.server || s.name;
    s.calls += 1;
    s.bytesIn += e.bytesIn;
    s.bytesOut += e.bytesOut;
    s.totalMs += e.ms;
    s.lastUsed = e.at;
    s.clients.add(e.client);
    if (!e.ok) s.errors += 1;

    let t = s.tools.get(e.tool);
    if (!t) {
      t = { calls: 0, errors: 0, totalMs: 0 };
      s.tools.set(e.tool, t);
    }
    t.calls += 1;
    t.totalMs += e.ms;
    if (!e.ok) t.errors += 1;

    let c = this.byClient.get(e.client);
    if (!c) {
      c = { calls: 0, errors: 0, bytesIn: 0, bytesOut: 0, lastUsed: e.at };
      this.byClient.set(e.client, c);
    }
    c.calls += 1;
    c.bytesIn += e.bytesIn;
    c.bytesOut += e.bytesOut;
    c.lastUsed = e.at;
    if (!e.ok) c.errors += 1;
  }

  /** Aggregated analytics for the daemon's `/api/analytics` endpoint + the UI. */
  analytics(recentCap = 50): AnalyticsSummary {
    const servers: ServerUsage[] = [...this.byServer.entries()]
      .map(([serverId, s]) => ({
        serverId,
        name: s.name,
        calls: s.calls,
        errors: s.errors,
        bytesIn: s.bytesIn,
        bytesOut: s.bytesOut,
        avgMs: s.calls ? Math.round(s.totalMs / s.calls) : 0,
        lastUsed: s.lastUsed,
        clients: [...s.clients],
        tools: [...s.tools.entries()]
          .map(([tool, t]) => ({ tool, calls: t.calls, errors: t.errors, avgMs: t.calls ? Math.round(t.totalMs / t.calls) : 0 }))
          .sort((a, b) => b.calls - a.calls),
      }))
      .sort((a, b) => b.calls - a.calls);

    const clients: ClientUsage[] = [...this.byClient.entries()]
      .map(([client, c]) => ({ client, calls: c.calls, errors: c.errors, bytesIn: c.bytesIn, bytesOut: c.bytesOut, lastUsed: c.lastUsed }))
      .sort((a, b) => b.calls - a.calls);

    const recent = this.events.slice(-recentCap).reverse();

    // 24 hourly buckets ending at the current hour (idx 23 = this hour = "now").
    const HOUR = 3_600_000;
    const base = Math.floor(Date.now() / HOUR) * HOUR;
    const buckets = new Array(24).fill(0);
    for (const e of this.events) {
      const eventHour = Math.floor(new Date(e.at).getTime() / HOUR) * HOUR;
      const idx = 23 - Math.round((base - eventHour) / HOUR);
      if (idx >= 0 && idx < 24) buckets[idx] += 1;
    }
    const series = buckets.map((calls, i) => ({ t: new Date(base - (23 - i) * HOUR).toISOString(), calls }));

    return {
      since: this.since,
      totalCalls: this.totals.calls,
      totalErrors: this.totals.errors,
      bytesIn: this.totals.bytesIn,
      bytesOut: this.totals.bytesOut,
      servers,
      clients,
      recent,
      series,
    };
  }

  async start(config: ManagedServerConfig): Promise<ServerStatus> {
    let inst = this.instances.get(config.id);
    if (!inst) {
      inst = { config, state: 'stopped', tools: [], restarts: 0, logs: [] };
      this.instances.set(config.id, inst);
    }
    inst.config = config;
    if (inst.state === 'ready' || inst.state === 'starting') return toStatus(inst);

    inst.state = 'starting';
    inst.error = undefined;
    try {
      const spec = runtimeFor(config.runtime).spawnSpec(config);
      const transport = new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        env: spec.env,
        cwd: spec.cwd,
        stderr: 'pipe',
      });
      transport.stderr?.on('data', (d: Buffer) => pushLog(inst!, d.toString()));
      const client = new Client({ name: 'nekko-mcp', version: '0.1.0' }, { capabilities: {} });
      await client.connect(transport);
      const { tools } = await client.listTools();
      inst.client = client;
      inst.transport = transport;
      inst.tools = tools.map((t) => t.name);
      inst.state = 'ready';
      inst.startedAt = new Date().toISOString();
    } catch (e) {
      inst.state = 'errored';
      inst.error = e instanceof Error ? e.message : String(e);
      pushLog(inst, `[supervisor] start failed: ${inst.error}`);
    }
    return toStatus(inst);
  }

  async stop(id: string): Promise<void> {
    const inst = this.instances.get(id);
    if (!inst) return;
    try {
      await inst.client?.close();
    } catch {
      /* already gone */
    }
    inst.client = undefined;
    inst.transport = undefined;
    inst.tools = [];
    if (inst.state !== 'errored') inst.state = 'stopped';
  }

  /** Stop a server and drop it from the roster entirely (config was deleted). */
  async remove(id: string): Promise<void> {
    await this.stop(id);
    this.instances.delete(id);
  }

  async restart(config: ManagedServerConfig): Promise<ServerStatus> {
    await this.stop(config.id);
    const inst = this.instances.get(config.id);
    if (inst) inst.restarts += 1;
    return this.start(config);
  }

  async stopAll(): Promise<void> {
    for (const id of this.ids()) await this.stop(id);
  }
}
