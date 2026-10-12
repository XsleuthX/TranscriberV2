import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { providerMiddleware } from '../server/providers.js';
import { alignTranscript } from '../src/transcript-timing.js';

async function serve(t, upstream) {
  const middleware = providerMiddleware({}, { fetch: upstream });
  const server = http.createServer((req, res) => middleware(req, res, () => res.end()));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); return new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('GPT-6.1 Sol uses Responses, preserves instructions, and returns only answer text', async t => {
  const base = await serve(t, async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-6.1-sol'); assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, 'low'); assert.ok(body.max_output_tokens >= 8192);
    assert.equal(body.input[0].content, 'Translate faithfully.'); assert.ok(!('max_tokens' in body));
    return Response.json({ output: [{ type: 'reasoning', content: [{ type: 'summary_text', text: 'private' }] }, { type: 'message', content: [{ type: 'output_text', text: 'Translation.' }] }] });
  });
  const res = await fetch(base + '/api/ai', { method: 'POST', headers: { 'x-ai-provider': 'openai', 'x-ai-model': 'gpt-6.1-sol', 'x-user-key': 'fixture' }, body: JSON.stringify({ system: 'Translate faithfully.', messages: [{ role: 'user', content: 'Text' }] }) });
  assert.deepEqual(await res.json(), { content: [{ type: 'text', text: 'Translation.' }] });
});
test('speech models send compatible formats and real selected IDs; text models reject speech calls', async t => {
  const seen = [];
  const base = await serve(t, async (url, options) => {
    const fd = options.body; seen.push(fd);
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    return Response.json({ text: 'Speech.' });
  });
  const request = model => fetch(base + '/api/transcribe', { method: 'POST', headers: { 'x-engine': 'openai', 'x-model': model, 'x-user-key': 'fixture', 'x-language': 'en' }, body: 'audio' });
  for (const model of ['gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1']) assert.equal((await request(model)).status, 200);
  assert.equal(seen[0].get('languages[]'), 'en');
  for (const fd of seen.slice(0, 3)) { assert.equal(fd.get('response_format'), 'json'); assert.equal(fd.get('timestamp_granularities[]'), null); }
  assert.equal(seen[3].get('response_format'), 'verbose_json'); assert.deepEqual(seen[3].getAll('timestamp_granularities[]'), ['word', 'segment']);
  assert.equal((await request('gpt-6.1-sol')).status, 502); assert.equal(seen.length, 4);
});
test('alignment preserves speech model prose and timing anchors, and marks estimated timing', () => {
  const data = alignTranscript('Hello better world.', { words: [{ word: 'Hello', start: 1, end: 1.3 }, { word: 'world', start: 2, end: 2.5 }] });
  assert.equal(data.text, 'Hello better world.'); assert.equal(data.timingEstimated, true);
  assert.equal(data.words[0].start, 1); assert.equal(data.words[2].start, 2);
  assert.ok(data.words[1].start >= 1.3 && data.words[1].end <= 2);
  const adjacent = alignTranscript('Hello better world.', { words: [{ word: 'Hello', start: 0, end: .4 }, { word: 'world', start: .4, end: 1 }] });
  assert.ok(adjacent.words.every(w => w.end > w.start));
  assert.ok(adjacent.words.every((w, i, all) => !i || w.start >= all[i - 1].end));
  const zh = alignTranscript('你好世界', { words: [{ word: '你好', start: 0, end: 1 }, { word: '世界', start: 1, end: 2 }] });
  assert.equal(zh.words.length, 4); assert.equal(zh.words.at(-1).end, 2);
  assert.throws(() => alignTranscript('speech', { words: [] }), /no word timing/);
});
test('disconnecting transcription aborts the upstream provider request', async t => {
  let started, cancelled;
  const ready = new Promise(r => { started = r; });
  const stopped = new Promise(r => { cancelled = r; });
  const base = await serve(t, async (url, options) => {
    started();
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => {
      cancelled(); reject(options.signal.reason);
    }, { once: true }));
  });
  const controller = new AbortController();
  const response = fetch(base + '/api/transcribe', { method: 'POST', signal: controller.signal,
    headers: { 'x-engine': 'openai', 'x-model': 'whisper-1', 'x-user-key': 'fixture' }, body: 'audio' });
  await ready; controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
  await Promise.race([stopped, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Provider request did not abort')), 3000); timer.unref(); })]);
});

test('DeepSeek chat compatibility uses a larger non-thinking budget and retries truncation once', async t => {
  const calls = [];
  const base = await serve(t, async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    return Response.json({ choices: [{ message: { content: calls.length === 1 ? 'Truncated' : 'Complete answer.' }, finish_reason: calls.length === 1 ? 'length' : 'stop' }] });
  });
  const response = await fetch(base + '/api/ai', { method: 'POST', headers: { 'x-ai-provider': 'deepseek', 'x-ai-model': 'deepseek-chat', 'x-user-key': 'fixture' }, body: JSON.stringify({ max_tokens: 1000, messages: [{ role: 'user', content: 'Editor request.' }] }) });
  assert.deepEqual(await response.json(), { content: [{ type: 'text', text: 'Complete answer.' }] });
  assert.equal(calls.length, 2); assert.equal(calls[0].model, 'deepseek-flash'); assert.equal(calls[0].thinking.type, 'disabled');
  assert.deepEqual(calls.map(c => c.max_tokens), [8192, 16384]); assert.deepEqual(calls[0].messages, calls[1].messages);
});
test('DeepSeek still-truncated replies retain partial text and stop automatic retries', async t => {
  let calls = 0;
  const base = await serve(t, async () => { calls++; return Response.json({ choices: [{ message: { content: 'Partial retained.' }, finish_reason: 'length' }] }); });
  const response = await fetch(base + '/api/ai', { method: 'POST', headers: { 'x-ai-provider': 'deepseek', 'x-ai-model': 'deepseek-flash', 'x-user-key': 'fixture' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Text' }] }) });
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.incomplete, true);
  assert.equal(data.content[0].text, 'Partial retained.'); assert.equal(calls, 2);
});
