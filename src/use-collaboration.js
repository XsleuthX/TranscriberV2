import { useEffect, useRef, useState } from 'react';
import { equal, mergeDocuments, projectLink } from './collaboration-core.js';

export function sharedTarget() {
  // Password sign-in submits to a new URL. Restore the invitation fragment
  // saved by the login form without ever sending its access key to that form.
  const invitation = sessionStorage.getItem('transcriber.returnHash');
  if (!window.location.hash && invitation) window.history.replaceState(null, '', window.location.pathname + invitation);
  if (invitation) sessionStorage.removeItem('transcriber.returnHash');
  const params = new URLSearchParams(window.location.hash.slice(1));
  const id = params.get('project'), key = params.get('key');
  return id ? { id, key: key || '' } : null;
}
const typing = () => {
  const el = document.activeElement;
  return el?.closest('.tx') && (el.isContentEditable || ['INPUT', 'TEXTAREA'].includes(el.tagName));
};

export default function useCollaboration({ ready, history, getDocument, applyDocument, documentVersion, settingsVersion, beforeCreate }) {
  const [target] = useState(sharedTarget);
  const [state, setState] = useState({ status: target ? 'Connecting…' : 'Local project', ready: false,
    role: null, revision: 0, people: [], conflict: null, error: '', viewerKey: '', busy: false });
  const [name, setName] = useState(() => localStorage.getItem('transcriber.displayName') || 'Teammate');
  const refs = useRef({}); refs.current.get = getDocument; refs.current.apply = applyDocument;
  const session = useRef({ base: null, revision: 0, role: null, conflict: null, busy: false, stopped: false,
    clientId: crypto.randomUUID().replaceAll('-', ''), name, interacting: false }); session.current.name = name;
  history.setReadOnly(!!target && (!state.ready || state.role !== 'editor'));
  const update = value => setState(s => ({ ...s, ...value }));
  useEffect(() => {
    const s = session.current;
    if (target && s.base && s.role === 'editor' && !s.conflict && !equal(refs.current.get(), s.base))
      update({ status: state.error ? 'Offline · changes kept on this device' : 'Changes pending' });
  }, [documentVersion, ...settingsVersion]);
  const request = async (suffix = '', options = {}, access = target) => {
    const response = await fetch(`/api/collaboration/projects${access ? '/' + access.id : ''}${suffix}`, {
      ...options, headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access.key } : {}), ...options.headers },
      signal: options.signal || AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok && response.status !== 409) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || 'Shared project request failed.');
    return { data, conflict: response.status === 409 };
  };

  useEffect(() => {
    if (!target || !ready) return;
    const s = session.current; let stopped = false, timeout;
    const integrate = data => {
      const local = refs.current.get();
      const result = s.base && data.role === 'editor' ? mergeDocuments(s.base, local, data.document) : { document: data.document, conflicts: [] };
      if (result.conflicts.length) {
        s.conflict = { base: s.base, remote: data.document, revision: data.revision, paths: result.conflicts };
        s.role = data.role;
        update({ ready: true, role: data.role, conflict: s.conflict, status: 'Review conflicting edits', error: '' }); return false;
      }
      s.base = data.document; s.revision = data.revision; s.role = data.role;
      if (!equal(local, result.document)) refs.current.apply(result.document);
      update({ ready: true, role: data.role, revision: data.revision, error: '', status: 'Connected' }); return true;
    };
    const tick = async () => {
      if (s.busy) return;
      s.busy = true;
      try {
        const { data: presence } = await request('/presence', { method: 'POST', body: JSON.stringify({ clientId: s.clientId, name: s.name || 'Teammate' }) });
        if (stopped) return;
        update({ people: presence.people });
        if (s.conflict) return;
        // Defer incoming document updates until a native editor commits on blur.
        // Otherwise an uncommitted contentEditable change has no merge baseline.
        if (s.base && (typing() || s.interacting)) { update({ status: s.role === 'editor' ? 'Editing locally · sync on blur' : 'Connected' }); return; }
        // Resolve this link's role from a full snapshot on first connection.
        // A viewer must not inherit an editor's pending draft from this device.
        const { data } = await request(`?revision=${s.role ? s.revision : 0}`);
        if (stopped) return;
        // An editor can receive focus or begin dragging during the HTTP request.
        if (s.base && (typing() || s.interacting)) return;
        if (!data.unchanged && !integrate(data)) return;
        if (data.unchanged) { s.role = data.role; update({ ready: true, role: data.role, revision: s.revision }); }
        if (s.role === 'editor') {
          const snapshot = refs.current.get();
          if (!equal(snapshot, s.base)) {
            update({ status: 'Syncing…' });
            const response = await request('', { method: 'PUT', body: JSON.stringify({ revision: s.revision, document: snapshot }) });
            if (stopped) return;
            if (response.conflict) { if (!typing() && !s.interacting) integrate(response.data); return; }
            // Local actions may have happened during the request. Keep those
            // pending while advancing the acknowledged baseline.
            s.base = response.data.document; s.revision = response.data.revision;
            update({ revision: s.revision, status: equal(refs.current.get(), s.base) ? 'All changes shared' : 'Changes pending', error: '' });
          } else update({ status: 'All changes shared', error: '' });
        } else update({ status: 'Live · view only', error: '' });
      } catch (error) {
        if (!stopped) update({ error: error.message, status: s.base ? 'Offline · changes kept on this device' : 'Unable to open shared project' });
      } finally {
        s.busy = false;
      }
    };
    const loop = async () => { await tick(); if (!stopped) timeout = setTimeout(loop, 1500); };
    void loop();
    const onUnload = event => {
      if (s.base && s.role === 'editor' && (typing() || !equal(refs.current.get(), s.base))) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onUnload);
    const begin = event => { if (event.target.closest?.('.tx')) s.interacting = true; };
    const end = () => { s.interacting = false; };
    window.addEventListener('pointerdown', begin, true); window.addEventListener('dragstart', begin, true);
    for (const type of ['pointerup','pointercancel','dragend','blur']) window.addEventListener(type, end, true);
    return () => {
      stopped = true; clearTimeout(timeout); window.removeEventListener('beforeunload', onUnload);
      window.removeEventListener('pointerdown', begin, true); window.removeEventListener('dragstart', begin, true);
      for (const type of ['pointerup','pointercancel','dragend','blur']) window.removeEventListener(type, end, true);
    };
  }, [ready, target]);

  const run = async action => {
    update({ busy: true, error: '' });
    try { return await action(); } catch (error) { update({ error: error.message }); }
    finally { update({ busy: false }); }
  };
  const create = () => run(async () => {
    document.activeElement?.blur();
    // A tick lets native blur handlers commit their last edit before publishing.
    await new Promise(resolve => setTimeout(resolve, 0));
    await beforeCreate?.();
    const { data } = await request('', { method: 'POST', body: JSON.stringify({ document: refs.current.get() }) }, null);
    window.location.assign(projectLink(window.location, data.id, data.editorKey)); window.location.reload();
  });
  const newViewerLink = () => run(async () => {
    const { data } = await request('/links', { method: 'POST', body: '{}' }); update({ viewerKey: data.viewerKey });
  });
  const resolve = preference => {
    const s = session.current, conflict = s.conflict; if (!conflict) return;
    const result = mergeDocuments(conflict.base, refs.current.get(), conflict.remote, preference);
    s.base = conflict.remote; s.revision = conflict.revision; s.conflict = null;
    refs.current.apply(result.document);
    update({ conflict: null, revision: s.revision, status: 'Changes pending', error: '' });
  };
  const upload = (file, assetKey, onUploaded) => run(async () => {
    const { data } = await request('/media', { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
      signal: AbortSignal.timeout(30 * 60 * 1000) });
    onUploaded(assetKey, { id: data.id, name: file.name });
  });
  const mediaURL = fileId => `/api/collaboration/projects/${target.id}/media/${fileId}?key=${encodeURIComponent(target.key)}`;
  return { ...state, target, name, setName: value => { setName(value); localStorage.setItem('transcriber.displayName', value); },
    create, newViewerLink, resolve, upload, mediaURL, canCreate: ready,
    hydrate: checkpoint => { if (checkpoint?.base && Number.isSafeInteger(checkpoint.revision)) { session.current.base = checkpoint.base; session.current.revision = checkpoint.revision; } },
    checkpoint: () => ({ base: session.current.base, revision: session.current.revision }),
    editorLink: target && state.role === 'editor' ? projectLink(window.location, target.id, target.key) : '',
    viewerLink: state.viewerKey ? projectLink(window.location, target.id, state.viewerKey) : '',
    local: () => window.location.assign(window.location.pathname + window.location.search) };
}
