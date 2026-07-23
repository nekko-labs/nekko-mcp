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
    description: 'Official remote GitHub MCP server: repos, issues, PRs, code, Actions. Browser sign-in — no token to paste.',
    runtime: 'remote',
    command: '',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'http',
    auth: 'oauth',
    // GitHub has no dynamic client registration and requires client auth at the
    // token endpoint even with PKCE, so it needs a pre-registered app id + secret:
    // set NEKKO_MCP_CLIENTID_GITHUB and NEKKO_MCP_CLIENTSECRET_GITHUB.
    note: 'Needs a registered GitHub OAuth app (set NEKKO_MCP_CLIENTID_GITHUB + NEKKO_MCP_CLIENTSECRET_GITHUB) — GitHub has no automatic app registration.',
    homepage: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Up-to-date, version-specific docs and code examples for any library, injected into your prompts. One-click browser sign-in.',
    runtime: 'remote',
    command: '',
    url: 'https://mcp.context7.com/mcp/oauth',
    transport: 'http',
    auth: 'oauth',
    homepage: 'https://context7.com',
  },
  {
    id: 'github-pat',
    name: 'GitHub (token)',
    description: 'Local GitHub server via a personal access token — the offline/self-hosted alternative to the OAuth entry.',
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
    id: 'fly',
    name: 'Fly.io',
    description: 'Deploy and manage Fly.io apps: status, logs, secrets, machines, scaling, and releases.',
    runtime: 'process',
    command: 'flyctl',
    args: ['mcp', 'server'],
    requires: ['FLY_API_TOKEN'],
    homepage: 'https://fly.io/docs/flyctl/mcp/',
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
