# Agent Monitor — live view of the Claude Code agent teams

A small local dashboard that visualizes the multi-agent runs (orchestrator,
dev-team, brand-redesign…): **agents as nodes, teams as colors, delegate/consult
edges, live status**, plus an event log. It's an **observer/monitor** (it reads
what Claude Code exposes) — not an emulator that controls Claude Code.

## Run it
```bash
cd agent-monitor
npm install
npm start
```
Open **http://localhost:4500**. On start it auto-loads any completed workflow
runs it finds on disk (so you immediately see real team graphs). Click **Reload
runs** to re-scan, **Clear** to reset.

## Where the data comes from
1. **Completed workflow results** (`*.output` under your OS temp `claude/` dir) →
   parsed into a team graph (nodes + delegate/consult/fix edges) from the
   `log()` lines our workflows emit (`Plan: a -> b`, `x consults: y`, `Round N…`).
   This is the rich "who-consults-whom" graph. Override the scan dir with
   `CC_TASKS_DIR=<path> npm start`.
2. **Live Claude Code hooks** → `POST /event`. Wire them once (see below) and the
   monitor shows subagents/tools/sessions **as they happen**.

## Wire live hooks (optional, one-time)
Already added to `.claude/settings.local.json` in this repo:
```json
{
  "hooks": {
    "SubagentStart":[{"hooks":[{"type":"command","command":"node \"C:/Users/frani/Uczelnia/SMS/agent-monitor/hook.mjs\""}]}],
    "SubagentStop": [{"hooks":[{"type":"command","command":"node \"C:/Users/frani/Uczelnia/SMS/agent-monitor/hook.mjs\""}]}],
    "PostToolUse":  [{"hooks":[{"type":"command","command":"node \"C:/Users/frani/Uczelnia/SMS/agent-monitor/hook.mjs\""}]}],
    "SessionStart": [{"hooks":[{"type":"command","command":"node \"C:/Users/frani/Uczelnia/SMS/agent-monitor/hook.mjs\""}]}],
    "Stop":         [{"hooks":[{"type":"command","command":"node \"C:/Users/frani/Uczelnia/SMS/agent-monitor/hook.mjs\""}]}]
  }
}
```
`hook.mjs` forwards the hook payload to the monitor and **always exits 0** with a
1s timeout — if the monitor is down it can't affect Claude Code. (Hooks reload
when you restart the Claude Code session.)

## Honest limits
- Claude Code has **no live in-memory agent-graph API**; we reconstruct it from
  hooks (live, generic) + parsed run results (rich team graph, on completion).
- Consult edges between *workflow* agents come from the result parse (post-run);
  hooks give live agent/tool heartbeats during a session.
- It's read-only observability — you can't drive agents from the dashboard.

## API
- `POST /event` — accepts a CC hook payload (auto-detected) or a raw event.
- `POST /ingest?file=<path>` — ingest a specific workflow `.output`; no file = re-scan.
- `GET /api/state` — current graph state. `POST /api/reset` — clear.
- WebSocket `/ws` — pushes full state to the dashboard.
