import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentHistory } from '../src/document-history.js';
import { splitCueText } from '../src/cue-split.js';
import { reviewTargets, reviewBatches, parseReview } from '../src/ai-review.js';
const doc = () => ({ media: { a: { words: [{ t: 'hello', s: 0, e: 1 }], cues: [{ id: 'a', ws: 0, we: 0, textOverride: 'hello world' }], cuesB: [{ id: 'b', textOverride: 'bonjour monde', startOverride: 0, endOverride: 2 }], clips: [] } }, rows: [], mtl: { clips: [], tracks: [] }, reviews: [] });
test('Undo separates rapid actions, groups synchronous transactions, and invalidates Redo immediately', async () => {
  const h = createDocumentHistory(doc()); h.enable();
  h.update('rows', [{ id: 1 }]); h.update('reviews', [{ id: 1 }]); await Promise.resolve();
  h.update('rows', [{ id: 2 }]); await Promise.resolve();
  h.undo(); assert.deepEqual(h.current.rows, [{ id: 1 }]); assert.deepEqual(h.current.reviews, [{ id: 1 }]);
  h.undo(); assert.deepEqual(h.current.rows, []); assert.deepEqual(h.current.reviews, []);
  h.redo(); h.update('rows', [{ id: 3 }]); assert.equal(h.canRedo, false);
  h.undo(); assert.deepEqual(h.current.rows, [{ id: 1 }]);
});
test('Metadata and no-op updates are not history actions; newest resource cache survives Undo', async () => {
  const h = createDocumentHistory(doc()); h.enable();
  h.update('media', m => ({ ...m, a: { ...m.a, pcmRate: 16000, pcm: new ArrayBuffer(16), duration: 20 } }));
  h.update('rows', []); await Promise.resolve(); assert.equal(h.canUndo, false);
  h.update('media', m => ({ ...m, a: { ...m.a, cues: [] } })); await Promise.resolve();
  h.update('media', m => ({ ...m, a: { ...m.a, width: 1920 } }));
  h.undo(); assert.equal(h.current.media.a.cues.length, 1); assert.equal(h.current.media.a.width, 1920); assert.equal(h.current.media.a.pcm.byteLength, 16);
});
test('Whole timeline drag is one action and Undo follows edits across modes', async () => {
  const h = createDocumentHistory(doc()); h.enable();
  h.begin(); h.update('mtl', { clips: [1], tracks: [] }); await Promise.resolve(); h.update('mtl', { clips: [2], tracks: [] }); h.end();
  h.update('rows', [{ id: 1 }]); await Promise.resolve(); h.undo(); assert.deepEqual(h.current.mtl.clips, [2]); h.undo(); assert.deepEqual(h.current.mtl.clips, []);
});
test('Caret split retains exact A/B edited text, source identity, pinned bounds, and segment-only cues', () => {
  for (const text of ['Edited English text', '译文完全不应该改变', 'bonjour monde']) {
    const cue = { id: 'keep', ws: null, we: null, textOverride: text };
    const halves = splitCueText(cue, text, 5, .01, 3.02, 0, [], 'new');
    assert.equal(halves.map(c => c.textOverride).join(''), text); assert.equal(halves[0].id, 'keep');
    assert.equal(halves[0].endOverride, halves[1].startOverride); assert.equal(halves[1].endOverride, 3.02);
  }
  assert.equal(splitCueText({ id: 'x' }, 'hello', 0, 0, 1, 0, [], 'new'), null);
});
const cueText = c => c.textOverride || 'hello', cueTime = c => ({ start: c.startOverride || 0, end: c.endOverride || 2 });
test('Review validates exact track/source target IDs and blocks invented targets or partial JSON', () => {
  const targets = reviewTargets('subtitle_check', doc(), 'a', 'BOTH', cueText, cueTime);
  const flags = parseReview(JSON.stringify({ flags: [{ target: targets[1].target, reason: 'punctuation', suggestion: 'bonjour monde.' }] }), targets);
  assert.equal(flags[0].track, 'B'); assert.equal(flags[0].assetKey, 'a');
  assert.throws(() => parseReview('{"flags":[', targets));
  assert.equal(parseReview(JSON.stringify({ flags: [{ target: 'invented', reason: 'x' }] }), targets).rejected, 1);
  assert.throws(() => parseReview('{"flags":{}}', targets));
});
test('Review request IDs tolerate harmless formatting but never redirect invalid flags', () => {
  const targets = reviewTargets('transcript_check', doc(), 'a', 'A', cueText, cueTime).map((t, i) => ({ ...t, requestTarget: 'r' + (i + 1) }));
  const parsed = parseReview(JSON.stringify({ flags: [
    { target: ' R1 ', explanation: 'Correct spelling', suggestion: 'Hello' },
    { target: 'invented', reason: 'unsafe', suggestion: 'wrong' },
    { target: 'r1', reason: '', suggestion: 'missing reason' },
    { target: 'r1', reason: 'Correct spelling', suggestion: 'Hello' },
  ] }), targets);
  assert.equal(parsed.length, 1); assert.equal(parsed.rejected, 2); assert.equal(parsed[0].target, targets[0].target);
  assert.equal(parsed[0].suggestion, 'Hello'); assert.equal(parsed[0].requestTarget, undefined);
  assert.equal(reviewBatches(targets)[0][0].target, 'r1');
  assert.equal(parseReview(JSON.stringify({ flags: [{ target: 'r99', reason: 'outside batch' }] }), targets).length, 0);
});
test('Large review contexts are bounded batches with deterministic fingerprints for stale detection', () => {
  const targets = Array.from({ length: 70 }, (_, i) => ({ target: String(i), text: 'x'.repeat(2000), signature: 'private fingerprint' }));
  const batches = reviewBatches(targets); assert.equal(batches.flat().length, 70);
  assert.ok(batches.every(b => b.length <= 25 && !JSON.stringify(b).includes('fingerprint')));
  const before = reviewTargets('subtitle_check', doc(), 'a', 'A', cueText, cueTime)[0]; const changed = doc(); changed.media.a.cues[0].textOverride = 'edited';
  assert.notEqual(before.signature, reviewTargets('subtitle_check', changed, 'a', 'A', cueText, cueTime)[0].signature);
});
