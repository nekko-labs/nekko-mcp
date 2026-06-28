import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ManagedServerConfig, ServerState, ServerStatus } from '@nekko-mcp/shared';
import { runtimeFor } from './runtime.js';

const LOG_CAP = 500;

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
