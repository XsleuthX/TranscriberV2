import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { mediaMiddleware } from '../server/media.js';
import { readSlice } from '../src/media-ingest.js';

test('a rejected arrayBuffer recovers via alternate reader without blaming file location', async () => {
  let calls = 0;
  const blob = { size: 4, arrayBuffer: async () => { throw Object.assign(new Error('read failed'), { name: 'NotReadableError' }); } };
  assert.equal((await readSlice(blob, { reader: async () => { calls++; return new ArrayBuffer(4); } })).byteLength, 4);
  assert.equal(calls, 1);
});
test('transient reads retry; persistent failures are accurate and bounded', async () => {
  let calls = 0;
  const blob = { size: 4, arrayBuffer: async () => { if (++calls < 3) throw new Error('busy'); return new ArrayBuffer(4); } };
  assert.equal((await readSlice(blob, { reader: async () => { throw new Error('busy'); }, delay: async () => {} })).byteLength, 4);
  assert.equal(calls, 3);
  await assert.rejects(readSlice({ size: 4, arrayBuffer: async () => new ArrayBuffer(2) }, { reader: async () => new ArrayBuffer(2), delay: async () => {} }), /may still exist/);
});
test('media chunks stage a complete camera file, isolate ownership and extract real audio', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'media-test-'));
  const middleware = mediaMiddleware({ MEDIA_TEMP_DIR: directory });
  const server = http.createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/api/media/`;
  try {
    const file = path.join(directory, 'camera.mp4');
    const made = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', file], { windowsHide: true });
    assert.equal(made.status, 0, made.stderr?.toString());
    const bytes = await readFile(file);
    const start = await fetch(base + 'start', { method: 'POST', body: JSON.stringify({ size: bytes.length }) });
    assert.equal(start.status, 201);
    const cookie = start.headers.get('set-cookie').split(';')[0], { id } = await start.json();
    const request = (route, opts = {}) => fetch(base + route + '?id=' + id, { ...opts, headers: { cookie, ...opts.headers } });
    assert.equal((await fetch(base + 'status?id=' + id)).status, 404);
    assert.equal((await request('finish', { method: 'POST' })).status, 409);
    const split = Math.floor(bytes.length / 2);
    for (const [offset, data] of [[0, bytes.subarray(0, split)], [split, bytes.subarray(split)]]) {
      const result = await fetch(base + `chunk?id=${id}&offset=${offset}`, { method: 'POST', headers: { cookie }, body: data });
      assert.equal(result.status, 200);
    }
    assert.equal((await request('finish', { method: 'POST' })).status, 202);
    let status;
    for (let i = 0; i < 100; i++) {
      status = await (await request('status')).json();
      if (['ready', 'failed'].includes(status.state)) break;
      await new Promise(r => setTimeout(r, 30));
    }
    assert.equal(status.state, 'ready', status.error);
    const samples = new Float32Array(await (await request('audio')).arrayBuffer());
    assert.ok(samples.length >= 16000 && samples.length < 17000);
    assert.ok(samples.some(v => Math.abs(v) > .01));
    assert.ok(samples.every(Number.isFinite));
    assert.equal((await request('delete', { method: 'DELETE' })).status, 200);
    assert.equal((await request('status')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await middleware.close(); await rm(directory, { recursive: true, force: true }); }
});
