# VoiceThread — agent "dream team" (orchestrator-led)

This project is built by a **bench of specialized agents** coordinated by a
**main orchestrator (Tech Lead)**. The design follows researched best practices
for multi-agent systems (sources at the bottom).

## Methods we apply (the operating manual)

Every agent receives a shared **operating manual**; the orchestrator enforces the
process:

1. **Spec-first** — before any code, the Lead writes **acceptance criteria** (testable
   "done") and **non-goals** (scope guard). Work is judged against them (end-state eval).
2. **Scale effort to complexity** — the Lead activates **only the agents needed**
   (trivial→1, standard→2–3, complex→4–5). The roster is the *bench*; not everyone plays
   every task. Coordination overhead is real.
3. **Clear delegation** — each task has an objective, boundaries and *what NOT to touch*,
   so agents never duplicate or collide.
4. **Least privilege / disjoint ownership** — an agent edits **only** the files its role
   owns; two agents never touch the same file in a run.
5. **Consult, don't guess** — agents are aware of each other (shared roster) and request a
   teammate's input via `requests:[{to,ask}]`; the **orchestrator routes** it (hub-and-spoke).
6. **Evaluator–optimizer loop** — after work: **CI** (tests + bundle) + an **adversarial
   reviewer** judge against a rubric; blockers are **routed back to the owning agent** and
   **re-verified** (bounded to 2 rounds — a stopping condition).
7. **Read before write, small diffs, preserve contracts** — milestone-1 must always keep
   working and bundling.
8. **Privacy & safety by design** — emotion on-device, relay stores nothing, key
   server-side; sandboxed (workers don't install/run servers); agentic threat-modeling.
9. **Transparency** — the plan, the active team, consults and fix-rounds are logged.

## The bench (roster — source of truth: `.claude/workflows/orchestrator.js`)

| id | role | expertise | owns (edits) |
|---|---|---|---|
| **lead** | Tech Lead / Orchestrator | decomposition, delegation, integration | — (plans & routes) |
| **spec** | Product / Spec | acceptance criteria, scope, user value | `docs/` notes only |
| **architect** | Architect | system design, data flow, trade-offs | `docs/adr/` only |
| **security** | Security Engineer | relay/proxy hardening, privacy, threat modeling | `server.js`, `SECURITY.md` |
| **voice** | AI / Voice Engineer ⭐NEW | ElevenLabs TTS/STT/cloning, `eleven_v3` emotion tags, latency/cost | `voicethread-app/src/features/emotion/**` |
| **features** | Features Engineer | app + relay features, React Native | `src/api/**`, `src/features/chat/**`, app deps |
| **ux** | UX/UI + Accessibility | screens, design system, eyes-free/driving | `App.js`, `src/theme.js`, `UX.md` |
| **qa** | QA / Test Engineer | automated tests, evals, verification | `tests/**`, root `package.json` scripts |
| **reviewer** | Adversarial Reviewer | correctness, regressions, security, rubric judging | — (read-only gate) |

⭐ Added vs. the previous team: **spec**, **architect**, **voice**. (`voice` is key — this is an
ElevenLabs showcase, so a dedicated TTS/STT/emotion specialist owns that surface.)

## How a run works

1. **Spec & Route** — Lead reads the goal + repo → acceptance criteria, non-goals,
   complexity, the **active subset** of agents, and an ordered plan (each step has its own
   acceptance criteria + who it may consult). Respects file ownership.
2. **Delegate** — selected specialists do their step. If blocked, they consult a teammate
   (routed by the orchestrator), then finalize.
3. **Verify & Fix** — CI + reviewer judge against the criteria; blockers go back to owners
   and the loop re-runs (≤2 rounds), then a final report.

## Why orchestrator-mediated (not peer-to-peer)

The harness blocks an agent from directly spawning/calling another (runaway protection).
So communication is **hub-and-spoke through the orchestrator** — which is also the
recommended, controllable pattern (a tech lead routing a team) and avoids chaos/file races.

## Running the team

- **Managed team (recommended):** *"odpal orkiestratora z celem: <twój cel>"* →
  `Workflow({ scriptPath: ".claude/workflows/orchestrator.js", args: "<goal>" })`.
  Scales the team to the goal, runs the full spec→delegate→verify-fix loop.
- **Quick parallel sweep:** `dev-team.js` — 4 fixed lanes in parallel + review/CI. Good for
  broad, independent cleanups when you don't need planning/loops.

Both are reusable and versioned with the project. `npm test` runs the zero-credit suite.

## Sources (researched best practices)

- [Anthropic — Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents) (patterns, simplicity, guardrails, when NOT to use agents)
- [Anthropic — How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) (orchestrator-worker delegation, effort scaling, self-assessment, evaluation)
- [Best practices for building agentic systems — InfoWorld](https://www.infoworld.com/article/4154570/best-practices-for-building-agentic-systems.html); [Agentic SDLC — Seamgen](https://www.seamgen.com/blog/agentic-software-development-life-cycle); [Multi-agent coordination 2026 — Sesame Disk](https://sesamedisk.com/multi-agent-llm-coordination-2026/) (3–4 agent teams, capability-aware routing, human-in-the-loop, threat modeling)
