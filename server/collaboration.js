import path from 'node:path';
import { mkdir, readFile, rename, open, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { json, readBody, sameOrigin } from './access.js';
import { importProjectJSON } from '../src/project-json.js';
import { cleanActivity, emptyDiscussion, validateDiscussion, registerMember, applyDiscussionOperation, participantColour } from '../src/collaboration-activity.js';

const idPattern = /^[a-f0-9]{32}$/;
const token = () => randomBytes(24).toString('hex');
const digest = value => createHash('sha256').update(value).digest('hex');
const matches = (key, hash) => typeof key === 'string' && /^[a-f0-9]{48}$/.test(key) &&
  typeof hash === 'string' && hash.length === 64 && timingSafeEqual(Buffer.from(digest(key)), Buffer.from(hash));
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function validateSharedDocument(doc) {
  if (!doc || !doc.settings || typeof doc.settings.projectName !== 'string' || doc.settings.projectName.length > 300)
    fail(400, 'A project title of up to 300 characters is required.');
  // Reuse the project interchange validator, then take only validated fields.
  // This also rejects prototype keys and strips playback/session URLs.
  let clean;
  try { clean = importProjectJSON(JSON.stringify({ format: 'transcriber-project', version: 1,
    project: { ...doc, ui: doc.settings, activeAsset: null } })); }
  catch (error) { fail(400, error.message); }
  const { media, rows, mtl, rules, reviews, vet, ui: settings } = clean;
  for (const asset of Object.values(media)) {
    delete asset.url; delete asset.offline; delete asset.pcm; delete asset.pcmRate;
    if (asset.sharedFile && (!idPattern.test(asset.sharedFile.id) || typeof asset.sharedFile.name !== 'string'))
      fail(400, 'Invalid shared media identity.');
  }
  return { media, rows, mtl, rules, reviews, vet, settings };
}

// One Node process owns this durable store. Each project operation is queued,
// so a compare-and-swap check and atomic rename form a single transaction.
export function collaborationMiddleware(env = {}, options = {}) {
  const root = path.resolve(env.COLLAB_DATA_DIR || 'data/collaboration');
  const locks = new Map(), presence = new Map();
  const locked = async (id, action) => {
    const previous = locks.get(id) || Promise.resolve();
    const work = previous.catch(() => {}).then(action); locks.set(id, work);
    try { return await work; } finally { if (locks.get(id) === work) locks.delete(id); }
  };
  async function load(id) {
    try { return JSON.parse(await readFile(path.join(root, id + '.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') fail(404, 'Shared project not found.'); throw error; }
  }
  async function persist(record) {
    await mkdir(root, { recursive: true });
    const temp = path.join(root, record.id + '.' + token() + '.tmp');
    const file = await open(temp, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
    try {
      // Windows can briefly deny replacing a file opened by a reader/scanner.
      // Keep the old record intact and retry the same atomic rename in-place.
      for(let attempt=0;;attempt++){
        try{await rename(temp,path.join(root,record.id+'.json'));break;}
        catch(error){if(attempt>=4||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;await new Promise(resolve=>setTimeout(resolve,10*3**attempt));}
      }
    }
    finally { await unlink(temp).catch(() => {}); }
  }
  const publicRecord = (record, role) => ({ id: record.id, revision: record.revision,
    document: record.document, updatedAt: record.updatedAt, role });
  const middleware = async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/collaboration/')) return next();
    try {
      if (!sameOrigin(req, env)) fail(403, 'Open the configured app address.');
      if (url.pathname === '/api/collaboration/projects' && req.method === 'POST') {
        const input = JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString());
        const editorKey = token(), viewerKey = token();
        const record = { id: randomBytes(16).toString('hex'), revision: 1,
          editorHash: digest(editorKey), viewerHash: digest(viewerKey),
          document: validateSharedDocument(input.document), discussion: validateDiscussion(input.discussion), updatedAt: new Date().toISOString() };
        await persist(record);
        return json(res, 201, { ...publicRecord(record, 'editor'), editorKey, viewerKey });
      }
      const route = /^\/api\/collaboration\/projects\/([a-f0-9]{32})(?:\/(presence|discussion|links|media)(?:\/([a-f0-9]{32}))?)?$/.exec(url.pathname);
      if (!route) fail(404, 'Unknown collaboration route.');
      const [, id, operation, mediaId] = route;
      const key = req.headers.authorization?.replace(/^Bearer /, '') || (operation === 'media' && req.method === 'GET' ? url.searchParams.get('key') : '');
      // All record reads share the writer queue. This also avoids Windows
      // reader handles racing the atomic replacement of the project record.
      const record = await locked(id,()=>load(id));
      const role = matches(key, record.editorHash) ? 'editor' : matches(key, record.viewerHash) ? 'viewer' : null;
      if (!role) fail(403, 'This project link is invalid. Ask an editor for a new link.');
      if (operation === 'links' && req.method === 'POST') {
        if (role !== 'editor') fail(403, 'Only editors can manage project links.');
        return await locked(id, async () => {
          const current = await load(id), viewerKey = token();
          // Mint a new viewer link, invalidating the previous one. Editor access
          // is the link already held by this editor; hashes are never returned.
          current.viewerHash = digest(viewerKey); await persist(current);
          return json(res, 200, { viewerKey });
        });
      }
      if (operation === 'presence' && req.method === 'POST') {
        const input = JSON.parse((await readBody(req, 16000)).toString());
        if (!idPattern.test(input.clientId) || typeof input.name !== 'string' || !input.name.trim()) fail(400, 'Enter a display name.');
        const participantId = input.participantId || input.clientId;
        if (!idPattern.test(participantId)) fail(400, 'Invalid participant identity.');
        let activity;
        try { activity = cleanActivity(input.activity); } catch (error) { fail(400, error.message); }
        const people = presence.get(id) || new Map(); presence.set(id, people);
        const now = Date.now();
        for (const [clientId, person] of people) if (person.seen < now - 15000) people.delete(clientId);
        if (people.size >= 100 && !people.has(input.clientId)) fail(429, 'This project has too many active participants.');
        let discussion = record.discussion || emptyDiscussion();
        if (input.participantId && !discussion.members.some(m => m.id === participantId && m.name === input.name.trim().slice(0,60))) {
          discussion = await locked(id, async () => {
            const current = await load(id);
            try { current.discussion = registerMember(current.discussion || emptyDiscussion(), participantId, input.name.trim().slice(0,60), new Date(now).toISOString()); }
            catch (error) { fail(400, error.message); }
            await persist(current); return current.discussion;
          });
        }
        // Older clients only have a per-page ID. Keep their presence working,
        // but don't offer that temporary identity for durable action assignments.
        const member = discussion.members.find(m => m.id === participantId) || {name:input.name.trim().slice(0,60),colour:participantColour(participantId)};
        people.set(input.clientId, { name: member.name, participantId, colour: member.colour, role, activity, seen: now });
        return json(res, 200, { people: [...people].map(([clientId, person]) => ({ clientId, name: person.name, participantId: person.participantId,
          colour: person.colour, role: person.role, activity: now - person.seen < 5000 ? person.activity : null })), members: discussion.members });
      }
      if (operation === 'discussion' && req.method === 'GET') {
        const discussion = record.discussion || emptyDiscussion();
        return json(res, 200, url.searchParams.get('revision') === String(discussion.revision) ? { unchanged: true, revision: discussion.revision } : discussion);
      }
      if (operation === 'discussion' && req.method === 'POST') {
        if (role !== 'editor') fail(403, 'Viewers can read comments. An editor link is needed to reply or assign actions.');
        const input = JSON.parse((await readBody(req, 24000)).toString());
        const active = presence.get(id)?.get(input.clientId);
        if (!active || active.participantId !== input.participantId || active.seen < Date.now() - 15000) fail(403, 'Reconnect to the project before commenting.');
        return await locked(id, async () => {
          const current = await load(id), discussion = current.discussion || emptyDiscussion();
          const actor = discussion.members.find(m => m.id === input.participantId);
          try { current.discussion = applyDiscussionOperation(discussion, input.operation, actor, new Date().toISOString()); }
          catch (error) { fail(400, error.message); }
          if (Buffer.byteLength(JSON.stringify(current.discussion)) > 8 * 1024 * 1024) fail(413, 'This project has reached its 8 MiB comment archive limit.');
          if (current.discussion !== discussion) await persist(current);
          return json(res, 200, current.discussion);
        });
      }
      if (operation === 'media' && req.method === 'PUT' && !mediaId) {
        if (role !== 'editor') fail(403, 'Viewers cannot upload media.');
        const mime = req.headers['content-type']?.split(';')[0];
        if (!/^(video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|wav|x-wav|webm|ogg|flac))$/.test(mime || '')) fail(415, 'Upload an MP4, WebM, MOV or supported audio file.');
        const limit = Number(env.COLLAB_MAX_MEDIA_BYTES) || 2 * 1024 ** 3;
        if (Number(req.headers['content-length']) > limit) fail(413, 'Media exceeds the shared upload size limit.');
        const folder = path.join(root, id); await mkdir(folder, { recursive: true });
        const fileId = randomBytes(16).toString('hex'), target = path.join(folder, fileId);
        const file = await open(target + '.tmp', 'wx', 0o600); let size = 0;
        try {
          for await (const part of req) { size += part.length; if (size > limit) fail(413, 'Media exceeds the shared upload size limit.'); await file.writeFile(part); }
          if (!size) fail(400, 'The media file is empty.');
          await file.sync(); await file.close();
          await rename(target + '.tmp', target);
          await locked(id, async () => {
            const current = await load(id); current.files ||= {}; current.files[fileId] = { mime, size }; await persist(current);
          });
        } catch (error) { await file.close().catch(() => {}); await unlink(target + '.tmp').catch(() => {}); await unlink(target).catch(() => {}); throw error; }
        return json(res, 201, { id: fileId, size });
      }
      if (operation === 'media' && req.method === 'GET' && mediaId) {
        const meta = record.files?.[mediaId]; if (!meta) fail(404, 'Shared media not found.');
        const file = path.join(root, id, mediaId); await stat(file);
        let start = 0, end = meta.size - 1;
        if (req.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!range || (!range[1] && !range[2])) { res.setHeader('Content-Range', `bytes */${meta.size}`); return res.writeHead(416).end(); }
          if (!range[1]) start = Math.max(0, meta.size - Number(range[2]));
          else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= meta.size) { res.setHeader('Content-Range', `bytes */${meta.size}`); return res.writeHead(416).end(); }
          res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${meta.size}`);
        }
        res.setHeader('Content-Type', meta.mime); res.setHeader('Accept-Ranges', 'bytes'); res.setHeader('Content-Length', end - start + 1);
        const stream = createReadStream(file, { start, end }); res.once('close', () => stream.destroy()); stream.on('error', () => res.destroy()).pipe(res); return;
      }
      if (!operation && req.method === 'GET') {
        if (url.searchParams.get('revision') === String(record.revision)) return json(res, 200, { revision: record.revision, role, unchanged: true });
        return json(res, 200, publicRecord(record, role));
      }
      if (!operation && req.method === 'PUT') {
        if (role !== 'editor') fail(403, 'This is a viewer link. Ask for an editor link to make changes.');
        const input = JSON.parse((await readBody(req, 16 * 1024 * 1024)).toString());
        return await locked(id, async () => {
          const current = await load(id);
          if (input.revision !== current.revision) return json(res, 409, publicRecord(current, role));
          current.document = validateSharedDocument(input.document); current.revision++; current.updatedAt = new Date().toISOString();
          await persist(current); return json(res, 200, publicRecord(current, role));
        });
      }
      fail(405, 'Method not allowed.');
    } catch (error) {
      if(!error.status && !(error instanceof SyntaxError))options.onError?.(error);
      if (!res.headersSent) json(res, error.status || (error instanceof SyntaxError ? 400 : 500),
        { error: error.status || error instanceof SyntaxError ? error.message : 'Unable to access shared project storage.' });
      else res.destroy();
    }
  };
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, people] of presence) { for (const [key, person] of people) if (person.seen < now - 15000) people.delete(key); if (!people.size) presence.delete(id); }
  }, 15000); cleanup.unref();
  middleware.close = () => clearInterval(cleanup);
  return middleware;
}
