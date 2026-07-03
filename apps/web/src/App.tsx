import { useEffect, useState, useCallback } from 'react';
import type { ServerStatus, RegistryEntry, GatewayInfo, ManagedServerConfig, RuntimeKind } from '@nekko-mcp/shared';
import { api } from './api';

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  }, []);
  return [copied, copy];
}

export function App() {
  const [servers, setServers] = useState<ServerStatus[] | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [offline, setOffline] = useState(false);
  const [adding, setAdding] = useState<RegistryEntry | 'custom' | null>(null);

  const refresh = useCallback(async () => {
    try {
      setServers(await api.servers());
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void api.registry().then(setRegistry).catch(() => {});
    void api.gateway().then(setGateway).catch(() => {});
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const running = servers?.filter((s) => s.state === 'ready').length ?? 0;
  const tools = servers?.reduce((n, s) => n + s.tools.length, 0) ?? 0;

  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <div className="logo-tile">🐾</div>
          <span className="wordmark">NekkoMCP</span>
          <span className="chip">v0.2</span>
          <span className={`pill ${offline ? 'pill-errored' : 'pill-ready'}`}>
            <span className="dot" />
            {offline ? 'daemon offline' : 'daemon running'}
          </span>
          <div className="spacer" />
          <a className="small muted" href="https://github.com/nekko-labs/nekko-mcp" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </header>

      <div className="wrap">
        <section className="hero">
          <h1>
            Every MCP server. <span className="grad-text">One endpoint.</span>
          </h1>
          <p className="sub">
            Run MCP servers in sandboxed processes or Docker containers, supervise them,
            and connect any agent, Claude Code, Cursor, Open Paw, through a single gateway URL.
            Local-first, open source, no account.
          </p>
          <div className="stats">
            <div className="stat"><b>{servers?.length ?? '–'}</b><span>servers</span></div>
            <div className="stat"><b>{running}</b><span>running</span></div>
            <div className="stat"><b>{tools}</b><span>tools aggregated</span></div>
          </div>
        </section>

        {offline && (
          <div className="card banner">
            <b>Can't reach the daemon.</b>{' '}
            <span className="muted">Start it with <code>npm run daemon</code> (or <code>npm run dev</code>), then this page reconnects automatically.</span>
          </div>
        )}

        {gateway && <GatewayCard gateway={gateway} />}

        <h3 className="section-title">Servers</h3>
        {servers && servers.length === 0 ? (
          <div className="empty">
            <div className="cat">🐈</div>
            <b>No servers yet.</b>
            <div className="small" style={{ marginTop: 4 }}>Add one from the catalog below, its tools join the gateway instantly.</div>
          </div>
        ) : (
          <div className="server-list">
            {servers?.map((s) => <ServerRow key={s.id} s={s} onChange={refresh} />)}
          </div>
        )}

        <h3 className="section-title">Add servers</h3>
        <div className="catalog">
          {registry.map((e) => (
            <div key={e.id} className="card flat catalog-card">
              <div className="row between">
                <h4>{e.name}</h4>
                <span className="chip">{e.runtime}</span>
              </div>
              <p>{e.description}</p>
              {(e.requires ?? []).length > 0 && (
                <div className="req">{e.requires!.map((r) => <span key={r} className="chip mono">{r}</span>)}</div>
              )}
              <div className="row between" style={{ marginTop: 4 }}>
                {e.homepage ? <a className="small" href={e.homepage} target="_blank" rel="noreferrer">docs</a> : <span />}
                <button className="btn" onClick={() => setAdding(e)}>+ Add</button>
              </div>
            </div>
          ))}
          <div className="card flat catalog-card" style={{ borderStyle: 'dashed' }}>
            <h4>Custom server</h4>
            <p>Any stdio MCP server, by command (process sandbox) or image (Docker).</p>
            <div className="row between" style={{ marginTop: 4 }}>
              <span />
              <button className="btn btn-primary" onClick={() => setAdding('custom')}>+ Configure</button>
            </div>
          </div>
        </div>

        {adding && (
          <AddServer
            entry={adding === 'custom' ? null : adding}
            onClose={() => setAdding(null)}
            onAdded={() => { setAdding(null); void refresh(); }}
          />
        )}

        <div className="footer">
          <span>Local-first · MIT · Nekko Labs</span>
          <div className="spacer" style={{ flex: 1 }} />
          <a href="https://github.com/nekko-labs/nekko-mcp" target="_blank" rel="noreferrer">nekko-labs/nekko-mcp</a>
        </div>
      </div>
    </>
  );
}

function GatewayCard({ gateway }: { gateway: GatewayInfo }) {
  const [copied, copy] = useCopy();
  const [showToken, setShowToken] = useState(false);
  const [tab, setTab] = useState<'claude' | 'json' | 'stdio' | 'openpaw'>('claude');

  const token = gateway.token ?? '';
  const snippets: Record<string, string> = {
    claude: `claude mcp add -t http nekko-mcp ${gateway.url} -H "Authorization: Bearer ${token}"`,
    json: JSON.stringify(gateway.clientSnippet, null, 2),
    stdio: JSON.stringify(gateway.stdioSnippet ?? { mcpServers: { 'nekko-mcp': { command: 'nekko-mcpd', args: ['--stdio'] } } }, null, 2),
    openpaw: 'Open Paw auto-detects NekkoMCP.\nSettings → MCP servers → "Connect NekkoMCP gateway" — one click, done.',
  };

  return (
    <section className="card" style={{ marginTop: 10 }}>
      <div className="row between">
        <b>Gateway</b>
        <span className="chip chip-accent">every running server, one MCP endpoint</span>
      </div>

      <div className="endpoint">
        <span className="label">HTTP</span>
        <span className="value">{gateway.url}</span>
        <button className="btn" onClick={() => copy('url', gateway.url)}>{copied === 'url' ? 'Copied!' : 'Copy'}</button>
      </div>
      <div className="endpoint">
        <span className="label">Token</span>
        <span className="value">{showToken ? token : '•'.repeat(Math.min(token.length, 40))}</span>
        <button className="btn btn-ghost" onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</button>
        <button className="btn" onClick={() => copy('token', token)}>{copied === 'token' ? 'Copied!' : 'Copy'}</button>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'claude' ? 'active' : ''}`} onClick={() => setTab('claude')}>Claude Code</button>
        <button className={`tab ${tab === 'json' ? 'active' : ''}`} onClick={() => setTab('json')}>.mcp.json</button>
        <button className={`tab ${tab === 'stdio' ? 'active' : ''}`} onClick={() => setTab('stdio')}>stdio</button>
        <button className={`tab ${tab === 'openpaw' ? 'active' : ''}`} onClick={() => setTab('openpaw')}>Open Paw</button>
      </div>
      <pre className="snippet">{snippets[tab]}</pre>
      {tab !== 'openpaw' && (
        <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => copy('snippet', snippets[tab])}>{copied === 'snippet' ? 'Copied!' : 'Copy snippet'}</button>
        </div>
      )}
    </section>
  );
}

const STATE_PILL: Record<string, string> = {
  ready: 'pill-ready',
  starting: 'pill-starting',
  errored: 'pill-errored',
  stopped: 'pill-stopped',
};

function ServerRow({ s, onChange }: { s: ServerStatus; onChange: () => void }) {
  const [logs, setLogs] = useState<string[] | null>(null);
  const [showTools, setShowTools] = useState(false);
  const busy = s.state === 'starting';
  const act = async (action: 'start' | 'stop' | 'restart') => {
    await api.action(s.id, action).catch(() => {});
    onChange();
  };
  const toggleLogs = async () => {
    if (logs) return setLogs(null);
    setLogs((await api.logs(s.id).catch(() => ({ logs: [] }))).logs);
  };
  return (
    <div className="card server-card">
      <div className="row between">
        <div className="row">
          <span className={`pill ${STATE_PILL[s.state] ?? 'pill-stopped'}`}>
            <span className="dot" />
            {s.state}
          </span>
          <span className="server-name">{s.name}</span>
          <span className="chip">{s.runtime === 'docker' ? '🐳 docker' : '⚡ process'}</span>
          {s.state === 'ready' && (
            <button className="btn btn-ghost small" style={{ padding: '2px 8px' }} onClick={() => setShowTools(!showTools)}>
              {s.tools.length} tools {showTools ? '▾' : '▸'}
            </button>
          )}
          {s.restarts > 0 && <span className="chip">{s.restarts} restarts</span>}
        </div>
        <div className="row">
          {s.state === 'ready' ? (
            <button className="btn" onClick={() => void act('stop')}>Stop</button>
          ) : (
            <button className="btn btn-primary" onClick={() => void act('start')} disabled={busy}>{busy ? 'Starting…' : 'Start'}</button>
          )}
          <button className="btn" onClick={() => void act('restart')}>Restart</button>
          <button className="btn" onClick={() => void toggleLogs()}>Logs</button>
          <button className="btn btn-danger" onClick={() => { void api.remove(s.id).then(onChange); }}>Remove</button>
        </div>
      </div>
      {s.error && <p className="small" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>{s.error}</p>}
      {showTools && s.tools.length > 0 && (
        <div className="tool-chips">
          {s.tools.map((t) => <span key={t} className="chip mono">{s.id}__{t}</span>)}
        </div>
      )}
      {logs && <pre className="logs">{logs.join('\n') || '(no output yet)'}</pre>}
    </div>
  );
}

function AddServer({ entry, onClose, onAdded }: { entry: RegistryEntry | null; onClose: () => void; onAdded: () => void }) {
  const [runtime, setRuntime] = useState<RuntimeKind>(entry?.runtime ?? 'process');
  const [name, setName] = useState(entry?.name ?? '');
  const [command, setCommand] = useState(entry?.command ?? '');
  const [args, setArgs] = useState((entry?.args ?? []).join(' '));
  const [env, setEnv] = useState((entry?.requires ?? []).map((k) => `${k}=`).join('\n'));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    const id = (entry?.id ?? (name || command)).replace(/[^a-z0-9-]/gi, '-').toLowerCase() + (entry ? '' : `-${Date.now() % 1000}`);
    const envObj: Record<string, string> = {};
    for (const line of env.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0 && line.slice(i + 1).trim()) envObj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const cfg: ManagedServerConfig = {
      id,
      name: name || entry?.name || command,
      runtime,
      command,
      args: args.trim() ? args.trim().split(/\s+/) : [],
      env: Object.keys(envObj).length ? envObj : undefined,
      image: entry?.image,
      enabled: true,
    };
    try {
      await api.add(cfg);
      onAdded();
    } catch (e) {
      setErr(e instanceof Error && e.message === '409' ? 'A server with that id already exists.' : 'Could not add the server, check the daemon logs.');
    }
    setBusy(false);
  };

  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div className="row between">
        <b>{entry ? `Add ${entry.name}` : 'Add a custom server'}</b>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>
      {entry && <p className="small muted" style={{ margin: '6px 0 0' }}>{entry.description}</p>}

      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap', gap: 14 }}>
        <label className="field">
          Isolation
          <div className="seg">
            <button className={runtime === 'process' ? 'active' : ''} onClick={() => setRuntime('process')} title="Sandboxed child process — zero dependencies, lightest">⚡ Process sandbox</button>
            <button className={runtime === 'docker' ? 'active' : ''} onClick={() => setRuntime('docker')} title="Container per server — strongest isolation, needs Docker">🐳 Docker</button>
          </div>
        </label>
        <label className="field" style={{ flex: 1, minWidth: 140 }}>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={entry?.name ?? 'my-server'} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 12, flexWrap: 'wrap', gap: 14 }}>
        <label className="field" style={{ minWidth: 140 }}>
          Command
          <input className="mono" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
        </label>
        <label className="field" style={{ flex: 1, minWidth: 220 }}>
          Arguments
          <input className="mono" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-y @modelcontextprotocol/server-filesystem ." />
        </label>
      </div>
      <label className="field" style={{ marginTop: 12 }}>
        Environment &amp; secrets (one KEY=value per line, never logged)
        <textarea value={env} onChange={(e) => setEnv(e.target.value)} rows={Math.max(2, env.split('\n').length)} />
      </label>
      <div className="row between" style={{ marginTop: 14 }}>
        <span className="small" style={{ color: 'var(--danger)' }}>{err}</span>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={!command || busy}>{busy ? 'Adding…' : 'Add & start'}</button>
      </div>
    </section>
  );
}
