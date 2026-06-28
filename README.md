# NekkoMCP

**Local-first runtime & manager for MCP servers — a [ToolHive](https://github.com/stacklok/toolhive) rival you own.** Run MCP servers securely, supervise them, and expose **one gateway endpoint** any agent harness (Claude Code, Cursor, [Open Paw](https://github.com/nekko-labs/open-paw), Codex) can use. Not just a connector list — a proper server runtime.

> Open source · MIT · [nekko-labs](https://github.com/nekko-labs). Standalone app **and** an embeddable tab in Open Paw.

## Why
Open Paw and Claude Code are MCP *clients*. NekkoMCP is the piece they need: a secure local *server runtime/manager* — a supervisor + an aggregating gateway. Add servers from a catalog (or custom), pick how they're isolated, start them, and paste one URL/command into your agent.

## Isolation — your choice (the tradeoff, plainly)

| Runtime | Isolation | Pros | Cons |
|---|---|---|---|
| **Process sandbox** (default, no deps) | Scrubbed/allow-listed env, injected secrets only, restricted CWD/limits, no shell | Zero dependencies, instant, cross-platform | Weaker than a container (shared kernel) |
| **Docker** (opt-in) | Container-per-server (`docker run -i`, dropped caps, no-new-privileges) | Strong isolation + reproducibility | Requires Docker; heavier/slower cold start |

The whole isolation model reduces to *"what command do we spawn over stdio"* — process = the server's own command; Docker = `docker run -i … image`. Set it at setup, override per server.

## Architecture

```
packages/shared   types + daemon API contract
packages/core     RuntimeAdapter (Process | Docker) · Supervisor · aggregating Gateway · registry
apps/daemon       nekko-mcpd: HTTP management API  +  `--stdio` aggregated MCP endpoint
```

- **Supervisor** launches each server through its `RuntimeAdapter`, connects an MCP client, tracks state/tools/logs (secrets never logged).
- **Gateway** merges every ready server's tools (namespaced `server__tool`) into one MCP server and routes calls — exposed over stdio now (HTTP/SSE next).

## Develop

```bash
npm install
npm run build
npm test          # spawns a real stdio MCP server → aggregates it via the gateway → calls a tool

npm run daemon                       # HTTP management API on http://localhost:7777
node apps/daemon/dist/index.js --stdio   # the aggregated gateway over stdio
```

### Use it from Claude Code

Point your client at the aggregated gateway — one endpoint for all your servers:

```json
{ "mcpServers": { "nekko-mcp": { "command": "nekko-mcpd", "args": ["--stdio"] } } }
```

## Status
Kicked off 2026-06-28. **Vertical slice working**: process-runtime supervisor + aggregating gateway, proven end-to-end in tests; daemon HTTP API + curated catalog. Next: Docker runtime, the web UI, per-client tokens, and the Open Paw `mcp` tab (`@nekko-mcp/ui`). See the project's `spec.md`/`plan.md`.
