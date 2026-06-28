// Run the daemon + web UI together. Dependency-free; prefixes output; Ctrl-C
// tears both down. Distinct: `npm run dev:daemon` / `npm run dev:web`.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  { name: 'daemon', color: '\x1b[35m', args: ['run', 'dev:daemon'] },
  { name: 'web', color: '\x1b[36m', args: ['run', 'dev:web'] },
];
const reset = '\x1b[0m';
const children = [];
for (const p of procs) {
  const child = spawn(npm, p.args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });
  const tag = `${p.color}[${p.name}]${reset} `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) out.write(`${tag}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited (${code})\n`);
    shutdown();
  });
  children.push(child);
}
let down = false;
function shutdown() {
  if (down) return;
  down = true;
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* gone */
    }
  }
  setTimeout(() => process.exit(0), 200);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
