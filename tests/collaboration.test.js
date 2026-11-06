import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server/app.js';
import { equal, mergeDocuments, sharedDocument } from '../src/collaboration-core.js';
import { createDocumentHistory } from '../src/document-history.js';

const document = () => ({ media: { a: { name: 'Source', type: 'local', words: [{ t: 'Hello', s: 0, e: 1 }],
  cues: [{ id: 'a', ws: 0, we: 0 }], cuesB: [], clips: [] } },
  rows: [{ id: 'r', label: 'Opening', cards: [] }], mtl: { tracks: [], clips: [], markers: [] }, rules: {}, reviews: [],
  settings: { projectName: 'Shared test', dictionary: { asr: [], tr: [] }, priming: true } });

test('three-way merge retains different entity edits and detects same-field, deletion and ordering conflicts', () => {
  const base = document(), local = structuredClone(base), remote = structuredClone(base);
  local.rows[0].label = 'My heading'; remote.media.a.cues[0].textOverride = 'Their subtitle';
  let result = mergeDocuments(base, local, remote);
  assert.deepEqual(result.conflicts, []); assert.equal(result.document.rows[0].label, 'My heading');
  assert.equal(result.document.media.a.cues[0].textOverride, 'Their subtitle');
  remote.rows[0].label = 'Their heading';
  result = mergeDocuments(base, local, remote); assert.deepEqual(result.conflicts, ['rows / r / label']);
  assert.equal(mergeDocuments(base, local, remote, 'remote').document.rows[0].label, 'Their heading');
  assert.equal(result.document.rows[0].label, 'My heading');
  local.rows = []; assert.deepEqual(mergeDocuments(base, local, remote).conflicts, ['rows / r']);
  base.rows = ['a','b','c'].map(id => ({ id })); local.rows = [base.rows[1],base.rows[0],base.rows[2]];
  remote.rows = [base.rows[0],base.rows[2],base.rows[1]];
  assert.deepEqual(mergeDocuments(base, local, remote).conflicts, ['rows / (order)']);
});

test('word streams are atomic, concurrent additions survive, and shared snapshots omit local resources', () => {
  assert.equal(equal({ title: 'A', dictionary: [], priming: true }, { priming: true, title: 'A', dictionary: [] }), true);
  const base = document(), local = structuredClone(base), remote = structuredClone(base);
  local.media.a.words[0].t = 'Mine'; remote.media.a.words[0].t = 'Theirs';
  assert.deepEqual(mergeDocuments(base, local, remote).conflicts, ['media / a / words']);
  local.rows.push({ id: 'local', label: 'Local', cards: [] }); remote.rows.push({ id: 'remote', label: 'Remote', cards: [] });
  assert.equal(mergeDocuments(base, local, remote).document.rows.length, 3);
  local.media.a.url = 'blob:private'; local.media.a.pcm = new ArrayBuffer(100);
  local.media.a.iconik = { assetId: 'asset', proxyId: 'proxy', token: 'SECRET' };
  const snapshot = sharedDocument(local, local.settings);
  assert.ok(!JSON.stringify(snapshot).includes('SECRET')); assert.ok(!('url' in snapshot.media.a)); assert.ok(!('pcm' in snapshot.media.a));
});

test('remote updates clear whole-document Undo and view-only history rejects edits but permits playback resources', () => {
  const h = createDocumentHistory(document()); h.enable(); h.update('rows', []); h.end();
  assert.equal(h.canUndo, true); h.replace(document()); assert.equal(h.canUndo, false);
  h.setReadOnly(true); h.update('rows', []); assert.equal(h.current.rows.length, 1); assert.equal(h.undo(), false);
  h.update('media', m => ({ ...m, a: { ...m.a, url: 'blob:local' } })); assert.equal(h.current.media.a.url, 'blob:local');
});

test('workspace auth, role enforcement, compare-and-swap, durable restart, presence and shared range playback', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'transcriber-collab-test-'));
  const env = { COLLAB_DATA_DIR: directory, APP_PASSWORD: 'collaboration-test-password' };
  let server, base, cookie;
  async function start() {
    server = createAppServer(env); await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    const login = await fetch(base + '/auth/login', { method: 'POST', redirect: 'manual', body: 'password=collaboration-test-password' });
    cookie = login.headers.get('set-cookie').split(';')[0];
  }
  async function stop() { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  t.after(async () => { await stop(); if (!path.basename(directory).startsWith('transcriber-collab-test-')) throw Error('Invalid cleanup'); await rm(directory, { recursive: true, force: true }); });
  await start();
  const request = (suffix, key, options = {}) => fetch(base + '/api/collaboration/projects' + suffix, {
    ...options, headers: { cookie, 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...options.headers } });
  assert.equal((await fetch(base + '/api/collaboration/projects', { method: 'POST', body: '{}' })).status, 401);
  const created = await request('', null, { method: 'POST', body: JSON.stringify({ document: document() }) });
  assert.equal(created.status, 201); const p = await created.json(), route = '/' + p.id;
  assert.equal((await request(route)).status, 403);
  const viewer = await (await request(route, p.viewerKey)).json(); assert.equal(viewer.role, 'viewer');
  assert.ok(!JSON.stringify(viewer).includes(p.editorKey)); assert.ok(!JSON.stringify(viewer).includes('Hash'));
  const put = { method: 'PUT', body: JSON.stringify({ revision: 1, document: document() }) };
  assert.equal((await request(route, p.viewerKey, put)).status, 403);
  const simultaneous = await Promise.all([request(route, p.editorKey, put), request(route, p.editorKey, put)]);
  assert.deepEqual(simultaneous.map(r => r.status).sort(), [200, 409]);
  assert.equal((await (await request(route + '?revision=2', p.viewerKey)).json()).unchanged, true);
  const invalid = document(); invalid.media.a.cues[0].we = 100;
  assert.equal((await request(route, p.editorKey, { method: 'PUT', body: JSON.stringify({ revision: 2, document: invalid }) })).status, 400);
  const person = await (await request(route + '/presence', p.viewerKey, { method: 'POST', body: JSON.stringify({ clientId: '1'.repeat(32), name: '<b>Viewer</b>' }) })).json();
  assert.equal(person.people[0].role, 'viewer'); assert.equal(person.people[0].name, '<b>Viewer</b>');
  const bytes = Buffer.from('0123456789');
  assert.equal((await request(route + '/media', p.viewerKey, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes })).status, 403);
  const upload = await request(route + '/media', p.editorKey, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: bytes });
  assert.equal(upload.status, 201); const media = await upload.json();
  let playback = await request(route + '/media/' + media.id + '?key=' + p.viewerKey, null, { headers: { Range: 'bytes=3-6' } });
  assert.equal(playback.status, 206); assert.equal(await playback.text(), '3456');
  assert.equal((await request(route + '/media/' + media.id, p.viewerKey, { headers: { Range: 'bytes=90-' } })).status, 416);
  assert.equal((await request(route, p.editorKey, { headers: { Origin: 'https://foreign.example' } })).status, 403);
  const onDisk = await readFile(path.join(directory, p.id + '.json'), 'utf8'); assert.ok(!onDisk.includes(p.editorKey) && !onDisk.includes(p.viewerKey));
  await stop(); await start();
  assert.equal((await (await request(route, p.viewerKey)).json()).revision, 2);
  playback = await request(route + '/media/' + media.id, p.viewerKey); assert.equal(await playback.text(), '0123456789');
  const replace = await request(route + '/links', p.editorKey, { method: 'POST', body: '{}' }); assert.equal(replace.status, 200);
  assert.equal((await request(route, p.viewerKey)).status, 403);
  assert.equal((await request(route, (await replace.json()).viewerKey)).status, 200);
});
