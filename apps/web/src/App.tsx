import { useEffect, useState, useCallback } from 'react';
import type {
  ServerStatus,
  RegistryEntry,
  GatewayInfo,
  ManagedServerConfig,
  RuntimeKind,
  AnalyticsSummary,
} from '@nekko-mcp/shared';
import { api } from './api';

type View = 'servers' | 'analytics';
type Theme = 'light' | 'medium' | 'dark';

function useCopy(): [string | null, (key: string, text: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((key: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  }, []);
  return [copied, copy];
}

const fmtNum = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${n}`);
const fmtBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const fmtRel = (iso?: string): string => {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};
const fmtClock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour12: false });

export function App() {
  const [view, setView] = useState<View>('servers');
  const [servers, setServers] = useState<ServerStatus[] | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [stats, setStats] = useState<AnalyticsSummary | null>(null);
  const [offline, setOffline] = useState(false);
  const [adding, setAdding] = useState<RegistryEntry | 'custom' | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api.servers(), api.analytics().catch(() => null)]);
      setServers(s);
      if (a) setStats(a);
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
          <span className="chip">v0.3</span>
          <nav className="nav">
            <button className={view === 'servers' ? 'active' : ''} onClick={() => setView('servers')}>Servers</button>
            <button className={view === 'analytics' ? 'active' : ''} onClick={() => setView('analytics')}>
              Analytics{stats && stats.totalCalls > 0 && <span className="n-badge">{fmtNum(stats.totalCalls)}</span>}
            </button>
          </nav>
          <div className="spacer" />
          <ThemeSwitch />
          <span className={`pill ${offline ? 'pill-errored' : 'pill-ready'}`}>
            <span className="dot" />
            {offline ? 'daemon offline' : 'daemon up'}
          </span>
          <a className="small muted" href="https://github.com/nekko-labs/nekko-mcp" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </header>

      <div className="wrap">
        {offline && (
          <div className="banner">
            <b>Can't reach the daemon.</b>{' '}
            <span className="muted">Start it with <code>npm run daemon</code> (or <code>npm run dev</code>) — this page reconnects automatically.</span>
          </div>
        )}

        {view === 'servers' ? (
          <>
            <div className="pagehead">
              <div>
                <h1>Every MCP server. <span className="grad-text">One endpoint.</span></h1>
                <p>Run servers in sandboxed processes or Docker, supervise them, and connect any agent through a single gateway URL — with full local visibility into every call.</p>
              </div>
              <div className="summary">
                <b>{servers?.length ?? '–'}</b> servers<span className="sep">·</span>
                <b>{running}</b> running<span className="sep">·</span>
                <b>{tools}</b> tools
              </div>
            </div>

            {gateway && <GatewayBar gateway={gateway} />}

            <div className="section-title">
              Active servers
              <span className="rt">
                <button className="btn sm" onClick={() => { setShowCatalog((v) => !v); setAdding(null); }}>
                  {showCatalog ? 'Close' : '+ Add server'}
                </button>
              </span>
            </div>

            {servers && servers.length === 0 && !showCatalog ? (
              <div className="panel"><div className="empty">
                <div className="cat">🐈</div>
                <b>No servers yet.</b>
                <div className="small" style={{ marginTop: 4 }}>Add one — its tools join the gateway instantly.</div>
                <div style={{ marginTop: 14 }}><button className="btn btn-primary" onClick={() => setShowCatalog(true)}>+ Add your first server</button></div>
              </div></div>
            ) : servers && servers.length > 0 ? (
              <div className="panel"><div className="list">
                {servers.map((s) => <ServerRow key={s.id} s={s} onChange={refresh} />)}
              </div></div>
            ) : null}

            {showCatalog && (
              <>
                <div className="section-title" style={{ marginTop: 22 }}>Add from catalog</div>
                <div className="panel"><div className="list">
                  {registry.map((e) => (
                    <div key={e.id} className="list-row">
                      <div className="row between wrap-gap">
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div className="row" style={{ gap: 8 }}>
                            <span className="server-name">{e.name}</span>
                            <span className="chip">{e.runtime === 'docker' ? '🐳 docker' : '⚡ process'}</span>
                            {(e.requires ?? []).map((r) => <span key={r} className="chip mono">{r}</span>)}
                          </div>
                          <div className="small muted" style={{ marginTop: 3 }}>{e.description}</div>
                        </div>
                        <div className="row">
                          {e.homepage && <a className="small muted" href={e.homepage} target="_blank" rel="noreferrer">docs</a>}
                          <button className="btn" onClick={() => setAdding(e)}>+ Add</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="list-row">
                    <div className="row between wrap-gap">
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <span className="server-name">Custom server</span>
                        <div className="small muted" style={{ marginTop: 3 }}>Any stdio MCP server, by command (process sandbox) or image (Docker).</div>
                      </div>
                      <button className="btn btn-primary" onClick={() => setAdding('custom')}>+ Configure</button>
                    </div>
                  </div>
                </div></div>
              </>
            )}

            {adding && (
              <AddServer
                entry={adding === 'custom' ? null : adding}
                onClose={() => setAdding(null)}
                onAdded={() => { setAdding(null); setShowCatalog(false); void refresh(); }}
              />
            )}
          </>
        ) : (
          <AnalyticsView stats={stats} />
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

function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.getAttribute('data-theme') as Theme) || 'medium');
  const set = (t: Theme) => {
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('nekko-theme', t); } catch { /* ignore */ }
  };
  const opts: [Theme, string, string][] = [['light', '☀', 'Light'], ['medium', '◐', 'Medium'], ['dark', '☾', 'Dark']];
  return (
    <div className="themeswitch" role="group" aria-label="Theme">
      {opts.map(([t, icon, label]) => (
        <button key={t} className={theme === t ? 'active' : ''} title={label} aria-label={label} onClick={() => set(t)}>{icon}</button>
      ))}
    </div>
  );
}

function GatewayBar({ gateway }: { gateway: GatewayInfo }) {
  const [copied, copy] = useCopy();
  const [showToken, setShowToken] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'claude' | 'json' | 'stdio' | 'openpaw'>('claude');
  const token = gateway.token ?? '';
  const snippets: Record<string, string> = {
    claude: `claude mcp add -t http nekko-mcp ${gateway.url} -H "Authorization: Bearer ${token}"`,
    json: JSON.stringify(gateway.clientSnippet, null, 2),
    stdio: JSON.stringify(gateway.stdioSnippet ?? { mcpServers: { 'nekko-mcp': { command: 'nekko-mcpd', args: ['--stdio'] } } }, null, 2),
    openpaw: 'Open Paw auto-detects NekkoMCP.\nSettings → MCP servers → "Connect NekkoMCP gateway" — one click, done.',
  };
  return (
    <div className="gwbar">
      <div className="gwbar-row">
        <span className="glabel"><span className="dot-grad" />Gateway</span>
        <span className="url">{gateway.url}</span>
        <button className="btn sm" onClick={() => copy('url', gateway.url)}>{copied === 'url' ? 'Copied!' : 'Copy'}</button>
        <div className="spacer" style={{ flex: 1 }} />
        <span className="tok">token {showToken ? token.slice(0, 12) + '…' : '••••••'}</span>
        <button className="btn sm btn-ghost" onClick={() => setShowToken(!showToken)}>{showToken ? 'Hide' : 'Show'}</button>
        <button className="btn sm" onClick={() => copy('token', token)}>{copied === 'token' ? 'Copied!' : 'Copy'}</button>
        <button className="btn sm" onClick={() => setOpen(!open)}>Connect an agent {open ? '▴' : '▾'}</button>
      </div>
      {open && (
        <div className="connect-panel">
          <div className="tabs">
            <button className={`tab ${tab === 'claude' ? 'active' : ''}`} onClick={() => setTab('claude')}>Claude Code</button>
            <button className={`tab ${tab === 'json' ? 'active' : ''}`} onClick={() => setTab('json')}>.mcp.json</button>
            <button className={`tab ${tab === 'stdio' ? 'active' : ''}`} onClick={() => setTab('stdio')}>stdio</button>
            <button className={`tab ${tab === 'openpaw' ? 'active' : ''}`} onClick={() => setTab('openpaw')}>Open Paw</button>
          </div>
          <pre className="snippet">{snippets[tab]}</pre>
          {tab !== 'openpaw' && (
            <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
              <button className="btn sm" onClick={() => copy('snippet', snippets[tab])}>{copied === 'snippet' ? 'Copied!' : 'Copy snippet'}</button>
            </div>
          )}
        </div>
      )}
    </div>
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
    <div className="list-row">
      <div className="list-head between">
        <div className="row wrap-gap">
          <span className={`pill ${STATE_PILL[s.state] ?? 'pill-stopped'}`}><span className="dot" />{s.state}</span>
          <span className="server-name">{s.name}</span>
          <span className="chip">{s.runtime === 'docker' ? '🐳 docker' : '⚡ process'}</span>
          {s.state === 'ready' && (
            <button className="link-btn" onClick={() => setShowTools(!showTools)}>{s.tools.length} tools {showTools ? '▾' : '▸'}</button>
          )}
          {s.restarts > 0 && <span className="chip">{s.restarts} restarts</span>}
        </div>
        <div className="row">
          {s.state === 'ready' ? (
            <button className="btn sm" onClick={() => void act('stop')}>Stop</button>
          ) : (
            <button className="btn sm btn-primary" onClick={() => void act('start')} disabled={busy}>{busy ? 'Starting…' : 'Start'}</button>
          )}
          <button className="btn sm" onClick={() => void act('restart')}>Restart</button>
          <button className="btn sm" onClick={() => void toggleLogs()}>Logs</button>
          <button className="btn sm btn-danger" onClick={() => { void api.remove(s.id).then(onChange); }}>Remove</button>
        </div>
      </div>
      {s.error && <p className="small" style={{ color: 'var(--danger)', margin: '8px 0 0' }}>{s.error}</p>}
      {showTools && s.tools.length > 0 && (
        <div className="tool-chips">{s.tools.map((t) => <span key={t} className="chip mono">{s.id}__{t}</span>)}</div>
      )}
      {logs && <pre className="logs">{logs.join('\n') || '(no output yet)'}</pre>}
    </div>
  );
}

function AnalyticsView({ stats }: { stats: AnalyticsSummary | null }) {
  const hasData = !!stats && stats.totalCalls > 0;
  const successRate = stats && stats.totalCalls > 0 ? Math.round(((stats.totalCalls - stats.totalErrors) / stats.totalCalls) * 100) : 100;
  const maxSeries = stats ? Math.max(1, ...stats.series.map((b) => b.calls)) : 1;
  const maxServer = stats ? Math.max(1, ...stats.servers.map((s) => s.calls)) : 1;
  const maxClient = stats ? Math.max(1, ...stats.clients.map((c) => c.calls)) : 1;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1><span className="grad-text">Analytics</span> &amp; visibility</h1>
          <p>Every tool call routed through the gateway, counted here — which server, which client, how much data. Local-first: nothing leaves your machine.</p>
        </div>
        {stats && <div className="summary">since <b>{fmtRel(stats.since)}</b></div>}
      </div>

      <div className="callout">
        <span className="ic">🔎</span>
        <div>
          <div className="t">Why route through NekkoMCP? You get an audit trail for free.</div>
          <div className="d">Point agents at one gateway and NekkoMCP records every call — per server, per client, per byte — so you can see exactly what your tools are doing. No dashboards to wire up, no data leaving localhost.</div>
        </div>
      </div>

      <div className="metricbar">
        <div className="metric accent"><div className="m-val">{fmtNum(stats?.totalCalls ?? 0)}</div><div className="m-label">tool calls</div></div>
        <div className="metric"><div className="m-val">{successRate}<span className="u">%</span></div><div className="m-label">success rate</div></div>
        <div className="metric"><div className="m-val">{stats?.clients.length ?? 0}</div><div className="m-label">clients</div></div>
        <div className="metric"><div className="m-val">{fmtBytes(stats?.bytesIn ?? 0)}</div><div className="m-label">data in</div></div>
        <div className="metric"><div className="m-val">{fmtBytes(stats?.bytesOut ?? 0)}</div><div className="m-label">data out</div></div>
      </div>

      {hasData ? (
        <>
          <div className="spark-wrap">
            <div className="small muted" style={{ marginBottom: 2 }}>Calls · last 24h</div>
            <div className="spark">
              {stats!.series.map((b, i) => (
                <div
                  key={i}
                  className={`spark-bar ${b.calls === 0 ? 'empty' : ''}`}
                  style={{ height: `${Math.max(4, (b.calls / maxSeries) * 100)}%` }}
                  title={`${new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — ${b.calls} calls`}
                />
              ))}
            </div>
            <div className="spark-axis"><span>24h ago</span><span>now</span></div>
          </div>

          <div className="section-title" style={{ marginTop: 24 }}>Usage by server</div>
          <div className="panel"><div className="list">
            {stats!.servers.map((s) => (
              <div key={s.serverId} className="list-row">
                <div className="row between wrap-gap">
                  <div><span className="server-name">{s.name}</span> <span className="small muted">{s.serverId}</span></div>
                  <div className="u-metrics">
                    <span><b>{fmtNum(s.calls)}</b> calls</span>
                    <span><b>{s.avgMs}</b>ms avg</span>
                    <span style={{ color: s.errors ? 'var(--danger)' : undefined }}><b>{s.errors}</b> err</span>
                    <span><b>{fmtBytes(s.bytesIn)}</b> in</span>
                    <span><b>{fmtBytes(s.bytesOut)}</b> out</span>
                  </div>
                </div>
                <div className="bar-track" style={{ marginTop: 9 }}><div className="bar-fill" style={{ width: `${(s.calls / maxServer) * 100}%` }} /></div>
                <div className="u-sub">
                  {s.tools.slice(0, 6).map((t) => <span key={t.tool} className="chip mono">{t.tool} ·{t.calls}</span>)}
                  <span style={{ marginLeft: 'auto' }}>{s.clients.length} client{s.clients.length === 1 ? '' : 's'} · last {fmtRel(s.lastUsed)}</span>
                </div>
              </div>
            ))}
          </div></div>

          <div className="section-title" style={{ marginTop: 24 }}>Who's calling</div>
          <div className="panel"><div className="list">
            {stats!.clients.map((c) => (
              <div key={c.client} className="list-row">
                <div className="row between wrap-gap">
                  <div className="server-name">{c.client}</div>
                  <div className="u-metrics">
                    <span><b>{fmtNum(c.calls)}</b> calls</span>
                    <span><b>{fmtBytes(c.bytesIn + c.bytesOut)}</b> data</span>
                    <span className="muted">{fmtRel(c.lastUsed)}</span>
                  </div>
                </div>
                <div className="bar-track" style={{ marginTop: 9 }}><div className="bar-fill" style={{ width: `${(c.calls / maxClient) * 100}%` }} /></div>
              </div>
            ))}
          </div></div>

          <div className="section-title" style={{ marginTop: 24 }}>Recent calls</div>
          <div className="panel"><div className="feed">
            {stats!.recent.map((e, i) => (
              <div key={i} className="feed-row">
                <span className="f-time">{fmtClock(e.at)}</span>
                <span className="f-call">{e.serverId}__{e.tool} <span className="f-client">· {e.client}</span></span>
                <span className="f-meta">
                  <span className={`ok-dot ${e.ok ? 'ok' : 'err'}`} title={e.ok ? 'ok' : e.error} />
                  {e.ms}ms · {fmtBytes(e.bytesIn + e.bytesOut)}
                </span>
              </div>
            ))}
          </div></div>
        </>
      ) : (
        <div className="panel" style={{ marginTop: 12 }}><div className="empty">
          <div className="cat">📡</div>
          <b>No calls yet.</b>
          <div className="small" style={{ marginTop: 4, maxWidth: 380, marginInline: 'auto' }}>
            Connect an agent to the gateway and start a server. Every tool call it makes will appear here — with the caller, latency, and data volume.
          </div>
        </div></div>
      )}
    </>
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
    <section className="panel" style={{ marginTop: 14, padding: 18 }}>
      <div className="row between">
        <b>{entry ? `Add ${entry.name}` : 'Add a custom server'}</b>
        <button className="btn sm btn-ghost" onClick={onClose}>✕</button>
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
