// Only explicit transcription/alignment owns foreground progress. Cancelling
// invalidates the owner before a replacement task can start.
export function createAudioTasks(onChange) {
  let active = null;
  return {
    get current() { return active; },
    start(details) {
      if (active) return null;
      const controller = new AbortController();
      let percent = 0;
      const task = {
        ...details, signal: controller.signal,
        assert() { controller.signal.throwIfAborted(); },
        report(progress) {
          if (active === task && !controller.signal.aborted) {
            percent = Math.min(100, Math.max(percent, Number(progress.pct) || 0));
            onChange({ ...details, ...progress, pct: percent });
          }
        },
        finish() { if (active === task) { active = null; onChange(null); } },
        cancel() {
          if (active !== task) return;
          active = null;
          controller.abort(new DOMException('Operation cancelled.', 'AbortError'));
          onChange(null);
        },
      };
      active = task;
      task.report({ phase: 'Preparing audio', pct: 0 });
      return task;
    },
    cancel() { active?.cancel(); },
  };
}

// Audio preparation can be shared by import and transcription. Cancelling
// transcription stops waiting without destroying the shared preparation.
export function waitForAudio(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export function runWhisperJob(worker, payload, { signal, onMessage, reset } = {}) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      worker.removeEventListener('message', message);
      worker.removeEventListener('error', failed);
      worker.removeEventListener('messageerror', failed);
      signal?.removeEventListener('abort', aborted);
    };
    const stop = error => { cleanup(); worker.terminate(); reset?.(); reject(error); };
    const aborted = () => stop(signal.reason);
    const failed = event => stop(new Error(event.message || 'The local transcription worker stopped unexpectedly. Try again or select another engine.'));
    const message = event => {
      const data = event.data || {};
      if (data.id !== payload.id || signal?.aborted) return;
      if (data.type === 'result') { cleanup(); resolve(data.out); }
      else if (data.type === 'error') stop(new Error(data.message));
      else onMessage?.(data);
    };
    if (signal?.aborted) { aborted(); return; }
    worker.addEventListener('message', message);
    worker.addEventListener('error', failed);
    worker.addEventListener('messageerror', failed);
    signal?.addEventListener('abort', aborted, { once: true });
    try { worker.postMessage(payload); } catch (error) { stop(error); }
  });
}
