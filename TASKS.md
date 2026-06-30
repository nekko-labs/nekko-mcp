---
status: active
created: 2026-06-28
owner: Philip
type: code
---

# Execution Plan — NekkoMCP

> Converted from executionplan.md on 2026-06-29. ✅ = done per the prior plan; Part 1 below is the technical plan, Part 2 is the task checklist.

> **The plan + the build log, in one file.** The top half (Part 1) is the technical plan — how we build what `SPEC.md` describes. The bottom half (Part 2) is the task list — Now / Backlog / Shipped, recording how past features were built and how future ones will be. (Merged from the former `plan.md` + `tasks.md`.)

---

# Part 1 — Plan (how we build it)

> **How.** Stack, architecture, conventions, and the execution backlog. The *what & why* lives in [`SPEC.md`](SPEC.md).

## 1. Stack (decided — do not relitigate)

| Area | Choice | Why |
| --- | --- | --- |
| Language / repo | **TypeScript, npm workspaces** (Node ≥20; runnable with **bun**) | Matches the org stack (Nekko Notes, Open Paw) so `@nekko-mcp/ui` can be shared into Open Paw; no pnpm/yarn (duplicate-React breakage). |
| Daemon | Node/Bun long-running process (`nekko-mcpd`) — HTTP management API + MCP gateway + supervisor | A ToolHive rival needs a resident runtime to launch/supervise servers and hold the gateway. |
| MCP | `@modelcontextprotocol/sdk` (client per managed server, one aggregated server for the gateway) | Official SDK; same dep Open Paw + the Notes CLI already use. |
| UI | Vite + React + TS + Tailwind + Zustand (Nekko design tokens) | Consistent with Notes/Open Paw; the UI package embeds as an Open Paw pane. |
| Isolation | **RuntimeAdapter** interface: `ProcessRuntime` (default) + `DockerRuntime` (opt-in), user-selectable at setup | Don't force Docker; make the security tradeoff explicit (see spec §1). |
| Desktop (later) | Electron (reuse Open Paw's desktop pattern) | "Real app" shell; deferred past the web MVP. |
| Test/CI | Vitest (core units) + a daemon smoke/probe (spawn a stdio server through the gateway) + GitHub Actions | Same gate discipline as Notes. |

## 2. Repo Layout

```
nekko-mcp/                         GitHub: nekko-labs/nekko-mcp (public, MIT)
  packages/
    shared/   types + API/IPC contract (ManagedServer, RuntimeKind, ServerStatus,
              RegistryEntry, GatewayConfig, daemon API request/response types)
    core/     pure-ish engine: registry catalog, server-config validation,
              RuntimeAdapter interface + ProcessRuntime + DockerRuntime, Supervisor,
              gateway aggregation logic  (+ *.test.ts)
    ui/       @nekko-mcp/ui — shared React UI (embeds in Open Paw)
  apps/
    daemon/   nekko-mcpd — HTTP management API + MCP gateway (stdio + HTTP/SSE) + supervisor host
    web/      Vite React app (standalone UI) → talks to the daemon
    desktop/  Electron shell (later)
  docker-compose.yml · tsconfig.base.json
```

## 3. Architecture

- **Daemon (`nekko-mcpd`)** holds the `Supervisor` (a map of `ManagedServer` → running instance via a `RuntimeAdapter`). It exposes:
  - **Management API** (HTTP, localhost): `GET /api/servers`, `POST /api/servers` (add), `POST /api/servers/:id/start|stop|restart`, `GET /api/servers/:id/logs`, `GET /api/registry`, `GET /api/gateway` (URL + token + client snippets).
  - **Gateway**: an aggregating MCP server. For each running managed server it holds an MCP **client**; it merges their `tools`/`resources`/`prompts` (namespaced `server__tool`) and routes calls to the owner. Exposed over **stdio** (clients can spawn `nekko-mcp gateway`) and **streamable HTTP/SSE** (URL-based clients, bearer token).
- **RuntimeAdapter** interface: `start(server): Promise<RunningServer>`, `stop`, `logs`, `health`. `ProcessRuntime` spawns a child (allow-listed env, injected secrets, restricted CWD, resource limits, no shell). `DockerRuntime` runs a container (image, caps, network, limits). Chosen by `server.runtime` (default from setup).
- **UI** (`@nekko-mcp/ui`) is transport-light: it calls the daemon's HTTP API. The standalone `apps/web` and the Open Paw tab both render it; only the base URL differs.

## 4. Conventions
- Pure logic in `packages/core` (unit-tested); the daemon wires IO. No secret ever logged. Local-first: no network egress from the daemon itself except what a managed server does.
- Build → verify → push to `main` (CI green). Conventional commits. Mock/test the supervisor with a trivial in-repo echo MCP server so tests need no external binaries.
- Every shipped feature → status + release in `SPEC.md`; new work broken down here first.

## 5. Execution Plan (backlog)

Status `[ ]` open · `[~]` partial · `[x]` done.

### Epic 0 — Scaffold
- [ ] Repo skeleton: workspaces, tsconfig.base, lint/build scripts, `.mcp.json`-style examples.
- [ ] `packages/shared`: core types + daemon API contract.
- [ ] Cross-project: rename Nekko Notes CLI bin `nekko-mcp` → `nekko-vault-mcp` (frees the name; it's a catalog entry here).

### Epic 1 — Runtime & supervisor (v0.1.0)
- [ ] `RuntimeAdapter` interface + `ProcessRuntime` (sandboxed child: env allow-list, secrets, CWD, rlimits, no shell) + log ring-buffer.
- [ ] `Supervisor`: start/stop/restart/status, crash backoff. Unit tests against an in-repo echo MCP server.
- [ ] `DockerRuntime` (opt-in): container-per-server.

### Epic 2 — Gateway (v0.1.0)
- [ ] Aggregating MCP gateway: client-per-server, namespaced tool/resource merge, call routing.
- [ ] Transports: stdio + streamable HTTP/SSE. Smoke probe: run echo server through the gateway, list+call a tool.
- [ ] Per-client bearer token + server/tool allow-list (v0.2.0).

### Epic 3 — Registry & API (v0.1.0)
- [ ] Curated catalog (filesystem, github, fetch, postgres, nekko-vault-mcp, …) + custom (command/image).
- [ ] Daemon HTTP management API + client-config export (`.mcp.json` snippet for the gateway).

### Epic 4 — UI (v0.1.0 → v0.2.0)
- [ ] `apps/web` standalone UI: server list/status, add, start/stop, logs, tools inspector, copy gateway URL.
- [ ] Extract `@nekko-mcp/ui` shared package.

### Epic 5 — Open Paw embed (v0.2.0)
- [ ] Add an `mcp` pane kind in Open Paw rendering `@nekko-mcp/ui` against the local daemon.

### Epic 6 — Distribution (later)
- [ ] Electron desktop shell; docker-compose for self-host; signed releases; GitHub Actions (paused like Notes until launch).

## 6. How We Work
Same as the org: spec is the product source of truth, plan is broken-down-first, build+verify+push to main, local-first + explicit-tradeoff invariants.

---

# Part 2 — Tasks (what's built and what's next)

Mirror of Part 1 §5. `[x]` = shipped per the prior plan · `[ ]` = open.

## Epic 0 — Scaffold
- [x] **Workspace project docs** — spec/plan/tasks/README/AGENTS/memory.
- [x] **Repo skeleton** — npm workspaces, tsconfig.base, build/test scripts. Repo live: github.com/nekko-labs/nekko-mcp (README splash).
- [x] **`packages/shared`** — core types + daemon API contract.
- [x] **Cross-project rename** — Nekko Notes CLI bin `nekko-mcp` → `nekko-vault-mcp`.

## Epic 1 — Runtime & supervisor (v0.1.0)
- [x] **`RuntimeAdapter` + `ProcessRuntime`** — sandboxed child, allow-listed env, log buffer. · [spec](SPEC.md#31-server-runtime--supervisor-planned--mvp)
- [x] **`Supervisor`** — start/stop/restart/status, logs; e2e test vs an in-repo echo MCP server. · [spec](SPEC.md#31-server-runtime--supervisor-planned--mvp)
- [x] **`DockerRuntime` (opt-in)** — + unit tests (spec only; needs Docker to run live). · [spec](SPEC.md#31-server-runtime--supervisor-planned--mvp)
- [ ] **Crash backoff / auto-restart loop; secrets in OS keychain** · [spec](SPEC.md#31-server-runtime--supervisor-planned--mvp) · Added: 2026-06-29

## Epic 2 — Gateway (v0.1.0)
- [x] **Aggregating MCP gateway** — client-per-server, namespaced `server__tool` merge, routing; proven end-to-end in tests. · [spec](SPEC.md#32-gateway-planned--mvp)
- [x] **stdio transport** — `nekko-mcpd --stdio`. · [spec](SPEC.md#32-gateway-planned--mvp)
- [ ] **Streamable HTTP/SSE transport** · [spec](SPEC.md#32-gateway-planned--mvp) · Added: 2026-06-29
- [ ] **Per-client token + allow-list (v0.2.0)** · [spec](SPEC.md#32-gateway-planned--mvp) · Added: 2026-06-29

## Epic 3 — Registry & API (v0.1.0)
- [x] **Curated catalog** — filesystem/github/fetch/postgres/nekko-vault + custom server config. · [spec](SPEC.md#33-registry--catalog-planned)
- [x] **Daemon HTTP management API** — list/add/remove/start/stop/restart/logs/gateway + client-config export. · [spec](SPEC.md#32-gateway-planned--mvp)

## Epic 4 — UI
- [x] **`apps/web` standalone UI** — list/status/add-from-catalog-or-custom/start-stop/restart/logs/tools/runtime-picker/gateway copy. · [spec](SPEC.md#34-ui-planned)
- [ ] **Extract `@nekko-mcp/ui`** — shared package for the Open Paw tab. · [spec](SPEC.md#34-ui-planned) · Added: 2026-06-29

## Epic 5 — Open Paw embed (v0.2.0)
- [ ] **`mcp` pane in Open Paw** — rendering `@nekko-mcp/ui`. · [spec](SPEC.md#35-integrations-planned) · Added: 2026-06-29

## Epic 6 — Distribution (later)
- [ ] **Electron shell · docker-compose · signed releases · paused GitHub Actions** · [spec](SPEC.md#34-ui-planned) · Added: 2026-06-29
