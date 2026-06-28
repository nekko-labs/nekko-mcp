import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Supervisor } from './supervisor.js';

/** Separator between a server id and its tool name in the aggregated namespace. */
export const NS = '__';

/**
 * Build the aggregating MCP gateway: one MCP server that fans out to every
 * ready managed server. Tools are namespaced `${serverId}__${tool}` and calls
 * are routed to the owning server's client. The caller connects the returned
 * Server to a transport (stdio for spawn-based clients; HTTP/SSE for URL ones).
 */
export function createGateway(
  supervisor: Supervisor,
  info: { name: string; version: string } = { name: 'nekko-mcp-gateway', version: '0.1.0' },
): Server {
  const server = new Server(info, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools: { name: string; description?: string; inputSchema: unknown }[] = [];
    for (const id of supervisor.ids()) {
      const client = supervisor.client(id);
      if (!client) continue;
      try {
        const res = await client.listTools();
        for (const t of res.tools) {
          tools.push({
            name: `${id}${NS}${t.name}`,
            description: t.description ? `[${id}] ${t.description}` : `[${id}] ${t.name}`,
            inputSchema: t.inputSchema,
          });
        }
      } catch {
        /* a server that went away is simply skipped */
      }
    }
    return { tools } as never;
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const full = req.params.name;
    const idx = full.indexOf(NS);
    if (idx < 0) throw new Error(`Unknown tool "${full}" — expected "<server>${NS}<tool>".`);
    const id = full.slice(0, idx);
    const name = full.slice(idx + NS.length);
    const client = supervisor.client(id);
    if (!client) throw new Error(`Server "${id}" is not ready.`);
    return (await client.callTool({ name, arguments: req.params.arguments ?? {} })) as never;
  });

  return server;
}
