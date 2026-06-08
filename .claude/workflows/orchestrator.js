export const meta = {
  name: 'voicethread-orchestrator',
  description: 'Orchestrator-led VoiceThread "dream team". A Tech Lead writes acceptance criteria, scales effort to complexity and activates only the agents needed, delegates with clear boundaries, routes inter-agent consults (hub-and-spoke), then runs an evaluator-optimizer loop: review (rubric) + CI, route blockers back to owners, re-verify (bounded rounds).',
  phases: [
    { title: 'Spec & Route', detail: 'Lead: acceptance criteria + non-goals, complexity, agent selection, ordered plan' },
    { title: 'Delegate', detail: 'Selected specialists work to acceptance criteria; consults routed by the orchestrator' },
    { title: 'Verify & Fix', detail: 'CI + adversarial review vs rubric; blockers routed to owners; re-verify (max 2 rounds)' },
  ],
};

const REPO = 'C:/Users/frani/Uczelnia/SMS';
const MAX_FIX_ROUNDS = 2;

// The GOAL is the team's task this run. Pass via Workflow args (string). The
// default is a SAFE planning-only task so an accidental run can't change code.
const GOAL =
  (typeof args === 'string' && args.trim()) ? args.trim()
  : (args && typeof args.goal === 'string' && args.goal.trim()) ? args.goal.trim()
  : 'Review the current PoC against best practices and write a short, prioritized improvement backlog to docs/BACKLOG.md. PLANNING ONLY — do not modify any app or server code.';

// === DREAM TEAM ROSTER (the "bench"; the lead activates only who is needed) ==
// Disjoint file ownership = no two agents ever edit the same file in a run.
const TEAM = {
  lead:      { role: 'Tech Lead / Orchestrator', owns: '(plans, routes, integrates; no direct edits)', expertise: 'decomposition, delegation, integration, decisions', calls: 'everyone' },
  spec:      { role: 'Product / Spec', owns: 'docs/ (spec notes only) — NO code', expertise: 'acceptance criteria, scope, non-goals, user value', calls: 'lead, ux, voice' },
  architect: { role: 'Architect', owns: 'docs/adr/ (ADR notes only) — NO code', expertise: 'system design, data flow, trade-offs, interfaces', calls: 'security, features, voice' },
  security:  { role: 'Security Engineer', owns: 'server.js, SECURITY.md', expertise: 'relay/proxy hardening, privacy, agentic threat modeling (goal hijacking, tool misuse)', calls: 'qa, features' },
  voice:     { role: 'AI / Voice Engineer', owns: 'voicethread-app/src/features/emotion/**', expertise: 'ElevenLabs TTS/STT/cloning, eleven_v3 emotion tags, latency/cost tuning, prompt design', calls: 'features, qa' },
  features:  { role: 'Features Engineer', owns: 'voicethread-app/src/api/**, voicethread-app/src/features/chat/**, voicethread-app/package.json deps', expertise: 'app + relay features, React Native', calls: 'ux, voice, security, qa' },
  ux:        { role: 'UX/UI + Accessibility', owns: 'voicethread-app/App.js, voicethread-app/src/theme.js, UX.md', expertise: 'screens, design system, eyes-free/driving a11y', calls: 'features, voice' },
  qa:        { role: 'QA / Test Engineer', owns: 'tests/**, root package.json scripts', expertise: 'automated tests, evals, verification (zero-credit)', calls: 'security, features, voice, ux' },
  reviewer:  { role: 'Adversarial Reviewer', owns: '(read-only; quality gate)', expertise: 'correctness, regressions, security/privacy, rubric judging', calls: 'everyone' },
};
const rosterText = Object.keys(TEAM)
  .map((id) => `- ${id}: ${TEAM[id].role} | expertise: ${TEAM[id].expertise} | owns: ${TEAM[id].owns} | may consult: ${TEAM[id].calls}`)
  .join('\n');
const roleOf = (id) => (TEAM[id] && TEAM[id].role) || id;

const OPERATING_PRINCIPLES = `
ENGINEERING OPERATING PRINCIPLES (every agent follows these):
1. Read before you write — understand existing patterns and REUSE them; start wide, then narrow.
2. Least privilege — edit ONLY the files your role owns; never touch another role's files (they may work in parallel).
3. Small, safe diffs — preserve existing contracts & behavior; the milestone-1 "speak with emotion" screen MUST keep working and bundling.
4. Spec-driven — work to the ACCEPTANCE CRITERIA you are given and SELF-VERIFY against each one before setting done:true.
5. Privacy-by-design — emotion is computed on-device; the relay stores nothing; the ElevenLabs key stays server-side and is never logged.
6. Consult, don't guess — when blocked on something a teammate owns/knows, use requests:[{to,ask}] (the orchestrator delivers it). Never edit a teammate's files.
7. PoC mindset — minimal, correct, well-tested over clever; no heavy dependencies; NO installs/servers/destructive commands (a CI step verifies).
8. Transparency — briefly explain key decisions and list risks in your summary.`;

const PROJECT = `
PROJECT: "VoiceThread" — a voice-first messenger PoC (ElevenLabs side project / showcase). Stack: Node + Express + Socket.IO backend (server.js) proxying ALL ElevenLabs calls (key server-side); Expo SDK 56 + React Native app (voicethread-app). Endpoints: /api/config, /api/voices, POST&GET /api/tts (cached), /api/stt, /api/voices/add (IVC, paid). Socket.IO relay: join/message/typing/delivered/played/leave + joined/peer_joined/peer_left/error (in-memory, max 2/room, MESSAGES NEVER STORED). App: App.js milestone-1 "speak with emotion"; on-device emotion in src/features/emotion; chat building blocks in src/api + src/features/chat; design system src/theme.js. Tests: tests/ (node:test, zero-credit) via "npm test".`;

const CONTEXT = `${PROJECT}

TEAM ROSTER (you are one of these; address teammates by id):
${rosterText}

CONSULT PROTOCOL: you CANNOT call a teammate directly. To consult one, put in your structured output:
  requests: [ { "to": "<teammate id>", "ask": "<the exact info/spec you need>" } ]
The ORCHESTRATOR delivers it, gets the answer, and re-invokes you with it.
${OPERATING_PRINCIPLES}`;

// ---- schemas ---------------------------------------------------------------
const SPEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['complexity', 'acceptanceCriteria', 'nonGoals', 'activeAgents', 'steps'],
  properties: {
    complexity: { type: 'string', enum: ['trivial', 'standard', 'complex'] },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    activeAgents: { type: 'array', items: { type: 'string' }, description: 'only the agents needed (scale to complexity: trivial 1, standard 2-3, complex 4-5)' },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['agent', 'task'], properties: {
      agent: { type: 'string' }, task: { type: 'string' },
      acceptanceCriteria: { type: 'array', items: { type: 'string' } },
      mayConsult: { type: 'array', items: { type: 'string' } } } } },
  },
};
const WORK_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'filesChanged', 'done'],
  properties: {
    summary: { type: 'string' }, filesChanged: { type: 'array', items: { type: 'string' } },
    requests: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['to', 'ask'], properties: { to: { type: 'string' }, ask: { type: 'string' } } } },
    risks: { type: 'string' }, done: { type: 'boolean' },
  },
};
const ANSWER_SCHEMA = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
const CI_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['testsPass', 'bundlePass', 'summary'],
  properties: { testsPass: { type: 'boolean' }, bundlePass: { type: 'boolean' }, summary: { type: 'string' }, errors: { type: 'string' } },
};
const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'score', 'blockers'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    score: { type: 'number' },
    blockers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['issue', 'owner'], properties: {
      file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' }, owner: { type: 'string' } } } },
    notes: { type: 'string' },
  },
};

// ---- helpers ---------------------------------------------------------------
// Route a specialist's consult requests to named teammates (read-only), parallel.
async function consult(fromId, requests) {
  const valid = (requests || []).filter((r) => r && TEAM[r.to]);
  if (!valid.length) return [];
  const answers = await parallel(valid.map((req) => () =>
    agent(`${CONTEXT}\nYOU ARE "${req.to}" (${roleOf(req.to)}).\nTeammate "${fromId}" (${roleOf(fromId)}) needs your help:\n"${req.ask}"\nAnswer concretely (exact APIs, props, paths, constraints). Read the repo as needed. Do NOT edit any file — consult only.`,
      { label: `consult_${req.to}_for_${fromId}`, phase: 'Delegate', agentType: 'Explore', schema: ANSWER_SCHEMA })
      .then((a) => ({ to: req.to, ask: req.ask, answer: (a && a.answer) || '(no answer)' }))));
  return answers.filter(Boolean);
}

// Run one specialist against acceptance criteria; handle one round of consults.
async function runSpecialist(id, task, acceptance, phaseName) {
  if (!TEAM[id] || id === 'lead' || id === 'reviewer') return null;
  const ph = phaseName || 'Delegate';
  const ac = (acceptance && acceptance.length) ? `\nACCEPTANCE CRITERIA (self-verify each before done:true):\n- ${acceptance.join('\n- ')}` : '';
  const base = `${CONTEXT}\nYOU ARE "${id}" (${roleOf(id)}). Edit ONLY files your role owns.\nTASK: ${task}${ac}`;
  let out = await agent(`${base}\nIf blocked needing a teammate's input, return it in "requests" BEFORE editing; otherwise complete the work and set done:true.`,
    { label: id, phase: ph, agentType: 'general-purpose', schema: WORK_SCHEMA });
  if (out && out.requests && out.requests.length) {
    log(`${id} consults: ${out.requests.map((r) => r.to).join(', ')}`);
    const answers = await consult(id, out.requests);
    out = await agent(`${base}\nYour teammates answered:\n${JSON.stringify(answers, null, 2)}\nNow COMPLETE the work, edit your files, set done:true.`,
      { label: `${id}_final`, phase: ph, agentType: 'general-purpose', schema: WORK_SCHEMA });
  }
  return Object.assign({ agent: id }, out || {});
}

// ---- Phase 1: Spec & Route -------------------------------------------------
phase('Spec & Route');
log(`Goal: ${GOAL}`);
const spec = await agent(`${CONTEXT}\nYOU ARE THE TECH LEAD / ORCHESTRATOR.\nGOAL: ${GOAL}\nRead the repo, then deliver:\n1) ACCEPTANCE CRITERIA — concrete, testable "done" conditions. And NON-GOALS — scope guard.\n2) COMPLEXITY (trivial|standard|complex) and ACTIVE AGENTS — select ONLY the agents needed. Scale effort: trivial=1, standard=2-3, complex=4-5. Do not activate agents that add no value (coordination overhead is real).\n3) An ORDERED plan. Each step: agent id + concrete task + that step's acceptanceCriteria + mayConsult. Respect file OWNERSHIP (never two agents on the same file — sequence them). If used, put spec/architect (docs) steps first.`,
  { label: 'lead_spec', phase: 'Spec & Route', agentType: 'Explore', schema: SPEC_SCHEMA });
log(`Complexity: ${spec && spec.complexity} | Team: ${((spec && spec.activeAgents) || []).join(', ')}`);
log(`Plan: ${((spec && spec.steps) || []).map((s) => s.agent).join(' -> ') || '(none)'}`);

// ---- Phase 2: Delegate -----------------------------------------------------
phase('Delegate');
const results = [];
for (const step of (spec && spec.steps) || []) {
  const r = await runSpecialist(step.agent, step.task, step.acceptanceCriteria, 'Delegate');
  if (r) results.push(r);
}

// ---- Phase 3: Verify & Fix (evaluator-optimizer, bounded) ------------------
phase('Verify & Fix');
const acText = ((spec && spec.acceptanceCriteria) || []).map((c) => `- ${c}`).join('\n') || '(none specified)';
let round = 0;
let passed = false;
let review = null;
let verify = null;
while (round < MAX_FIX_ROUNDS && !passed) {
  round++;
  verify = await agent(`YOU ARE THE CI RUNNER. Working dir ${REPO}. Run these and report; edit nothing:\n1) cd "${REPO}" && npm test\n2) cd "${REPO}/voicethread-app" && npx --yes expo export -p android   (then remove the dist/ folder)\nReturn testsPass (bool), bundlePass (bool), a summary, and exact error lines for any failure.`,
    { label: `ci_round${round}`, phase: 'Verify & Fix', agentType: 'general-purpose', schema: CI_SCHEMA });
  review = await agent(`${CONTEXT}\nYOU ARE THE ADVERSARIAL REVIEWER (read-only quality gate).\nGOAL: ${GOAL}\nACCEPTANCE CRITERIA:\n${acText}\nCI RESULT: ${JSON.stringify(verify)}\nReview the team's changes against the acceptance criteria AND for regressions, security/privacy leaks, and RN/Expo bugs. Attribute every blocker to the OWNER agent (one of: ${Object.keys(TEAM).join(', ')}). Return verdict (pass/fail), score 0..1, and blockers:[{file,issue,fix,owner}]. List ONLY real blockers — be precise; self-retracted nitpicks are noise.`,
    { label: `review_round${round}`, phase: 'Verify & Fix', agentType: 'Explore', schema: JUDGE_SCHEMA });

  const ciOk = !!(verify && verify.testsPass && verify.bundlePass);
  if (review && review.verdict === 'pass' && ciOk) { passed = true; break; }
  if (round >= MAX_FIX_ROUNDS) break;

  // Route blockers back to their owners (group by owner).
  const byOwner = {};
  for (const b of (review && review.blockers) || []) {
    if (!b || !TEAM[b.owner] || b.owner === 'lead' || b.owner === 'reviewer') continue;
    if (!byOwner[b.owner]) byOwner[b.owner] = [];
    byOwner[b.owner].push(b);
  }
  // If CI is red but no blocker named an owner, send the CI errors to QA.
  if (!Object.keys(byOwner).length && !ciOk) {
    byOwner.qa = [{ file: '(CI)', issue: 'Automated checks are failing', fix: (verify && verify.errors) || (verify && verify.summary) || 'see CI', owner: 'qa' }];
  }
  log(`Round ${round}: routing fixes to ${Object.keys(byOwner).join(', ') || '(none)'}`);
  for (const owner of Object.keys(byOwner)) {
    const r = await runSpecialist(owner, `Fix these review/CI blockers without regressing anything else:\n${JSON.stringify(byOwner[owner], null, 2)}`, (spec && spec.acceptanceCriteria) || [], 'Verify & Fix');
    if (r) results.push(r);
  }
}

return { goal: GOAL, spec, results, passed, rounds: round, finalReview: review, finalCI: verify };
