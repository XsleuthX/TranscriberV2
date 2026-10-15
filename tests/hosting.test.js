import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server/app.js';
test('production cannot start publicly without workspace access settings', () => {
  assert.throws(() => createAppServer({ NODE_ENV: 'production' }), /Production requires/);
  assert.throws(() => createAppServer({ NODE_ENV: 'production', APP_PASSWORD: 'a-long-test-password', APP_ORIGIN: 'http://public.test' }), /HTTPS/);
});
test('hosted app gates files and APIs, signs in, rejects foreign origins, then signs out', async t => {
  // Authentication/static access is independent of whether the frontend has
  // already been built in a fresh checkout.
  const directory = await mkdtemp(path.join(tmpdir(), 'transcriber-hosting-test-'));
  await writeFile(path.join(directory, 'index.html'), '<html><body>Hosting fixture</body></html>');
  t.after(async () => {
    if (!path.basename(directory).startsWith('transcriber-hosting-test-')) throw new Error('Invalid test cleanup path.');
    await rm(directory, { recursive: true, force: true });
  });
  const server = createAppServer({ APP_PASSWORD: 'a-long-test-password' }, { dist: directory });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(base)).text(), /Workspace password/);
  const navigation = await new Promise((resolve, reject) => {
    http.get(base, { headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate' } }, res => {
      let body = ''; res.on('data', part => { body += part; }); res.on('end', () => resolve(body));
    }).on('error', reject);
  });
  assert.match(navigation, /Workspace password/);
  assert.equal((await fetch(base + '/api/keys')).status, 401);
  assert.equal((await fetch(base + '/api/keys', { headers: { Origin: 'https://foreign.test' } })).status, 403);
  assert.equal((await fetch(base + '/api/keys', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
  const login = await fetch(base + '/auth/login', { method: 'POST', redirect: 'manual', body: 'password=a-long-test-password' });
  assert.equal(login.status, 303); const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.equal((await fetch(base + '/api/keys', { headers: { cookie } })).status, 200);
  assert.match(await (await fetch(base, { headers: { cookie } })).text(), /<html/);
  assert.equal((await fetch(base + '/auth/logout', { method: 'POST', headers: { cookie }, redirect: 'manual' })).status, 303);
  assert.equal((await fetch(base + '/api/keys', { headers: { cookie } })).status, 401);
});
