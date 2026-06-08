export const meta = {
  name: 'voicethread-brand-redesign',
  description: 'ElevenLabs-brand design team for VoiceThread. A Design Director writes brand-fidelity acceptance criteria and delegates to specialists (art direction, design tokens + Inter fonts, signature motifs, UI screens, chat UI) who consult each other via the orchestrator; then a brand-fidelity review + CI bundle, with blockers routed back to owners (bounded rounds). Goal: make the app feel like a product ElevenLabs shipped.',
  phases: [
    { title: 'Spec & Route', detail: 'Design Director: brand-fidelity acceptance criteria, active team, ordered plan' },
    { title: 'Delegate', detail: 'tokens -> motif -> UI screens + chat; cross-agent consults routed by the orchestrator' },
    { title: 'Verify & Fix', detail: 'Brand-fidelity review + Expo bundle (with font deps); blockers routed to owners (max 2 rounds)' },
  ],
};

const REPO = 'C:/Users/frani/Uczelnia/SMS';
const BRAND = `${REPO}/docs/ELEVENLABS-BRAND.md`;
const MAX_FIX_ROUNDS = 2;

const GOAL =
  (typeof args === 'string' && args.trim()) ? args.trim()
  : (args && typeof args.goal === 'string' && args.goal.trim()) ? args.goal.trim()
  : `Re-skin the ENTIRE VoiceThread mobile app (voicethread-app) so it feels like a product ElevenLabs shipped, following ${BRAND} EXACTLY (LIGHT editorial mode). Deliver: (1) src/theme.js rewritten to the ElevenLabs token set (warm-stone neutrals, ink CTAs, gradient-orb colors, the Inter type scale, 4px spacing, radius scale) + Inter font loading (expo-font + @expo-google-fonts/inter) exposed via a hook, with a graceful system-font fallback; (2) signature brand components in src/ui/ — a "VoiceThread" Wordmark (ElevenLabs type treatment, optional "11"/waveform motif), a decorative pastel GradientOrb, and an audio Waveform; (3) App.js restyled (Home tabs, "Mów"/Speak screen, "Czat"/Chat setup) — canvas background, ink pill CTAs, hairline borders, generous spacing, a soft gradient-orb bloom behind the header, Inter type; (4) ChatScreen.js restyled with MONOCHROME bubbles (incoming = white surface + ink text, outgoing = ink #0c0a09 + white text — NOT iMessage blue) and brand type/spacing. Preserve ALL behavior (backend auto-detect, GET /api/voices, GET /api/tts playback, live emotion display, relay chat, accessibility). Must bundle clean for Android and keep "npm test" green. It must genuinely FEEL like ElevenLabs.`;

// === ElevenLabs DESIGN TEAM (bench; the Director activates who is needed) ====
const TEAM = {
  lead:     { role: 'Design Director / Orchestrator', owns: '(plans, routes, integrates; guards ElevenLabs fidelity; no direct edits)', expertise: 'art direction, brand fidelity, delegation', calls: 'everyone' },
  brand:    { role: 'Brand / Art Director', owns: 'docs/ (design-direction notes only) — NO code', expertise: 'ElevenLabs visual language, composition, brand fidelity', calls: 'lead, tokens, motif' },
  tokens:   { role: 'Design Systems Engineer', owns: 'voicethread-app/src/theme.js, voicethread-app/src/theme/** (new), voicethread-app/package.json (font deps)', expertise: 'design tokens, color/type/space scales, Inter font loading', calls: 'brand, motif' },
  motif:    { role: 'Signature / Motion Engineer', owns: 'voicethread-app/src/ui/** (new brand components)', expertise: 'wordmark/"11" mark, pastel gradient orbs, audio waveform, subtle motion', calls: 'tokens, brand' },
  uiapp:    { role: 'UI Engineer — app shell & screens', owns: 'voicethread-app/App.js', expertise: 'RN screens, layout, applying the design system + motifs', calls: 'tokens, motif, brand' },
  uichat:   { role: 'UI Engineer — chat', owns: 'voicethread-app/src/features/chat/ChatScreen.js', expertise: 'chat UI, monochrome bubbles, applying the design system', calls: 'tokens, motif' },
  reviewer: { role: 'Design QA / Brand-fidelity Reviewer', owns: '(read-only quality gate)', expertise: 'ElevenLabs fidelity, a11y/contrast, correctness, RN/Expo bugs', calls: 'everyone' },
};
const rosterText = Object.keys(TEAM)
  .map((id) => `- ${id}: ${TEAM[id].role} | expertise: ${TEAM[id].expertise} | owns: ${TEAM[id].owns} | may consult: ${TEAM[id].calls}`)
  .join('\n');
const roleOf = (id) => (TEAM[id] && TEAM[id].role) || id;

const OPERATING_PRINCIPLES = `
DESIGN OPERATING PRINCIPLES (every agent):
1. BRAND FIRST — open and follow ${BRAND} to the letter. It is the single source of truth for colors, type, spacing, radius, components, motifs and do/don'ts. The result must read as authentically ElevenLabs (monochrome warm-stone, ink CTAs, hairlines, generous canvas, pastel gradient orbs as atmosphere only, Inter type with light/tight display + slightly-positive body tracking).
2. Read before you write — study the current file and REUSE its logic; you are RE-SKINNING, not rebuilding behavior.
3. Least privilege — edit ONLY the files your role owns (others run in parallel). Consult, don't touch their files.
4. Preserve ALL behavior/contracts — backend auto-detect, GET /api/voices, GET /api/tts playback, live emotion, relay chat, accessibility. Milestone-1 ("Mów") must keep working and the app must bundle.
5. Craft — pixel-considered spacing on the 4px grid, real type scale, hairline borders not heavy shadows, AA contrast, ≥44px tap targets, eyes-free legibility.
6. Consult, don't guess — need a token, a component API, or the wordmark? requests:[{to,ask}]; the orchestrator delivers it.
7. No saturated UI colors, no iMessage-blue, no gradient text/buttons, no recreating "11" with letters. Pastel orbs are decorative only.
8. Be transparent — summarize what you changed + brand-fidelity notes + risks.`;

const PROJECT = `
PROJECT: "VoiceThread" — a voice-first messenger PoC (ElevenLabs side project). Expo SDK 54 + React Native app in voicethread-app. App.js = home with two tabs: "Mów" (speak-with-emotion: GET /api/voices, on-device emotion in src/features/emotion, GET /api/tts -> expo-audio) and "Czat" (pairing code + voice pickers -> ChatScreen). Chat UI: src/features/chat/ChatScreen.js (+ useChat hook, src/api/socket.js). Current design system: src/theme.js (will be rewritten to the ElevenLabs tokens). Backend on port 3000 (do NOT touch server.js). Tests: "npm test" (root).`;

const CONTEXT = `${PROJECT}

TEAM ROSTER (you are one of these; address teammates by id):
${rosterText}

CONSULT PROTOCOL: you CANNOT call a teammate directly. To consult one, put in your structured output:
  requests: [ { "to": "<teammate id>", "ask": "<the exact info/spec/API you need>" } ]
The ORCHESTRATOR delivers it, gets the answer, and re-invokes you with it.
${OPERATING_PRINCIPLES}`;

// ---- schemas ---------------------------------------------------------------
const SPEC_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['complexity', 'acceptanceCriteria', 'nonGoals', 'activeAgents', 'steps'],
  properties: {
    complexity: { type: 'string', enum: ['trivial', 'standard', 'complex'] },
    acceptanceCriteria: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    activeAgents: { type: 'array', items: { type: 'string' } },
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
const CI_SCHEMA = { type: 'object', additionalProperties: false, required: ['testsPass', 'bundlePass', 'summary'], properties: { testsPass: { type: 'boolean' }, bundlePass: { type: 'boolean' }, summary: { type: 'string' }, errors: { type: 'string' } } };
const JUDGE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['verdict', 'score', 'blockers'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'fail'] },
    score: { type: 'number', description: 'brand fidelity 0..1' },
    blockers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['issue', 'owner'], properties: { file: { type: 'string' }, issue: { type: 'string' }, fix: { type: 'string' }, owner: { type: 'string' } } } },
    notes: { type: 'string' },
  },
};

// ---- helpers ---------------------------------------------------------------
async function consult(fromId, requests) {
  const valid = (requests || []).filter((r) => r && TEAM[r.to]);
  if (!valid.length) return [];
  const answers = await parallel(valid.map((req) => () =>
    agent(`${CONTEXT}\nYOU ARE "${req.to}" (${roleOf(req.to)}).\nTeammate "${fromId}" (${roleOf(fromId)}) needs your help:\n"${req.ask}"\nAnswer concretely (exact tokens, component APIs/props, file paths). Read ${BRAND} + the repo as needed. Do NOT edit files — consult only.`,
      { label: `consult_${req.to}_for_${fromId}`, phase: 'Delegate', agentType: 'Explore', schema: ANSWER_SCHEMA })
      .then((a) => ({ to: req.to, ask: req.ask, answer: (a && a.answer) || '(no answer)' }))));
  return answers.filter(Boolean);
}

async function runSpecialist(id, task, acceptance, phaseName) {
  if (!TEAM[id] || id === 'lead' || id === 'reviewer') return null;
  const ph = phaseName || 'Delegate';
  const ac = (acceptance && acceptance.length) ? `\nACCEPTANCE CRITERIA (self-verify each before done:true):\n- ${acceptance.join('\n- ')}` : '';
  const base = `${CONTEXT}\nYOU ARE "${id}" (${roleOf(id)}). FIRST read ${BRAND}. Edit ONLY files your role owns.\nTASK: ${task}${ac}`;
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
log('Goal: ElevenLabs-brand redesign of VoiceThread');
const spec = await agent(`${CONTEXT}\nYOU ARE THE DESIGN DIRECTOR / ORCHESTRATOR.\nGOAL: ${GOAL}\nRead ${BRAND} and the current app, then deliver:\n1) ACCEPTANCE CRITERIA — concrete, checkable "this reads as ElevenLabs" conditions (e.g. canvas #f5f5f5, ink #292524 pill CTAs, hairline borders, Inter scale, monochrome chat bubbles, gradient-orb atmosphere, milestone-1 still works + bundles).\n2) NON-GOALS.\n3) COMPLEXITY + ACTIVE AGENTS (scale to the task).\n4) An ORDERED plan honoring file OWNERSHIP and dependency order: brand (optional notes) -> tokens (theme + Inter) -> motif (src/ui) -> uiapp (App.js) + uichat (ChatScreen.js). Each step needs its own acceptanceCriteria + mayConsult.`,
  { label: 'director_spec', phase: 'Spec & Route', agentType: 'Explore', schema: SPEC_SCHEMA });
log(`Complexity: ${spec && spec.complexity} | Team: ${((spec && spec.activeAgents) || []).join(', ')}`);
log(`Plan: ${((spec && spec.steps) || []).map((s) => s.agent).join(' -> ') || '(none)'}`);

// ---- Phase 2: Delegate -----------------------------------------------------
phase('Delegate');
const results = [];
for (const step of (spec && spec.steps) || []) {
  const r = await runSpecialist(step.agent, step.task, step.acceptanceCriteria, 'Delegate');
  if (r) results.push(r);
}

// ---- Phase 3: Verify & Fix -------------------------------------------------
phase('Verify & Fix');
const acText = ((spec && spec.acceptanceCriteria) || []).map((c) => `- ${c}`).join('\n') || '(none)';
let round = 0;
let passed = false;
let review = null;
let verify = null;
while (round < MAX_FIX_ROUNDS && !passed) {
  round++;
  verify = await agent(`YOU ARE THE CI RUNNER. Working dir ${REPO}. Run and report (you MAY install deps; edit no source):\n1) cd "${REPO}/voicethread-app" && npx --yes expo install expo-font @expo-google-fonts/inter   (only if those are imported anywhere; otherwise skip)\n2) cd "${REPO}/voicethread-app" && npm install\n3) cd "${REPO}" && npm test\n4) cd "${REPO}/voicethread-app" && npx --yes expo export -p android   (then remove the dist/ folder)\nReturn testsPass, bundlePass, a summary, and exact errors for any failure.`,
    { label: `ci_round${round}`, phase: 'Verify & Fix', agentType: 'general-purpose', schema: CI_SCHEMA });
  review = await agent(`${CONTEXT}\nYOU ARE THE BRAND-FIDELITY REVIEWER (read-only). Read ${BRAND}, then the changed files.\nGOAL: ${GOAL}\nACCEPTANCE CRITERIA:\n${acText}\nCI RESULT: ${JSON.stringify(verify)}\nJudge: does it authentically read as ElevenLabs (tokens, type, spacing, monochrome chat, orbs-as-atmosphere, no saturated CTAs)? Any regressions, a11y/contrast issues, or RN/Expo bugs? Attribute each blocker to the OWNER agent (${Object.keys(TEAM).join(', ')}). Return verdict pass/fail, score 0..1 (brand fidelity), blockers:[{file,issue,fix,owner}]. Real blockers only.`,
    { label: `review_round${round}`, phase: 'Verify & Fix', agentType: 'Explore', schema: JUDGE_SCHEMA });

  const ciOk = !!(verify && verify.testsPass && verify.bundlePass);
  if (review && review.verdict === 'pass' && ciOk) { passed = true; break; }
  if (round >= MAX_FIX_ROUNDS) break;

  const byOwner = {};
  for (const b of (review && review.blockers) || []) {
    if (!b || !TEAM[b.owner] || b.owner === 'lead' || b.owner === 'reviewer') continue;
    if (!byOwner[b.owner]) byOwner[b.owner] = [];
    byOwner[b.owner].push(b);
  }
  if (!Object.keys(byOwner).length && !ciOk) {
    byOwner.uiapp = [{ file: '(CI)', issue: 'Bundle/tests failing', fix: (verify && verify.errors) || (verify && verify.summary) || 'see CI', owner: 'uiapp' }];
  }
  log(`Round ${round}: routing fixes to ${Object.keys(byOwner).join(', ') || '(none)'}`);
  for (const owner of Object.keys(byOwner)) {
    const r = await runSpecialist(owner, `Fix these brand-fidelity / CI blockers without regressing anything:\n${JSON.stringify(byOwner[owner], null, 2)}`, (spec && spec.acceptanceCriteria) || [], 'Verify & Fix');
    if (r) results.push(r);
  }
}

return { goal: GOAL, spec, results, passed, rounds: round, finalReview: review, finalCI: verify };
