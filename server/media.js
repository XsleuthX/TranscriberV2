import { randomBytes } from 'node:crypto';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { sameOrigin, json, readBody } from './access.js';

export function mediaMiddleware(env = {}) {
  const jobs = new Map(), queue = []; let running = false;
  const maxSize = Number(env.MAX_MEDIA_BYTES) || 5 * 1024 ** 3;
  const ownerOf = req => /(?:^|;\s*)transcriber_media=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  async function remove(job) { jobs.delete(job.id); await rm(job.folder, { recursive: true, force: true }); }
  async function work() {
    if (running) return;
    running = true;
    try {
      while (queue.length) {
        const job = queue.shift();
        if (!jobs.has(job.id)) continue;
        job.state = 'extracting';
        try {
          await new Promise((resolve, reject) => {
            const child = spawn(env.FFMPEG_PATH || ffmpeg, ['-nostdin', '-v', 'error', '-y', '-i', job.input,
              '-vn', '-ac', '1', '-ar', '16000', '-t', '7201', '-f', 'f32le', job.audio], { windowsHide: true });
            job.child = child;
            const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
            child.on('error', reject);
            child.on('close', code => { clearTimeout(timer); job.child = null;
              code === 0 ? resolve() : reject(new Error('Audio could not be extracted. Check that this media contains a supported audio track.')); });
          });
          const size = (await stat(job.audio)).size;
          if (!size) throw new Error('This media has no audio samples.');
          if (size > 7200 * 16000 * 4) throw new Error('Media longer than two hours must be divided before importing.');
          job.state = 'ready';
          await rm(job.input, { force: true });
        } catch (error) { job.state = 'failed'; job.error = error.message; }
        job.touched = Date.now();
      }
    } finally { running = false; }
  }
  const sweeper = setInterval(() => {
    for (const job of jobs.values()) if (!job.child && Date.now() - job.touched > 3600000) void remove(job);
  }, 60000); sweeper.unref();
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/media/')) return next();
    if (!sameOrigin(req, env)) return json(res, 403, { error: 'Open the app from its configured address.' });
    let job;
    try {
      const route = url.pathname.slice('/api/media/'.length);
      if (route === 'start' && req.method === 'POST') {
        const body = JSON.parse((await readBody(req, 1024)).toString());
        if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > maxSize)
          return json(res, 413, { error: `Media must be between 1 byte and ${Math.floor(maxSize / 1024 ** 3)} GB.` });
        if (jobs.size >= 12) return json(res, 429, { error: 'Audio preparation is busy. Try again after current imports finish.' });
        const owner = ownerOf(req) || randomBytes(24).toString('hex');
        if (!ownerOf(req)) res.setHeader('Set-Cookie', `transcriber_media=${owner}; HttpOnly; SameSite=Strict; Path=/api/media; Max-Age=43200${env.APP_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`);
        const id = randomBytes(24).toString('hex'), folder = await mkdtemp(path.join(env.MEDIA_TEMP_DIR || tmpdir(), 'transcriber-media-'));
        job = { id, owner, folder, input: path.join(folder, 'input'), audio: path.join(folder, 'audio.f32'), size: body.size, received: 0, state: 'uploading', touched: Date.now() };
        jobs.set(id, job);
        return json(res, 201, { id });
      }
      job = jobs.get(url.searchParams.get('id'));
      if (!job || job.owner !== ownerOf(req)) return json(res, 404, { error: 'Media preparation expired. Import it again.' });
      job.touched = Date.now();
      if (route === 'chunk' && req.method === 'POST') {
        if (job.state !== 'uploading' || job.writing || Number(url.searchParams.get('offset')) !== job.received)
          return json(res, 409, { error: 'Upload offset does not match. Import it again.' });
        job.writing = true;
        try {
          const bytes = await readBody(req, 8 * 1024 * 1024);
          if (!bytes.length || job.received + bytes.length > job.size) throw new Error('Incorrect media size.');
          const handle = await open(job.input, 'a');
          try { await handle.writeFile(bytes); } finally { await handle.close(); }
          job.received += bytes.length;
        } finally { job.writing = false; }
        return json(res, 200, { received: job.received });
      }
      if (route === 'finish' && req.method === 'POST') {
        if (job.state !== 'uploading' || job.writing || job.received !== job.size) return json(res, 409, { error: 'Media upload is incomplete.' });
        job.state = 'queued'; queue.push(job); void work();
        return json(res, 202, { state: job.state });
      }
      if (route === 'status' && req.method === 'GET') return json(res, 200, { state: job.state, error: job.error });
      if (route === 'audio' && req.method === 'GET' && job.state === 'ready') {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', (await stat(job.audio)).size);
        res.setHeader('Cache-Control', 'no-store');
        return createReadStream(job.audio).on('error', () => res.destroy()).pipe(res);
      }
      if (route === 'delete' && req.method === 'DELETE') { job.child?.kill(); await remove(job); return json(res, 200, { deleted: true }); }
      return json(res, 400, { error: 'Invalid media operation.' });
    } catch (error) { return json(res, error.status || 400, { error: error.message }); }
  };
  middleware.close = async () => { clearInterval(sweeper); for (const job of jobs.values()) { job.child?.kill(); await remove(job); } };
  return middleware;
}
