// A trivial stdio MCP server used by tests/probe so we never depend on an
// external binary. Exposes one tool, `echo`, that returns its input text.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({ name: 'echo', version: '0.0.1' });
server.tool('echo', 'Echo back the provided text.', { text: z.string() }, async ({ text }) => ({
  content: [{ type: 'text', text }],
}));
await server.connect(new StdioServerTransport());
