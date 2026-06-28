import { useEffect, useState, useCallback } from 'react';
import type { ServerStatus, RegistryEntry, GatewayInfo, ManagedServerConfig, RuntimeKind } from '@nekko-mcp/shared';
import { api } from './api';

const STATE_COLOR: Record<string, string> = {
  ready: 'var(--success)',
  starting: 'var(--warning)',
  errored: 'var(--danger)',
  stopped: 'var(--ink-3)',
};

export function App() {
  const [servers, setServers] = useState<ServerStatus[] | null>(null);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [gateway, setGateway] = useState<GatewayInfo | null>(null);
  const [offline, setOffline] = useState(false);

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

  return (
    <div className="wrap">
      <div className="row between" style={{ marginBottom: 18 }}>
        <div className="row">
          <span style={{ fontSize: 26 }}>🐈</span>
          <h1 className="grad">NekkoMCP</h1>
          <span className="chip">runtime &amp; gateway</span>
        </div>
        <a className="muted" href="https://github.com/nekko-labs/nekko-mcp" target="_blank" rel="noreferrer">github</a>
      </div>

      {offline && (
        <div className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
          Can't reach the daemon. Start it with <span className="code">npm run daemon</span> (or <span className="code">npm run dev</span>).
        </div>
      )}

      {gateway && <GatewayCard gateway={gateway} />}

      <h3 className="muted" style={{ margin: '22px 0 10px', textTransform: 'uppercase', fontSize: 12, letterSpacing: 1 }}>
        Servers
      </h3>
      {servers && servers.length === 0 && <div className="muted">No servers yet — add one below.</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {servers?.map((s) => <ServerRow key={s.id} s={s} onChange={refresh} />)}
      </div>

      <AddServer registry={registry} onAdded={refresh} />
    </div>
  );
}

function GatewayCard({ gateway }: { gateway: GatewayInfo }) {
  const [copied, setCopied] = useState(false);
  const snippet = JSON.stringify(gateway.clientSnippet, null, 2);
  return (
    <div className="card">
      <div className="row between">
        <b>Gateway</b>
        <button
          className="btn"
          onClick={() => {
            void navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? 'Copied!' : 'Copy client config'}
        </button>
      </div>
      <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>
        One endpoint for every server. Paste this into Claude Code / Cursor:
      </p>
      <pre className="logs" style={{ maxHeight: 'none' }}>{snippet}</pre>
    </div>
  );
}

function ServerRow({ s, onChange }: { s: ServerStatus; onChange: () => void }) {
  const [logs, setLogs] = useState<string[] | null>(null);
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
    <div className="card">
      <div className="row between">
        <div className="row">
          <span className="dot" style={{ background: STATE_COLOR[s.state] ?? 'var(--ink-3)' }} title={s.state} />
          <b>{s.name}</b>
          <span className="chip">{s.runtime}</span>
          <span className="muted" style={{ fontSize: 12 }}>
            {s.state === 'ready' ? `${s.tools.length} tools` : s.state}
            {s.error ? ` · ${s.error}` : ''}
          </span>
        </div>
        <div className="row">
          {s.state === 'ready' ? (
            <button className="btn" onClick={() => void act('stop')}>Stop</button>
          ) : (
            <button className="btn btn-accent" onClick={() => void act('start')} disabled={busy}>{busy ? '…' : 'Start'}</button>
          )}
          <button className="btn" onClick={() => void act('restart')}>Restart</button>
          <button className="btn" onClick={() => void toggleLogs()}>Logs</button>
          <button className="btn btn-danger" onClick={() => { void api.remove(s.id).then(onChange); }}>Remove</button>
        </div>
      </div>
      {s.tools.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {s.tools.map((t) => <span key={t} className="chip">{t}</span>)}
        </div>
      )}
      {logs && <pre className="logs">{logs.join('\n') || '(no output)'}</pre>}
    </div>
  );
}

function AddServer({ registry, onAdded }: { registry: RegistryEntry[]; onAdded: () => void }) {
  const [pick, setPick] = useState('');
  const [runtime, setRuntime] = useState<RuntimeKind>('process');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const entry = registry.find((e) => e.id === pick);
  const choose = (id: string) => {
    setPick(id);
    const e = registry.find((x) => x.id === id);
    if (e) {
      setRuntime(e.runtime);
      setCommand(e.command);
      setArgs((e.args ?? []).join(' '));
      setEnv((e.requires ?? []).map((k) => `${k}=`).join('\n'));
    }
  };

  const submit = async () => {
    setErr(null);
    const id = (entry?.id ?? command).replace(/[^a-z0-9-]/gi, '-').toLowerCase() + (entry ? '' : `-${Date.now() % 1000}`);
    const envObj: Record<string, string> = {};
    for (const line of env.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) envObj[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    const cfg: ManagedServerConfig = {
      id,
      name: entry?.name ?? command,
      runtime,
      command,
      args: args.trim() ? args.trim().split(/\s+/) : [],
      env: Object.keys(envObj).length ? envObj : undefined,
      image: entry?.image,
      enabled: true,
    };
    try {
      await api.add(cfg);
      setPick(''); setCommand(''); setArgs(''); setEnv('');
      onAdded();
    } catch (e) {
      setErr(e instanceof Error && e.message === '409' ? 'A server with that id already exists.' : 'Could not add server.');
    }
  };

  return (
    <div className="card" style={{ marginTop: 22 }}>
      <b>Add a server</b>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
        <select value={pick} onChange={(e) => choose(e.target.value)}>
          <option value="">From catalog…</option>
          {registry.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select value={runtime} onChange={(e) => setRuntime(e.target.value as RuntimeKind)} title="Isolation">
          <option value="process">process (sandbox)</option>
          <option value="docker">docker (container)</option>
        </select>
        <input style={{ flex: 1, minWidth: 160 }} placeholder="command (e.g. npx)" value={command} onChange={(e) => setCommand(e.target.value)} />
        <input style={{ flex: 1, minWidth: 160 }} placeholder="args (space-separated)" value={args} onChange={(e) => setArgs(e.target.value)} />
      </div>
      {entry && <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>{entry.description}</p>}
      <textarea
        placeholder="env / secrets, one KEY=value per line"
        value={env}
        onChange={(e) => setEnv(e.target.value)}
        rows={env.split('\n').length + 1}
        style={{ width: '100%', marginTop: 10, background: 'var(--paper-2)', border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 10, padding: 8, fontSize: 13, fontFamily: 'ui-monospace, monospace' }}
      />
      <div className="row between" style={{ marginTop: 10 }}>
        <span style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</span>
        <button className="btn btn-accent" onClick={() => void submit()} disabled={!command}>Add &amp; start</button>
      </div>
    </div>
  );
}
