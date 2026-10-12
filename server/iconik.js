import { sameOrigin } from './access.js';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

const API = 'https://app.iconik.io/API';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function assetIdFromLink(input) {
  const value = String(input || '').trim();
  if (UUID.test(value)) return value;
  let url;
  try { url = new URL(value); } catch { throw new Error('Paste an Iconik asset URL or asset UUID.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'app.iconik.io' || url.username || url.password)
    throw new Error('Use a signed-in asset link from https://app.iconik.io.');
  const parts = (url.pathname + '/' + url.hash.replace(/^#\/?/, '')).split('/');
  const i = parts.findIndex(p => p === 'asset' || p === 'assets');
  if (i < 0 || !UUID.test(parts[i + 1] || '')) throw new Error('This is not an asset link. Share and collection links are not supported; open the asset and copy its URL.');
  return parts[i + 1];
}
export function chooseProxy(proxies, requested) {
  const usable = proxies.filter(p => p.url && (!p.status || p.status === 'CLOSED') &&
    (/\.(mp4|m4a|mp3|wav|webm)(?:\?|$)/i.test(p.filename || p.url) || /^(mp4|m4a|mp3|wav|webm)$/i.test(p.format || '')));
  const video = p => /\.(mp4|webm)(?:\?|$)/i.test(p.filename || p.url) || /^(mp4|webm)$/i.test(p.format || '');
  const selected = requested ? usable.find(p => p.id === requested) :
    [...usable].sort((a, b) => Number(video(b)) - Number(video(a)) || (a.size || Infinity) - (b.size || Infinity))[0];
  if (!selected) throw new Error('No completed MP4/WebM/audio proxy is available. Ask your Iconik administrator to generate a downloadable proxy. HLS-only and DRM proxies are not supported.');
  return selected;
}
export function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  // Restrict IPv6 to global unicast; reject mapped IPv4 and local/link-local.
  return net.isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address);
}
const safeLookup = (host, options, callback) => lookup(host, { all: true }, (error, addresses) => {
  if (error) return callback(error);
  if (!addresses.length || addresses.some(a => !publicAddress(a.address))) return callback(new Error('Proxy storage must use a public network address.'));
  if (options.all) callback(null, addresses);
  else callback(null, addresses[0].address, addresses[0].family);
});
export function openMedia(input, headers = {}, signal, redirects = 0) {
  return new Promise((resolve, reject) => {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      (net.isIP(url.hostname.replace(/[\[\]]/g, '')) && !publicAddress(url.hostname.replace(/[\[\]]/g, ''))))
      return reject(new Error('Proxy storage must use public HTTPS.'));
    const request = https.get(url, { headers, lookup: safeLookup, signal }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 3 || !response.headers.location) return reject(new Error('Invalid storage redirect.'));
        resolve(openMedia(new URL(response.headers.location, url), headers, signal, redirects + 1));
      } else resolve(response);
    });
    request.setTimeout(60000, () => request.destroy(new Error('Storage request timed out.')));
    request.on('error', reject);
  });
}
const json = (res, code, value) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
async function bodyJson(req) {
  let body = '';
  for await (const part of req) { body += part; if (body.length > 16384) throw new Error('Request too large.'); }
  return JSON.parse(body || '{}');
}
export function iconikMiddleware(env = {}, deps = {}) {
  const apiFetch = deps.fetch || fetch, streamMedia = deps.openMedia || openMedia;
  const sessions = new Map();
  const signed = new Map();
  const getSession = req => {
    const id = /(?:^|;\s*)transcriber_iconik=([a-f0-9]{48})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    const session = sessions.get(id);
    if (session && session.expires > Date.now()) return { ...session, id };
    if (id) sessions.delete(id);
    if (env.ICONIK_AUTH_TOKEN) return { id: 'env', token: env.ICONIK_AUTH_TOKEN, appId: env.ICONIK_APP_ID };
    throw new Error('Connect Iconik with an API token, or set ICONIK_AUTH_TOKEN on the server.');
  };
  async function api(route, session) {
    const headers = session.appId ? { 'App-ID': session.appId, 'Auth-Token': session.token } : { Authorization: `Bearer ${session.token}` };
    const response = await apiFetch(API + route, { headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new Error(response.status === 401 ? 'Iconik credentials expired or are invalid. Reconnect in Media Pool.' :
      response.status === 403 ? 'Iconik denied access. The token needs read access to this asset and its proxies.' :
      response.status === 404 ? 'Iconik asset or proxy not found.' : `Iconik returned HTTP ${response.status}. Try again shortly.`);
    return response.json();
  }
  async function proxies(assetId, session, fresh = false) {
    let objects = [], last = '';
    for (let page = 0; page < 20; page++) {
      const data = await api(`/files/v1/assets/${assetId}/proxies/?per_page=100&generate_signed_url=true&bypass_url_cache=${fresh}${last ? `&last_id=${encodeURIComponent(last)}` : ''}`, session);
      const batch = data.objects || [];
      objects.push(...batch);
      if (batch.length < 100 || batch.at(-1)?.id === last) break;
      last = batch.at(-1).id;
    }
    return objects;
  }
  async function proxyUrl(assetId, proxyId, session, fresh = false) {
    const key = `${session.id}:${assetId}:${proxyId}`;
    const cached = signed.get(key);
    if (!fresh && cached?.until > Date.now()) return cached.url;
    const proxy = chooseProxy(await proxies(assetId, session, fresh), proxyId);
    if (signed.size > 1000) signed.clear();
    signed.set(key, { url: proxy.url, until: Date.now() + 60000 });
    return proxy.url;
  }
  async function upstream(asset, proxy, session, headers, signal) {
    let response = await streamMedia(await proxyUrl(asset, proxy, session), headers, signal);
    if ([401, 403].includes(response.statusCode)) {
      response.resume();
      response = await streamMedia(await proxyUrl(asset, proxy, session, true), headers, signal);
    }
    return response;
  }
  return async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (!pathname.startsWith('/api/iconik/')) return next();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!sameOrigin(req, env)) return json(res, 403, { error: 'Open the app from its configured address.' });
    const controller = new AbortController();
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    let folder;
    try {
      if (pathname === '/api/iconik/connect' && req.method === 'POST') {
        const body = await bodyJson(req);
        const session = body.token ? { token: String(body.token), appId: String(body.appId || '') } : getSession(req);
        await api('/auth/v1/auth/token/', session);
        for (const [id, value] of sessions) if (value.expires < Date.now()) sessions.delete(id);
        if (sessions.size > 100) throw new Error('Too many active sessions. Restart the local server.');
        const id = randomBytes(24).toString('hex');
        sessions.set(id, { ...session, expires: Date.now() + 12 * 3600000 });
        res.setHeader('Set-Cookie', `transcriber_iconik=${id}; HttpOnly; SameSite=Strict; Path=/api/iconik; Max-Age=43200${env.APP_ORIGIN?.startsWith('https:') ? '; Secure' : ''}`);
        return json(res, 200, { connected: true });
      }
      const session = getSession(req);
      if (pathname === '/api/iconik/resolve' && req.method === 'POST') {
        const body = await bodyJson(req), assetId = assetIdFromLink(body.link);
        const [asset, list] = await Promise.all([api(`/assets/v1/assets/${assetId}/`, session), proxies(assetId, session, true)]);
        const proxy = chooseProxy(list, body.proxyId);
        return json(res, 200, { assetId, proxyId: proxy.id, name: asset.title || proxy.filename || assetId,
          url: `/api/iconik/media/${assetId}/${proxy.id}`, audioUrl: `/api/iconik/audio/${assetId}/${proxy.id}`,
          startTc: proxy.start_time_code || '', proxyName: proxy.filename || proxy.name || 'Proxy' });
      }
      const match = /^\/api\/iconik\/(media|audio)\/([^/]+)\/([^/]+)$/.exec(pathname);
      if (!match || !UUID.test(match[2]) || !UUID.test(match[3])) return json(res, 404, { error: 'Unknown Iconik endpoint.' });
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'GET or HEAD required.' });
      const [, kind, assetId, proxyId] = match;
      if (kind === 'media') {
        const headers = req.headers.range ? { Range: req.headers.range } : {};
        const response = await upstream(assetId, proxyId, session, headers, controller.signal);
        if (![200, 206, 416].includes(response.statusCode)) { response.resume(); throw new Error(`Proxy storage returned HTTP ${response.statusCode}.`); }
        res.statusCode = response.statusCode;
        for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (response.headers[key]) res.setHeader(key, response.headers[key]);
        if (req.method === 'HEAD') { response.destroy(); return res.end(); }
        await pipeline(response, res);
        return;
      }
      folder = await mkdtemp(path.join(tmpdir(), 'transcriber-iconik-'));
      const input = path.join(folder, 'proxy'), output = path.join(folder, 'audio.f32');
      const response = await upstream(assetId, proxyId, session, {}, controller.signal);
      if (response.statusCode !== 200) { response.resume(); throw new Error(`Audio download failed (HTTP ${response.statusCode}).`); }
      let bytes = 0;
      const limit = new Transform({ transform(chunk, encoding, done) {
        bytes += chunk.length;
        done(bytes > 4 * 1024 ** 3 ? new Error('Proxy exceeds the 4 GB extraction limit. Select a smaller proxy.') : null, chunk);
      } });
      await pipeline(response, limit, createWriteStream(input), { signal: controller.signal });
      await new Promise((resolve, reject) => {
        const child = spawn(env.FFMPEG_PATH || ffmpeg, ['-nostdin', '-v', 'error', '-i', input,
          '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-fs', '1073741824', output],
        { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], signal: controller.signal });
        child.stderr.resume();
        child.on('error', () => reject(new Error('Audio extraction could not start. Reinstall dependencies or set FFMPEG_PATH.')));
        child.on('close', code => code === 0 ? resolve() : reject(new Error('Audio extraction failed. The proxy may have no audio or use an unsupported codec.')));
      });
      const info = await stat(output);
      if (!info.size || info.size >= 1073741824) throw new Error('Audio is empty or exceeds the extraction limit. Use a shorter asset.');
      res.setHeader('Content-Type', 'application/octet-stream'); res.setHeader('Content-Length', info.size);
      await pipeline(createReadStream(output), res);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) json(res, 400, { error: error.message });
      else res.destroy();
    } finally {
      if (folder) await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    }
  };
}
export function iconikPlugin(env) {
  const install = server => { server.middlewares.use(iconikMiddleware(env)); };
  return { name: 'iconik-media', configureServer: install, configurePreviewServer: install };
}
