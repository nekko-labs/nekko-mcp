---
status: active
created: 2026-06-28
owner: Philip
type: code
---

# NekkoMCP — Spec

> **Source of truth for *what* NekkoMCP is and *why*.** The *how* (stack, architecture, conventions, backlog) lives in [`TASKS.md`](TASKS.md). Living document: every shipped feature gets a status + release-version entry here; new work is broken down in `TASKS.md` first.

## 1. Vision & Positioning

**NekkoMCP** is an **open-source, local-first runtime and manager for MCP (Model Context Protocol) servers** — a ToolHive rival you actually own. It securely runs MCP servers, supervises them, and exposes them through a single gateway endpoint that any agent harness (Claude Code, Cursor, **Open Paw**, Codex, VS Code) can connect to.

It is **not just a connector list** — it is a proper MCP *server runtime*: it launches servers, isolates them, manages their secrets, watches their health, and aggregates them.

| It rivals | …and wins by |
| --- | --- |
| **ToolHive** (Stacklok) | Fully local-first and free, **no Docker requirement** (Docker is opt-in, not mandatory), with a beautiful built-in UI and a one-paste gateway URL. Self-host the registry/gateway; nothing phones home. |
| **Docker MCP Toolkit** | Doesn't require Docker Desktop; runs servers as sandboxed processes by default; cross-platform. |
| **MetaMCP / MCPHub** | A real supervisor with isolation + secrets + health, not just a proxy; first-class agent-harness integration; a polished UI. |

**Two faces, one engine:**
1. **Standalone app** — its own UI (web now, Electron later) to add, configure, run, and monitor MCP servers; rivals ToolHive's portal.
2. **Baked-in Open Paw tab** — the same UI shipped as `@nekko-mcp/ui` and embedded as an MCP-management pane inside Open Paw (which is already an MCP *client*; NekkoMCP is the *server runtime* it manages).

**The three feelings we sell:**
1. **Secure by choice** — pick your isolation at setup (containers *or* sandboxed processes); we make the tradeoff explicit, never force Docker.
2. **One endpoint** — run many servers, expose one gateway URL; paste it into any harness.
3. **Yours, local, free** — open source (MIT), nekko-labs org; runs on your machine, no account required.

### Isolation model (user-selectable at setup)

NekkoMCP lets the user choose the runtime per install (and per server override). We surface the tradeoffs plainly:

| Runtime | Isolation | Pros | Cons |
| --- | --- | --- | --- |
| **Process sandbox** (default, no deps) | Child process: scrubbed/allow-listed env, injected secrets only, restricted CWD, resource limits (cpu/mem/file-descriptor), optional network-egress allow-list, no shell | Zero dependencies, instant start, cross-platform, lightest; great for solo/local dev | Weaker boundary than a container (shares the kernel/user); a malicious server has more reach than in a container |
| **Docker container** (opt-in) | Container-per-server: image pinned, read-only rootfs where possible, dropped caps, network policy, CPU/mem limits, secrets via env/files | Strong isolation + reproducibility + audit; ToolHive-grade | Requires Docker installed/running; slower cold start; heavier on resources |

Default = **process sandbox** (works everywhere); **Docker** offered prominently for those who want container isolation. The choice is a setup step and overridable per server.

### Scope boundaries (deliberate)
- **Local-first**: the runtime + gateway run on the user's machine; no account or cloud required. A hosted/team tier may come later.
- **Harness-agnostic**: we expose a standard MCP gateway (stdio + streamable HTTP/SSE) so *any* client works; we don't lock to Open Paw.
- Not a hosted SaaS registry (we ship a curated catalog + custom server config; community/registry sync is later).

## 2. Users & Core Journeys
- **Agent power-user / developer**: "I have 6 MCP servers (filesystem, github, postgres, my vault, …). I want them running safely and reachable from Claude Code via one URL — without hand-editing JSON per client."
- **Open Paw user**: "Manage my MCP servers in a tab, toggle them on/off, see their tools and logs, and have my agent use them."
- **Privacy/security-minded**: "Run untrusted community MCP servers in a container so they can't read my whole disk."

Journeys: add a server (from catalog or custom command/image) → choose runtime → start → see status/tools/logs → copy the gateway URL → the agent uses the aggregated tools. Toggle, restart, edit secrets, stop.

## 3. Feature Set

### 3.1 Server runtime & supervisor `[planned → MVP]`
| Feature | Description | Status | Release |
| --- | --- | --- | --- |
| Process runtime | Spawn a stdio MCP server as a sandboxed child (allow-listed env, injected secrets, restricted CWD, resource limits); capture logs; health/restart | planned | v0.1.0 |
| Docker runtime | Container-per-server (opt-in): pull/run image, env/secrets, caps/network/limits | planned | v0.2.0 |
| Supervisor | Start/stop/restart, status (starting/ready/errored/stopped), crash backoff, structured logs ring-buffer | planned | v0.1.0 |
| Secrets | Per-server secrets stored locally (OS keychain when available), injected at launch, never logged | planned | v0.2.0 |

### 3.2 Gateway `[planned → MVP]`
| Feature | Description | Status | Release |
| --- | --- | --- | --- |
| Aggregating MCP gateway | One MCP endpoint that fans out to all running servers; tools/resources/prompts namespaced per server; routes calls to the owning server | planned | v0.1.0 |
| Transports | stdio (for direct client spawn) + streamable HTTP/SSE (for URL-based clients) | planned | v0.1.0 |
| Per-client tokens | Bearer-token auth on the HTTP gateway; per-client allow-list of which servers/tools are exposed | planned | v0.2.0 |

### 3.3 Registry / catalog `[planned]`
| Feature | Description | Status | Release |
| --- | --- | --- | --- |
| Curated catalog | Built-in list of popular MCP servers (filesystem, github, postgres, fetch, **nekko-vault-mcp**, …) with one-click add | planned | v0.1.0 |
| Custom server | Add by command+args+env (process) or image (docker) | planned | v0.1.0 |

### 3.4 UI `[planned]`
| Feature | Description | Status | Release |
| --- | --- | --- | --- |
| Web UI | Server list with status, add-from-catalog/custom, start/stop, logs viewer, tools inspector, copy gateway URL + per-client config snippets | planned | v0.1.0 |
| Shared `@nekko-mcp/ui` | The same UI as a package Open Paw embeds as an "MCP" pane | planned | v0.2.0 |
| Electron shell | Standalone desktop app wrapping the daemon + UI | planned | later |

### 3.5 Integrations `[planned]`
| Feature | Description | Status | Release |
| --- | --- | --- | --- |
| Open Paw tab | `@nekko-mcp/ui` embedded as a pane; talks to the local daemon | planned | v0.2.0 |
| Client config export | Generate the `.mcp.json` / client snippet pointing at the gateway | planned | v0.1.0 |

## 4. Design System & Considerations
Reuse the Nekko design language (warm-neutral ink/paper ramp, salmon→coral accent, calm/minimal, dark+light, the 8-bit Nekko cat). The UI must read as a sibling of Open Paw and Nekko Notes. Status colors: ready=success, starting=info, errored=danger, stopped=ink-3. Logs are monospace with a sheen-free, fast virtualized view.

## 5. Technical Architecture & Decisions (with the *why*)
See [`TASKS.md`](TASKS.md). Key decisions: TypeScript + npm workspaces (match the org stack so the UI can be shared with Open Paw); a long-running **daemon** (`nekko-mcpd`) as the runtime + management API + gateway; a **RuntimeAdapter** interface with `ProcessRuntime` (default) and `DockerRuntime` (opt-in) so isolation is pluggable + user-selectable; the gateway built on `@modelcontextprotocol/sdk` (client per managed server ↔ one aggregated server). Local-first, no account.
