import { useCallback, useEffect, useRef, useState } from 'react';

// Decoder/player updates are resources, not editing actions. Retain the newest
// resources when restoring text, timing, Story or timeline snapshots.
const resources = ['url', 'pcm', 'pcmRate', 'duration', 'audioError', 'width', 'height', 'offline', 'size', 'mimeType', 'mediaKind'];
function editable(doc) {
  return JSON.stringify({ ...doc, media: Object.fromEntries(Object.entries(doc.media).map(([key, value]) =>
    [key, Object.fromEntries(Object.entries(value).filter(([field]) => !resources.includes(field)))])) });
}
function retainResources(snapshot, current) {
  return { ...snapshot, media: Object.fromEntries(Object.entries(snapshot.media).map(([key, value]) => {
    const latest = current.media[key];
    return [key, latest ? { ...value, ...Object.fromEntries(resources.filter(field => field in latest).map(field => [field, latest[field]])) } : value];
  })) };
}
export function createDocumentHistory(initial, notify = () => {}) {
  let current = initial, enabled = false, pending = null, gesture = false;
  const past = [], future = [];
  const flush = () => {
    if (pending && editable(pending) !== editable(current)) { past.push(pending); if (past.length > 60) past.shift(); }
    pending = null; notify(current);
  };
  return {
    get current() { return current; }, get canUndo() { return !!pending || past.length > 0; }, get canRedo() { return future.length > 0; },
    enable() { enabled = true; pending = null; past.length = future.length = 0; },
    update(field, change) {
      const next = { ...current, [field]: typeof change === 'function' ? change(current[field]) : change };
      if (enabled && editable(next) !== editable(current)) {
        if (!pending) pending = current;
        future.length = 0;
        if (!gesture) queueMicrotask(() => { if (!gesture) flush(); });
      }
      current = next; notify(current);
    },
    begin() { if (!gesture) { flush(); gesture = true; } },
    end() { gesture = false; flush(); },
    undo() { gesture = false; flush(); if (!past.length) return false; future.push(current); current = retainResources(past.pop(), current); notify(current); return true; },
    redo() { gesture = false; flush(); if (!future.length) return false; past.push(current); current = retainResources(future.pop(), current); notify(current); return true; },
  };
}
export function useDocumentHistory(initializer) {
  const [doc, setDoc] = useState(initializer);
  const ref = useRef(null);
  if (!ref.current) ref.current = createDocumentHistory(doc, setDoc);
  const update = useCallback((field, change) => ref.current.update(field, change), []);
  useEffect(() => {
    // Coalesce pointer drags and text-entry gestures, without merging separate
    // clicks or unrelated asynchronous transcription/AI results.
    const begin = event => { if (event.target.closest('.pill, .tlclip, .ctpill, .mtlclip, input[type="range"]')) ref.current.begin(); };
    const end = () => queueMicrotask(() => ref.current.end());
    window.addEventListener('mousedown', begin, true); window.addEventListener('mouseup', end);
    return () => { window.removeEventListener('mousedown', begin, true); window.removeEventListener('mouseup', end); };
  }, []);
  return { doc, update, history: ref.current };
}
