// Unit test for the on-device emotion module. Pure logic, no network, free to
// run:  node src/features/emotion/emotion.test.mjs
import { classifyEmotion, analyzeForSpeech } from './index.js';

let failures = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ FAIL: ') + m); if (!c) failures++; };

console.log('\n== classifyEmotion ==');
const cases = [
  ['Hahaha super!! 😂', 'joy'],
  ['Niestety nie dam rady... 😔', 'sadness'],
  ['Co ty robisz?! Jestem wkurzony!!!', 'anger'],
  ['Kocham Cię ❤️', 'affection'],
  ['O matko, co się stało?!', 'surprise'],
  ['Trochę się boję tego egzaminu', 'fear'],
  ['ok, jadę', 'neutral'],
  ['To było totalnie goat 🔥', 'joy'],            // PL + EN slang (code-switching)
  ['no way, that is amazing! 😍', 'affection'],
];
for (const [text, expected] of cases) {
  const r = classifyEmotion(text);
  ok(r.emotion === expected, `"${text}" -> ${r.emotion} (int ${r.intensity}, conf ${r.confidence})`);
}

console.log('\n== analyzeForSpeech ==');
const joy = analyzeForSpeech('Hahaha super!! 😂');
ok(joy.modelId === 'eleven_v3', 'joy -> eleven_v3');
ok(/\[(happy|excited)\]/.test(joy.tags[0] || ''), 'joy -> [happy]/[excited]');
ok(joy.ttsText.startsWith(joy.tags[0]), 'tag prepended to ttsText');

const neutral = analyzeForSpeech('ok, jadę');
ok(neutral.modelId === 'eleven_multilingual_v2' && neutral.tags.length === 0, 'neutral -> fallback model, no tags');

const a = analyzeForSpeech('Co ty robisz?! Jestem wkurzony!!!');
const b = analyzeForSpeech('Co ty robisz?! Jestem wkurzony!!!');
ok(JSON.stringify(a) === JSON.stringify(b), 'deterministic (accurate replay)');

console.log('\n' + (failures ? ('❌ ' + failures + ' failure(s)') : '✅ all emotion checks passed') + '\n');
process.exit(failures ? 1 : 0);
