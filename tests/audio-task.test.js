import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioTasks, waitForAudio, runWhisperJob } from '../src/audio-task.js';

test('tasks stay idle until explicitly started, block duplicates and ignore cancelled owners', () => {
  const changes = [], tasks = createAudioTasks(value => changes.push(value));
  assert.equal(tasks.current, null); assert.equal(changes.length, 0);
  const first = tasks.start({ kind: 'transcribe', assetKey: 'a' });
  assert.equal(tasks.start({ kind: 'align', assetKey: 'b' }), null);
  first.report({ phase: 'Listening', pct: 55 }); first.report({ phase: 'Loading', pct: 10 });
  assert.equal(changes.at(-1).pct, 55);
  first.cancel(); assert.equal(changes.at(-1), null); assert.equal(first.signal.aborted, true);
  const second = tasks.start({ kind: 'transcribe', assetKey: 'b' });
  second.report({ phase: 'New request', pct: 30 });
  const count = changes.length;
  first.report({ phase: 'Late response', pct: 99 }); first.finish();
  assert.equal(changes.length, count); assert.equal(tasks.current, second);
  assert.throws(() => first.assert(), { name: 'AbortError' }); second.finish(); assert.equal(tasks.current, null);
});
test('cancelled transcription stops waiting, while shared import preparation can finish', async () => {
  let resolve; const preparation = new Promise(r => { resolve = r; });
  const controller = new AbortController();
  const waiting = waitForAudio(preparation, controller.signal);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(waiting, { name: 'AbortError' });
  resolve('audio'); assert.equal(await preparation, 'audio');
  assert.equal(await waitForAudio(preparation, new AbortController().signal), 'audio');
});
class WorkerStub extends EventTarget {
  postMessage(payload) { this.payload = payload; }
  terminate() { this.stopped = true; }
  send(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
}
test('local worker messages belong to their request; cancellation terminates inference', async () => {
  const worker = new WorkerStub(), controller = new AbortController(), stages = [];
  const waiting = runWhisperJob(worker, { id: 'current' }, { signal: controller.signal, onMessage: data => stages.push(data) });
  worker.send({ id: 'old', type: 'result', out: 'wrong' });
  worker.send({ id: 'old', type: 'error', message: 'wrong error' });
  worker.send({ id: 'current', type: 'stage', stage: 'transcribing' });
  assert.equal(stages.length, 1);
  controller.abort(new DOMException('Cancelled', 'AbortError'));
  await assert.rejects(waiting, { name: 'AbortError' }); assert.equal(worker.stopped, true);
});
test('worker runtime failures reject instead of leaving progress stuck', async () => {
  const worker = new WorkerStub(); let resets = 0;
  const waiting = runWhisperJob(worker, { id: 'current' }, { reset: () => { resets++; } });
  const event = new Event('error'); Object.defineProperty(event, 'message', { value: 'Worker crashed' });
  worker.dispatchEvent(event);
  await assert.rejects(waiting, /Worker crashed/); assert.equal(resets, 1); assert.equal(worker.stopped, true);
});
