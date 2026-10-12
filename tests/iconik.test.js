import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { assetIdFromLink, chooseProxy, publicAddress, iconikMiddleware } from '../server/iconik.js';
const asset = '11111111-1111-1111-1111-111111111111', proxy = '22222222-2222-2222-2222-222222222222';
test('asset links parse only approved origin and correct asset path', () => {
  assert.equal(assetIdFromLink(`https://app.iconik.io/asset/${asset}/`), asset);
  assert.equal(assetIdFromLink(`https://app.iconik.io/#/asset/${asset}`), asset);
  for (const link of [`http://localhost/asset/${asset}`, `https://app.iconik.io.evil.test/asset/${asset}`, `https://app.iconik.io/share/${asset}`])
    assert.throws(() => assetIdFromLink(link));
});

test('audio endpoint extracts real proxy audio to complete 16 kHz mono samples', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'iconik-audio-test-'));
  let server;
  try {
    const file = path.join(directory, 'proxy.mp4');
    const result = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file], { windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString());
    const bytes = await readFile(file);
    const middleware = iconikMiddleware({ ICONIK_AUTH_TOKEN: 'test-server-token' }, {
      fetch: async () => new Response(JSON.stringify({ objects: [{ id: proxy, filename: 'proxy.mp4', url: 'https://storage.test/proxy.mp4', status: 'CLOSED' }] })),
      openMedia: async () => { const s = Readable.from([bytes]); s.statusCode = 200; return s; },
    });
    server = http.createServer((req, res) => middleware(req, res, () => res.end()));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/iconik/audio/${asset}/${proxy}`);
    assert.equal(response.status, 200);
    const samples = new Float32Array(await response.arrayBuffer());
    assert.ok(samples.length >= 16000 && samples.length < 17000, 'Complete one-second audio at 16 kHz');
    assert.ok(samples.some(v => Math.abs(v) > .01), 'Audio contains the tone');
    assert.ok(samples.every(Number.isFinite));
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
test('only completed supported proxies are selected', () => {
  assert.equal(chooseProxy([{ id: 'bad', url: 'https://x/a.m3u8' }, { id: proxy, url: 'https://x/a.mp4', status: 'CLOSED' }]).id, proxy);
  assert.throws(() => chooseProxy([{ id: proxy, url: 'https://x/a.mp4', status: 'GROWING' }]));
  assert.equal(chooseProxy([{ id: 'audio', url: 'https://x/a.mp3', size: 1 }, { id: proxy, url: 'https://x/a.mp4', size: 10 }]).id, proxy);
});
test('local/private storage addresses are rejected', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.0.1', '172.20.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1']) assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
});
test('authenticated import hides credentials, forwards ranges and refreshes expired storage URLs', async () => {
  let calls = [], mediaCalls = 0, proxyCalls = 0;
  const middleware = iconikMiddleware({}, {
    fetch: async (url, options) => {
      calls.push({ url, options });
      const body = url.includes('/proxies/') ? { objects: [{ id: proxy, url: `https://storage.test/${++proxyCalls}.mp4`, status: 'CLOSED', filename: 'proxy.mp4' }] } : { title: 'Interview' };
      return new Response(JSON.stringify(body), { status: 200 });
    },
    openMedia: async (url, headers) => {
      mediaCalls++;
      assert.equal(headers.Range, 'bytes=0-3');
      const stream = Readable.from(mediaCalls === 1 ? [] : [Buffer.from('test')]);
      stream.statusCode = mediaCalls === 1 ? 403 : 206;
      stream.headers = { 'content-type': 'video/mp4', 'content-range': 'bytes 0-3/20', 'content-length': '4' };
      return stream;
    },
  });
  const server = http.createServer((req, res) => middleware(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const connected = await fetch(base + '/api/iconik/connect', { method: 'POST', body: JSON.stringify({ token: 'secret', appId: 'app' }) });
    assert.equal(connected.status, 200);
    const cookie = connected.headers.get('set-cookie').split(';')[0];
    const resolved = await fetch(base + '/api/iconik/resolve', { method: 'POST', headers: { cookie }, body: JSON.stringify({ link: asset }) });
    const data = await resolved.json();
    assert.equal(data.name, 'Interview');
    assert.equal(JSON.stringify(data).includes('secret'), false);
    assert.equal(JSON.stringify(data).includes('storage.test'), false);
    const media = await fetch(base + data.url, { headers: { cookie, range: 'bytes=0-3' } });
    assert.equal(media.status, 206); assert.equal(await media.text(), 'test');
    assert.equal(media.headers.get('content-range'), 'bytes 0-3/20');
    assert.equal(mediaCalls, 2);
    assert.ok(calls.some(c => c.url.includes('bypass_url_cache=true')));
    assert.equal(calls[0].options.headers['Auth-Token'], 'secret');
    const denied = await fetch(base + '/api/iconik/resolve', { method: 'POST', headers: { cookie, Origin: 'https://evil.test' }, body: JSON.stringify({ link: asset }) });
    assert.equal(denied.status, 403);
    const noSession = await fetch(base + data.url);
    assert.equal(noSession.status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
