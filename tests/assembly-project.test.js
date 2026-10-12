import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblySources, assemblyBatches, parseQuotePicks, parseStoryPlan } from '../src/ai-assembly.js';
import { exportProjectJSON, importProjectJSON } from '../src/project-json.js';
const project = () => ({ media: Object.fromEntries(['one', 'two'].map(key => [key, { name: key, type: 'local', url: 'blob:nonportable',
  words: [{ t: 'Opening.', s: 2, e: 4 }, { t: 'Conclusion.', s: 5, e: 8 }],
  cues: [{ id: 'a', ws: 0, we: 0 }, { id: 'b', ws: 1, we: 1, textOverride: 'Edited quote.' }],
  cuesB: [{ id: 'a_B', ws: null, we: null, textOverride: '翻译。', startOverride: 2, endOverride: 4 }],
  clips: [{ id: 'clip', in: 2, out: 8, cueRefs: ['a', 'b'], label: 'Original clip' }],
  pcm: new Int16Array([-32768, 0, 32767, 123]).buffer, pcmRate: 16000 }])),
  rows: [{ id: 'r', label: 'Story', cards: [{ id: 'card', assetKey: 'two', kind: 'cue', col: 'video', cueRefs: ['a', 'b'], sourceCueRefs: ['a', 'b'], sin: 2, sout: 8 }] }],
  mtl: { tracks: [{ id: 'V1', name: 'Video', kind: 'video', height: 46, locked: true }, { id: 'OVL', name: 'Overlay', kind: 'overlay', height: 26 }],
    clips: [{ id: 'multi', assetKey: 'two', trackId: 'V1', kind: 'video', pin: 0, pout: 6, sin: 2, sout: 8, opacity: .5, groupId: 'group' }], markers: [{ id: 'mark', time: 3 }] },
  reviews: [], rules: { maxChars: 42, maxDur: 5.5, gapBreak: .7, targetCps: 17 }, activeAsset: 'two', ui: { projectName: 'Project', ws: 'story', track: 'B', mtlZoom: 32, mtlSnap: false, docSize: 18, uiZoom: 1 } });
const sources = (doc, whole = true) => assemblySources(doc, 'one', whole,
  (c, words) => c.textOverride ?? words.slice(c.ws, c.we + 1).map(w => w.t).join(' '),
  (c, words) => ({ start: c.startOverride ?? words[c.ws].s, end: c.endOverride ?? words[c.we].e }));
test('AI clips resolve exact current cue text/time and reject invented, cross-source or reversed ranges', () => {
  const items = sources(project());
  assert.equal(sources(project(), false).length, 2);
  const picks = parseQuotePicks(JSON.stringify({ clips: [{ from: 'c1', to: 'c2', label: 'Quote' }, { from: 'c1', to: 'c4' }, { from: 'c2', to: 'c1' }, { from: 'unknown', to: 'c1' }] }), items);
  assert.equal(picks.length, 1); assert.equal(picks[0].text, 'Opening.\nEdited quote.');
  assert.equal(picks[0].assetKey, 'one'); assert.equal(picks[0].in, 2); assert.equal(picks[0].out, 8); assert.deepEqual(picks[0].cueRefs, ['a', 'b']);
  assert.throws(() => parseQuotePicks('{"clips":[', items));
  assert.throws(() => parseQuotePicks('{"clips":[{"from":"c99","to":"c1"}]}', items));
});
test('Every source cue enters a bounded batch; Story uses issued source-linked candidates in narrative order', () => {
  const items = Array.from({ length: 201 }, (_, i) => ({ id: 'c' + i, text: 'quote'.repeat(200) }));
  const batches = assemblyBatches(items);
  assert.deepEqual(batches.flat(), items); assert.ok(batches.every(b => b.length <= 40 && JSON.stringify(b).length < 15000));
  const candidates = sources(project()).map((item, i) => ({ ...item, id: 'q' + i }));
  const plan = parseStoryPlan('{"sections":[{"title":"Hook","clips":["q3","q0"]},{"title":"Ending","clips":["q0","q2"]}]}', candidates);
  assert.deepEqual(plan.map(s => s.clips.map(c => c.assetKey)), [['two', 'one'], ['two']]);
  assert.throws(() => parseStoryPlan('{"sections":[{"title":"Hook","clips":["invented"]}]}', candidates));
});
test('Project JSON round-trips both subtitles, source links, Story, tracks, edits, settings and chunked PCM', () => {
  const original = project(); original.media.two.pcm = Int16Array.from({ length: 40001 }, (_, i) => i % 32767).buffer;
  original.ui.dictionary={asr:[{from:'碎莲',to:'睡莲'}],tr:[]}; original.ui.priming=false;
  original.media.two.transcriptionSource={segments:[{start:2,end:4,text:'Original decode',logprob:null,noSpeech:.1}],unresolved:1};
  original.reviews = [{ reviewId: 'review', preset: 'subtitle_check', presetLabel: 'Subtitle Check', kind: 'cue', assetKey: 'one', scopeAsset: 'one', scopeContext: 'B', track: 'B', id: 'a_B', target: '["cue","one","B","a_B"]', signature: 'snapshot', reason: 'Review this wording', suggestion: '修正。' }];
  original.media.two.iconik = { assetId: 'asset-id', proxyId: 'proxy-id', audioUrl: '/api/session-audio' };
  const json = exportProjectJSON({ ...original, keys: { openai: 'PRIVATE-KEY' } });
  assert.ok(!json.includes('PRIVATE-KEY') && !json.includes('blob:nonportable') && !json.includes('/api/session-audio'));
  const imported = importProjectJSON(json);
  assert.deepEqual(imported.rows, original.rows); assert.deepEqual(imported.mtl, original.mtl); assert.deepEqual(imported.ui, original.ui); assert.deepEqual(imported.reviews, original.reviews);
  for (const key of Object.keys(original.media)) {
    assert.deepEqual(imported.media[key].cues, original.media[key].cues); assert.deepEqual(imported.media[key].cuesB, original.media[key].cuesB);
    assert.deepEqual(new Int16Array(imported.media[key].pcm), new Int16Array(original.media[key].pcm));
    assert.equal(imported.media[key].url, null); assert.equal(imported.media[key].offline, true);
  }
  assert.deepEqual(imported.media.two.transcriptionSource,original.media.two.transcriptionSource);
});
test('Invalid JSON/schema, unsafe keys, duplicate IDs, invalid references and corrupt audio fail before import', () => {
  const valid = JSON.parse(exportProjectJSON(project()));
  for (const change of [p => p.version = 999, p => p.project.media.one.cues.push(p.project.media.one.cues[0]),
    p => p.project.rows[0].cards[0].assetKey = {}, p => p.project.media.one.pcm.byteLength = 123,
    p => p.project.mtl.clips[0].trackId = 'unknown', p => p.project.rows[0].cards[0].title = { bad: true },
    p => p.project.ui.dictionary={asr:[{from:123,to:'word'}],tr:[]}, p => p.project.ui.priming='yes']) {
    const invalid = structuredClone(valid); change(invalid); assert.throws(() => importProjectJSON(JSON.stringify(invalid)));
  }
  assert.throws(() => importProjectJSON('{"__proto__":{}}')); assert.throws(() => importProjectJSON('{broken'));
});
test('Backups preserve intentional missing-source placeholders and empty media pools', () => {
  const p = project(); p.media = {}; p.activeAsset = null;
  const restored = importProjectJSON(exportProjectJSON(p));
  assert.deepEqual(restored.media, {}); assert.equal(restored.activeAsset, null);
  assert.equal(restored.rows[0].cards[0].assetKey, 'two'); assert.equal(restored.mtl.clips[0].assetKey, 'two');
});
