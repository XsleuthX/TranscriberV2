import test from 'node:test';
import assert from 'node:assert/strict';
import { alignScriptLines } from '../src/script-alignment.js';
import { replaceText, replaceTimedWords, textMatches, timedText } from '../src/text-replace.js';
const heard = (t, s, e) => ({ t, s, e, sp: 'S1' });

test('alignment keeps every input line and uses its own acoustic timestamps', () => {
  const lines = ['  Hello, world!  ', 'Second line.', 'Hello world again.'];
  const result = alignScriptLines(lines, [heard('Hello world', 1, 2), heard('Second', 7, 7.5), heard('line', 7.5, 8), heard('Hello', 12, 12.3), heard('world', 12.3, 12.6), heard('again', 12.6, 13)]);
  assert.deepEqual(result.cues.map(c => c.textOverride), lines);
  assert.deepEqual(result.cues.map(c => [c.startOverride, c.endOverride]), [[1, 2], [7, 8], [12, 13]]);
  assert.equal(result.estimatedLines, 0); assert.equal(result.matched, 7);
});
test('CJK alignment reconciles multi-character Whisper tokens and punctuation', () => {
  const lines = ['你好，世界！', '第二句。', '第三句！'];
  const result = alignScriptLines(lines, [heard('你好', 0, 1), heard('世界', 1, 2), heard('第二句', 5, 6.5), heard('第三句', 9, 10.5)]);
  assert.deepEqual(result.cues.map(c => c.textOverride), lines);
  assert.deepEqual(result.cues.map(c => [c.startOverride, c.endOverride]), [[0, 2], [5, 6.5], [9, 10.5]]);
  assert.equal(result.estimatedLines, 0);
});
test('missing words are flagged as estimates, unrelated scripts fail without invented alignment', () => {
  const result = alignScriptLines(['Hello corrected world.', 'Next line.'], [heard('Hello', 1, 1.4), heard('world', 2, 2.6), heard('Next', 4, 4.5), heard('line', 4.5, 5)]);
  assert.equal(result.estimatedLines, 1); assert.equal(result.cues[1].startOverride, 4);
  assert.ok(result.words.every(w => Number.isFinite(w.s) && w.e > w.s));
  assert.throws(() => alignScriptLines(['Unrelated script.'], [heard('Different speech', 0, 1)]), /does not match/);
});
test('punctuation/hyphen differences and overlapping provider times remain readable and ordered', () => {
  const result = alignScriptLines(['End-of-line.', '你好，世界！'], [heard('End of line', 0, 1), heard('你', 3, 3.5), heard('好', 3.4, 4), heard('世界', 4, 5)]);
  assert.deepEqual(result.cues.map(c => c.textOverride), ['End-of-line.', '你好，世界！']);
  assert.equal(result.matched, 7); assert.equal(result.estimatedLines, 1);
  assert.ok(result.words.every((w, i, all) => w.e > w.s && (!i || w.s >= all[i - 1].e)));
  assert.ok(result.words.some(w => w.t.includes('，')));
});
test('long scripts align without a quadratic recording-sized allocation', () => {
  const input = Array.from({ length: 6000 }, (_, i) => `word${i}.`);
  const result = alignScriptLines(input, input.map((t, i) => heard(t, i * .4, i * .4 + .3)));
  assert.equal(result.matched, 6000); assert.equal(result.cues.at(-1).startOverride, 5999 * .4);
});
test('find/replace is literal, case selectable and supports punctuation, deletion and dollar text', () => {
  assert.equal(textMatches('A.b a.b a?b', 'a.b').length, 2);
  assert.equal(textMatches('A.b a.b', 'a.b', true).length, 1);
  assert.equal(replaceText('a.b a.b', 'a.b', '$&', false).text, '$& $&');
  assert.equal(replaceText('foo foo', 'foo', '', false, 1).text, 'foo ');
});
test('transcript replacements inherit timing and preserve unaffected word anchors', () => {
  const words = [heard('Bad', 0, .5), heard('word,', .7, 1.3), heard('ends.', 2, 2.7)].map((w, i) => ({ ...w, i }));
  const result = replaceTimedWords(words, 'bad word,', 'Better phrase.');
  assert.equal(result.count, 1); assert.equal(timedText(result.words).text, 'Better phrase. ends.');
  assert.deepEqual([result.words.at(-1).s, result.words.at(-1).e], [2, 2.7]);
  assert.ok(result.words.slice(0, -1).every(w => w.s >= 0 && w.e <= 1.3));
  assert.equal(replaceTimedWords(words, 'word,', '').words.length, 2);
  const cjk = replaceTimedWords([heard('你', 0, .5), heard('好', .5, 1)], '你好', '您好');
  assert.equal(timedText(cjk.words).text, '您好');
});
test('replace supports recording-sized transcripts without exceeding argument limits', () => {
  const words = Array.from({ length: 20000 }, (_, i) => ({ ...heard(`word${i}`, i * .3, i * .3 + .25), i }));
  const result = replaceTimedWords(words, 'word19999', 'last');
  assert.equal(result.words.length, 20000); assert.equal(result.words.at(-1).t, 'last');
  assert.equal(result.words.at(-1).s, words.at(-1).s);
});
