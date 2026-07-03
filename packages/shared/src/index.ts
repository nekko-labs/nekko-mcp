/**
 * NekkoMCP shared types & contracts.
 *
 * The core insight: every isolation mode reduces to "what command do we spawn
 * over stdio." Process = the server's own command; Docker = `docker run -i …`.
 * A RuntimeAdapter turns a ManagedServerConfig into a SpawnSpec; the supervisor
 * connects an MCP client to it; the gateway aggregates all of them.
 */

/** How a server is isolated when it runs. User-selectable at setup + per-server. */
export type RuntimeKind = 'process' | 'docker';

/** Lifecycle state of a managed server. */
export type ServerState = 'stopped' | 'starting' | 'ready' | 'errored';

/** A server NekkoMCP manages. Persisted in the daemon's config. */
export interface ManagedServerConfig {
  id: string;
  name: string;
  /** Isolation runtime; defaults to the install's setup choice. */
  runtime: RuntimeKind;
  /** The server's launch command (process runtime) or the in-container command (docker). */
  command: string;
  args?: string[];
  /** Non-secret env passed through (allow-listed). */
  env?: Record<string, string>;
  /** Secret env injected at launch only — never logged or returned by the API. */
  secrets?: Record<string, string>;
  /** Working directory (process runtime). */
  cwd?: string;
  /** Container image (docker runtime). */
  image?: string;
  /** Whether the supervisor should run it. */
  enabled: boolean;
}

/** What a RuntimeAdapter produces: the concrete stdio process to launch. */
export interface SpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
}

/** Runtime status the API/UI shows. Never includes secrets. */
export interface ServerStatus {
  id: string;
  name: string;
  runtime: RuntimeKind;
  state: ServerState;
  /** Tool names exposed by this server (namespaced form is `${id}__${tool}`). */
  tools: string[];
  /** Last error message, if state === 'errored'. */
  error?: string;
  startedAt?: string;
  restarts: number;
}

/** A curated/known server users can add in one click. */
export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  /** Recommended runtime; the user can override. */
  runtime: RuntimeKind;
  command: string;
  args?: string[];
  image?: string;
  /** Names of env/secret keys the server needs (prompted on add). */
  requires?: string[];
  homepage?: string;
}

/** Daemon management API (HTTP, localhost) — request/response contracts. */
export interface GatewayInfo {
  /** Streamable-HTTP MCP endpoint for URL-based clients. */
  url: string;
  /** stdio command a client can spawn for the aggregated gateway. */
  stdioCommand: string;
  /** Bearer token for the HTTP endpoint (when auth is on). */
  token?: string;
  /** A ready-to-paste `.mcp.json` snippet for the gateway (HTTP transport). */
  clientSnippet: Record<string, unknown>;
  /** A ready-to-paste `.mcp.json` snippet for the stdio gateway. */
  stdioSnippet?: Record<string, unknown>;
  /** The daemon's own web UI, served at the daemon root. */
  uiUrl?: string;
}
