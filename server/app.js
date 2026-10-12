import http from 'node:http';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { iconikMiddleware } from './iconik.js';
import { mediaMiddleware } from './media.js';
import { providerMiddleware } from './providers.js';
import { sameOrigin, json, readBody } from './access.js';

const loginPage = (failed = false) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in · Transcriber</title><style>body{background:#eef1f5;font:16px system-ui;color:#24313d;margin:0;display:grid;min-height:100vh;place-items:center}main{background:white;padding:36px;border-radius:12px;width:min(360px,80vw)}input,button{box-sizing:border-box;padding:12px;width:100%;margin-top:12px;font:inherit}button{background:#267181;color:white;border:0;border-radius:5px}</style><main><h1>Transcriber</h1><p>Enter your workspace password to continue.</p>${failed ? '<p role="alert">Sign-in failed. Try again shortly.</p>' : ''}<form method="post" action="/auth/login"><label>Workspace password<input type="password" name="password" required autocomplete="current-password" maxlength="256"></label><button>Sign in</button></form></main></html>`;
export function createAppServer(env = {}, options = {}) {
  const hosted = env.NODE_ENV === 'production';
  if (hosted && (!env.APP_PASSWORD || env.APP_PASSWORD.length < 16 || !env.APP_ORIGIN))
    throw new Error('Production requires APP_ORIGIN and an APP_PASSWORD of at least 16 characters.');
  if (env.APP_ORIGIN) {
    const origin = new URL(env.APP_ORIGIN);
    if (origin.origin !== env.APP_ORIGIN || origin.username || origin.password ||
      (hosted && origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)))
      throw new Error('APP_ORIGIN must be an exact HTTPS origin (HTTP allowed for localhost testing).');
  }
  const dist = path.resolve(options.dist || 'dist'), sessions = new Map();
  const salt = randomBytes(16), passwordHash = env.APP_PASSWORD ? scryptSync(env.APP_PASSWORD, salt, 32) : null;
  const failures = []; // One shared workspace; bound login attempts without trusting proxy headers.
  const middleware = [mediaMiddleware(env), iconikMiddleware(env, options.iconik), providerMiddleware(env, options.providers)];
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Cache-Control', 'no-store');
    if (env.APP_ORIGIN?.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz' && req.method === 'GET') return json(res, 200, { ok: true });
      if (!sameOrigin(req, env, !url.pathname.startsWith('/api/'))) return json(res, 403, { error: 'Open the configured app address.' });
      for (const [id, expiry] of sessions) if (expiry < Date.now()) sessions.delete(id);
      const session = /(?:^|;\s*)transcriber_session=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (url.pathname === '/auth/logout' && req.method === 'POST') {
        sessions.delete(session); res.setHeader('Set-Cookie', 'transcriber_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        res.statusCode = 303; res.setHeader('Location', '/'); return res.end();
      }
      if (passwordHash && url.pathname === '/auth/login' && req.method === 'POST') {
        while (failures.length && failures[0] < Date.now() - 60000) failures.shift();
        if (failures.length >= 10) { res.statusCode = 429; res.setHeader('Retry-After', '60'); res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(loginPage(true)); }
        const value = new URLSearchParams((await readBody(req, 2048)).toString()).get('password') || '';
        if (value.length > 256 || !timingSafeEqual(passwordHash, scryptSync(value, salt, 32))) {
          failures.push(Date.now()); res.statusCode = 401; res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(loginPage(true));
        }
        if (sessions.size >= 100) return json(res, 429, { error: 'Too many sessions. Try later.' });
        const id = randomBytes(24).toString('hex'); sessions.set(id, Date.now() + 12 * 3600000);
        res.setHeader('Set-Cookie', `transcriber_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${env.APP_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`);
        res.statusCode = 303; res.setHeader('Location', '/'); return res.end();
      }
      if (passwordHash && !sessions.has(session)) {
        if (url.pathname.startsWith('/api/')) return json(res, 401, { error: { message: 'Your workspace session expired. Reload and sign in.' } });
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(loginPage());
      }
      let index = 0;
      const next = async () => {
        if (index < middleware.length) return middleware[index++](req, res, next);
        if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Unknown API route.' });
        if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'GET only.' });
        const name = decodeURIComponent(url.pathname), candidate = path.resolve(dist, '.' + name);
        if (candidate !== dist && !candidate.startsWith(dist + path.sep)) return json(res, 404, { error: 'Not found.' });
        let file = candidate === dist ? path.join(dist, 'index.html') : candidate;
        try { if (!(await stat(file)).isFile()) throw new Error(); }
        catch { if (path.extname(name)) return json(res, 404, { error: 'Not found.' }); file = path.join(dist, 'index.html'); }
        file = await realpath(file);
        if (!file.startsWith((await realpath(dist)) + path.sep)) return json(res, 404, { error: 'Not found.' });
        const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.mp4': 'video/mp4', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
        res.setHeader('Content-Type', mime); res.setHeader('Content-Length', (await stat(file)).size);
        if (file.includes(path.sep + 'assets' + path.sep)) res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        if (req.method === 'HEAD') return res.end();
        createReadStream(file).on('error', () => res.destroy()).pipe(res);
      };
      await next();
    } catch (error) { if (!res.headersSent) json(res, error.status || 500, { error: 'The server could not complete this request.' }); else res.destroy(); }
  });
  server.requestTimeout = 30 * 60 * 1000;
  server.once('close', () => void middleware[0].close());
  return server;
}
