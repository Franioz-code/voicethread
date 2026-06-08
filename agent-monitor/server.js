// ============================================================================
//  Agent Monitor — live visualization of Claude Code multi-agent teams.
// ----------------------------------------------------------------------------
//  Data sources (both optional, best-effort):
//   1) Claude Code HOOKS -> POST /event   (live: subagent start/stop, tools,
//      session/turn markers).  Wired via .claude/settings.local.json + hook.mjs.
//   2) Completed WORKFLOW result files (.output) -> parsed into a team graph
//      (nodes = agents, edges = delegate/consult), auto-ingested on startup and
//      on demand via POST /ingest.  This is where the rich "who-consults-whom"
//      graph comes from (hooks don't expose consult edges).
//  The browser dashboard connects over WebSocket and renders the graph live.
// ============================================================================

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4500;
// Where Claude Code writes background-task output (workflow results live here).
const SCAN_DIR = process.env.CC_TASKS_DIR || path.join(os.tmpdir(), 'claude');

// ---------------------------------------------------------------------------
//  State model: runs -> nodes (agents) + edges (delegate/consult) + log.
// ---------------------------------------------------------------------------
const state = { runs: {}, nodes: {}, edges: [], log: [] };
const nkey = (runId, id) => `${runId}::${id}`;
const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 8);

function pushLog(msg) {
  state.log.push({ ts: Date.now(), msg: String(msg).slice(0, 300) });
  if (state.log.length > 600) state.log.shift();
}

function ensureNode(runId, id, extra = {}) {
  const k = nkey(runId, id);
  if (!state.nodes[k]) state.nodes[k] = { key: k, runId, id, label: id, team: '?', role: id, status: 'queued' };
  const n = state.nodes[k];
  if (extra.team) n.team = extra.team;
  if (extra.role) { n.role = extra.role; n.label = extra.role; }
  if (extra.status) n.status = extra.status;
  return n;
}

function hasEdge(runId, from, to, kind) {
  return state.edges.some((e) => e.runId === runId && e.from === nkey(runId, from) && e.to === nkey(runId, to) && e.kind === kind);
}

function applyEvent(ev) {
  if (!ev || typeof ev !== 'object') return;
  switch (ev.type) {
    case 'run_start':
      state.runs[ev.runId] = { id: ev.runId, name: ev.name || ev.runId, phase: '', status: 'running' };
      pushLog(`▶ run: ${ev.name || ev.runId}`);
      break;
    case 'phase':
      if (state.runs[ev.runId]) state.runs[ev.runId].phase = ev.phase || '';
      pushLog(`phase → ${ev.phase}`);
      break;
    case 'node':
      ensureNode(ev.runId, ev.id, { team: ev.team, role: ev.role || ev.id, status: ev.status });
      break;
    case 'edge':
      ensureNode(ev.runId, ev.from);
      ensureNode(ev.runId, ev.to);
      if (!hasEdge(ev.runId, ev.from, ev.to, ev.kind || 'delegate')) {
        state.edges.push({ runId: ev.runId, from: nkey(ev.runId, ev.from), to: nkey(ev.runId, ev.to), kind: ev.kind || 'delegate' });
      }
      break;
    case 'run_end':
      if (state.runs[ev.runId]) state.runs[ev.runId].status = ev.status || 'done';
      pushLog(`■ run end: ${(state.runs[ev.runId] || {}).name || ev.runId} (${ev.status || 'done'})`);
      break;
    case 'subagent':
      ensureNode(ev.runId || 'cc-session', ev.id, { team: ev.team || 'CC subagents', role: ev.role || ev.id, status: ev.status });
      break;
    case 'tool':
      pushLog(`⚙ ${ev.tool || 'tool'}`);
      break;
    case 'log':
    default:
      if (ev.msg) pushLog(ev.msg);
      break;
  }
}

// ---------------------------------------------------------------------------
//  Normalize a raw Claude Code hook payload into our events.
// ---------------------------------------------------------------------------
function fromHook(h) {
  const sid = h.session_id || 'cc-session';
  const runId = `sess_${hash(sid)}`;
  const name = h.hook_event_name;
  switch (name) {
    case 'SessionStart': return [{ type: 'run_start', runId, name: 'Claude Code session' }];
    case 'SessionEnd': return [{ type: 'run_end', runId, status: 'done' }];
    case 'SubagentStart': return [{ type: 'subagent', runId, id: h.agent_id || `a_${hash(JSON.stringify(h))}`, role: h.agent_type || 'subagent', team: 'CC subagents', status: 'running' }];
    case 'SubagentStop': return [{ type: 'subagent', runId, id: h.agent_id || `a_${hash(JSON.stringify(h))}`, role: h.agent_type || 'subagent', team: 'CC subagents', status: h.status === 'failed' ? 'failed' : 'done' }];
    case 'PostToolUse': return [{ type: 'tool', tool: h.tool_name }];
    case 'Stop': return [{ type: 'log', msg: '⏹ turn end' }];
    case 'Notification': return [{ type: 'log', msg: `🔔 ${h.notification_type || h.message || 'notification'}` }];
    default: return [{ type: 'log', msg: name || 'hook' }];
  }
}

// ---------------------------------------------------------------------------
//  Parse a completed workflow result (.output JSON) into a team graph.
//  Handles both shapes: orchestrator/brand ({spec,results,...}) and
//  dev-team ({lanes,...}); edges come from the logs[] our scripts emit.
// ---------------------------------------------------------------------------
function ingestResult(data, srcName) {
  const res = data.result || data;
  const name = shortName(data.summary || data.meta?.name || path.basename(srcName));
  const runId = `wf_${hash(srcName)}`;
  applyEvent({ type: 'run_start', runId, name });

  // nodes from results[].agent or lanes[].lane
  const agents = new Set();
  if (Array.isArray(res.results)) res.results.forEach((r) => r && r.agent && agents.add(r.agent));
  if (Array.isArray(res.lanes)) res.lanes.forEach((l) => l && l.lane && agents.add(normLane(l.lane)));
  if (res.spec && Array.isArray(res.spec.activeAgents)) res.spec.activeAgents.forEach((a) => agents.add(a));
  agents.add('lead');
  for (const a of agents) applyEvent({ type: 'node', runId, id: a, team: name, role: a, status: 'done' });

  // edges + phases from the logs our workflows emit
  const logs = [].concat(data.logs || [], res.logs || []);
  for (const line of logs) parseLogLine(runId, name, String(line));

  // reviewer / CI verdict
  const review = res.finalReview || res.review;
  const ci = res.finalCI || res.verify;
  if (review) pushLog(`[${name}] review: ${typeof review === 'string' ? review.slice(0, 80) : (review.verdict || '')}`);
  if (ci) pushLog(`[${name}] CI: ${typeof ci === 'string' ? ci.slice(0, 80) : ('tests=' + ci.testsPass + ' bundle=' + ci.bundlePass)}`);

  applyEvent({ type: 'run_end', runId, status: res.passed === false ? 'failed' : 'done' });
}

const normLane = (s) => String(s).toLowerCase().split(/[\s/(]/)[0]; // "QA / Test Engineer" -> "qa"
function shortName(s) { s = String(s); return s.length > 60 ? s.slice(0, 57) + '…' : s; }

function parseLogLine(runId, team, line) {
  let m;
  // "Plan: ux -> qa -> security"  => lead delegates to each
  if ((m = /Plan:\s*(.+)/i.exec(line))) {
    const chain = m[1].split(/->|→/).map((s) => s.trim().split(' ')[0]).filter((x) => x && x !== '(none)' && x !== '(empty)');
    for (const a of chain) { applyEvent({ type: 'node', runId, id: a, team, role: a, status: 'done' }); applyEvent({ type: 'edge', runId, from: 'lead', to: a, kind: 'delegate' }); }
  }
  // "ux consults: features, voice"  => consult edges
  if ((m = /([A-Za-z][\w-]*)\s+consults?:\s*(.+)/i.exec(line))) {
    const from = m[1];
    m[2].split(',').map((s) => s.trim().split(' ')[0]).filter(Boolean).forEach((to) => applyEvent({ type: 'edge', runId, from, to, kind: 'consult' }));
  }
  // "Team finished lanes: Security Engineer, QA / Test Engineer, ..." (dev-team)
  if ((m = /finished lanes?:\s*(.+)/i.exec(line))) {
    m[1].split(',').map((s) => normLane(s.trim())).filter(Boolean).forEach((a) => { applyEvent({ type: 'node', runId, id: a, team, role: a, status: 'done' }); applyEvent({ type: 'edge', runId, from: 'lead', to: a, kind: 'delegate' }); });
  }
  // "Round 1: routing fixes to ux, qa"
  if ((m = /routing fixes to\s*(.+)/i.exec(line))) {
    m[1].split(',').map((s) => s.trim().split(' ')[0]).filter((x) => x && x !== '(none)').forEach((to) => applyEvent({ type: 'edge', runId, from: 'lead', to, kind: 'fix' }));
  }
  pushLog(`[${team}] ${line}`.slice(0, 200));
}

// Best-effort recursive scan for workflow result files under SCAN_DIR.
function autoIngest() {
  let count = 0;
  const walk = (dir, depth) => {
    if (depth > 6 || count > 40) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && e.name.endsWith('.output')) {
        try {
          const raw = fs.readFileSync(full, 'utf8').trim();
          if (!raw.startsWith('{')) continue;
          const data = JSON.parse(raw);
          const res = data.result || data;
          if (res && (Array.isArray(res.results) || Array.isArray(res.lanes) || res.spec)) { ingestResult(data, full); count++; }
        } catch { /* skip non-JSON / partial */ }
      }
    }
  };
  try { walk(SCAN_DIR, 0); } catch {}
  pushLog(`auto-ingested ${count} workflow run(s) from disk`);
  return count;
}

// ---------------------------------------------------------------------------
//  HTTP + WebSocket
// ---------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '4mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast() {
  const msg = JSON.stringify({ type: 'state', state });
  for (const c of wss.clients) { if (c.readyState === 1) { try { c.send(msg); } catch {} } }
}

app.post('/event', (req, res) => {
  const body = req.body || {};
  const events = body.hook_event_name ? fromHook(body) : [body];
  for (const ev of events) applyEvent(ev);
  broadcast();
  res.json({ ok: true });
});

app.post('/ingest', (req, res) => {
  try {
    const file = (req.query.file || req.body.file || '').toString();
    if (file) { ingestResult(JSON.parse(fs.readFileSync(file, 'utf8')), file); }
    else { autoIngest(); }
    broadcast();
    res.json({ ok: true, runs: Object.keys(state.runs).length });
  } catch (e) { res.status(400).json({ error: String(e && e.message || e) }); }
});

app.get('/api/state', (req, res) => res.json(state));
app.post('/api/reset', (req, res) => { state.runs = {}; state.nodes = {}; state.edges = []; state.log = []; broadcast(); res.json({ ok: true }); });
app.use(express.static(path.join(__dirname, 'public')));

wss.on('connection', (ws) => { try { ws.send(JSON.stringify({ type: 'state', state })); } catch {} });

server.listen(PORT, () => {
  console.log(`\n  Agent Monitor → http://localhost:${PORT}`);
  console.log(`  Scanning for workflow runs under: ${SCAN_DIR}`);
  const n = autoIngest();
  console.log(`  Loaded ${n} past run(s). Hooks POST to /event for live updates.\n`);
});
