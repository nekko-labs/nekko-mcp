import type { RegistryEntry } from '@nekko-mcp/shared';

/**
 * Curated catalog of popular MCP servers users can add in one click. Process
 * commands assume the package is runnable via `npx`; the Docker recommendation
 * is offered when an official image exists. Users can override the runtime.
 */
export const REGISTRY: RegistryEntry[] = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read/write files under allowed directories.',
    runtime: 'process',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem'],
    requires: ['ALLOWED_DIR'],
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repos/issues/PRs and read code via the GitHub API.',
    runtime: 'process',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    requires: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: 'Fetch a URL and return its content as Markdown.',
    runtime: 'process',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'postgres',
    name: 'Postgres',
    description: 'Read-only SQL access to a Postgres database.',
    runtime: 'process',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    requires: ['DATABASE_URL'],
    homepage: 'https://github.com/modelcontextprotocol/servers',
  },
  {
    id: 'nekko-vault',
    name: 'Nekko Vault',
    description: 'Your Nekko Notes vault as agent memory + RAG (list/search/read/create notes).',
    runtime: 'process',
    command: 'nekko-vault-mcp',
    requires: ['NEKKO_VAULT'],
    homepage: 'https://github.com/nekko-labs/nekko-notes',
  },
];

export const registryEntry = (id: string): RegistryEntry | undefined => REGISTRY.find((e) => e.id === id);
