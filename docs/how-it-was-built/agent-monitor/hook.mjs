// Claude Code hook forwarder. Wired in .claude/settings.local.json as a
// `command` hook: it reads the hook's JSON payload on stdin and POSTs it to the
// local agent-monitor. ALWAYS exits 0 and never blocks Claude Code (short
// timeout, all errors swallowed) — so the monitor being down can't affect CC.

let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { data += c; });
process.stdin.on('end', send);
process.stdin.on('error', () => process.exit(0));
// Safety nets: never hang.
setTimeout(send, 1500);
setTimeout(() => process.exit(0), 2500);

let sent = false;
async function send() {
  if (sent) return;
  sent = true;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1000);
    await fetch('http://localhost:4500/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data && data.trim() ? data : '{}',
      signal: ctrl.signal,
    }).catch(() => {});
    clearTimeout(t);
  } catch {}
  process.exit(0);
}
