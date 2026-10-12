import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceTime, resolveTimeline, moveClips, trimClips, razorClips, deleteClips, programClips } from '../src/timeline.js';
const clip = (id, trackId, kind, pin, pout, extra = {}) => ({ id, trackId, kind, pin, pout, sin: 10, sout: 10 + pout - pin, assetKey: 'a', ...extra });
const doc = clips => ({ tracks: [
  { id: 'V1', name: 'V1', kind: 'video' }, { id: 'V2', name: 'V2', kind: 'video' },
  { id: 'A1', name: 'A1', kind: 'audio' }, { id: 'A2', name: 'A2', kind: 'audio' },
  { id: 'SUB', name: 'SUB', kind: 'subtitle' }], clips });
test('program resolves track order, muted/solo audio and visible subtitles', () => {
  const d = doc([clip('top', 'V2', 'video', 0, 5), clip('base', 'V1', 'video', 0, 8),
    clip('a', 'A1', 'audio', 0, 8), clip('b', 'A2', 'audio', 0, 8), clip('s', 'SUB', 'subtitle', 2, 3)]);
  assert.deepEqual(programClips(d, 2).video.map(c => c.id), ['base', 'top']);
  d.tracks[3].solo = true;
  assert.deepEqual(programClips(d, 2).audio.map(c => c.id), ['b']);
  d.tracks[3].muted = true; d.tracks[4].visible = false;
  assert.equal(programClips(d, 2).audio.length, 0);
  assert.equal(programClips(d, 2).text.length, 0);
  assert.equal(programClips(d, 5).video.length, 1);
});
test('source offsets and older story-based projects resolve independently of selected asset', () => {
  const d = resolveTimeline(doc([{ id: 'x', storyCardId: 'c', pin: 100, sin: 20 }]), [{ cards: [{ id: 'c', assetKey: 'other' }] }]);
  assert.equal(d.clips[0].assetKey, 'other');
  assert.equal(sourceTime(d.clips[0], 103), 23);
});
test('group movement clamps once to zero, preserving A/V and cue offsets', () => {
  const d = doc([clip('v', 'V1', 'video', 2, 7, { groupId: 'g' }), clip('a', 'A1', 'audio', 2, 7, { groupId: 'g' }),
    clip('s', 'SUB', 'subtitle', 4, 5, { groupId: 'g' })]);
  const moved = moveClips(d, new Set(['v']), -10, 'V2', 'v');
  assert.deepEqual(moved.clips.map(c => c.pin), [0, 0, 2]);
  assert.equal(moved.clips[0].trackId, 'V2');
  assert.equal(moved.clips[1].trackId, 'A1');
});
test('multi-selection moves together and same-track collisions reject the entire edit', () => {
  const d = doc([clip('x', 'V1', 'video', 0, 5), clip('y', 'V2', 'video', 2, 5), clip('z', 'V1', 'video', 8, 10)]);
  assert.equal(moveClips(d, new Set(['x', 'y']), 5), d);
  assert.deepEqual(moveClips(d, new Set(['x', 'y']), 1).clips.map(c => c.pin), [1, 3, 8]);
});
test('trimming updates source boundaries, crops linked subtitles, and respects source length', () => {
  const d = doc([clip('v', 'V1', 'video', 2, 7, { groupId: 'g' }), clip('a', 'A1', 'audio', 2, 7, { groupId: 'g' }),
    clip('s', 'SUB', 'subtitle', 2, 4, { groupId: 'g' })]);
  const left = trimClips(d, 'v', 'l', 1, { a: { duration: 20 } });
  assert.deepEqual(left.clips.map(c => [c.pin, c.sin]), [[3, 11], [3, 11], [3, 11]]);
  const right = trimClips(d, 'v', 'r', 100, { a: { duration: 18 } });
  assert.equal(right.clips[0].sout, 18); assert.equal(right.clips[0].pout, 10);
});
test('locked linked tracks block moves, trims, delete and razor', () => {
  const d = doc([clip('v', 'V1', 'video', 0, 5, { groupId: 'g' }), clip('a', 'A1', 'audio', 0, 5, { groupId: 'g' })]);
  d.tracks[2].locked = true;
  assert.equal(moveClips(d, new Set(['v']), 1), d);
  assert.equal(trimClips(d, 'v', 'l', 1), d);
  assert.equal(deleteClips(d, new Set(['v'])), d);
  assert.deepEqual(razorClips(d, 2).clips, d.clips);
});
test('razor retains right-hand subtitle links and accurate source time', () => {
  const d = doc([clip('v', 'V1', 'video', 0, 8, { groupId: 'g' }), clip('a', 'A1', 'audio', 0, 8, { groupId: 'g' }),
    clip('s', 'SUB', 'subtitle', 5, 7, { groupId: 'g' })]);
  const cut = razorClips(d, 4);
  assert.equal(cut.clips.length, 5);
  const right = cut.clips.filter(c => c.pin >= 4);
  assert.equal(new Set(right.map(c => c.groupId)).size, 1);
  assert.equal(right.find(c => c.kind === 'video').sin, 14);
});
test('ripple delete closes a shared gap once and keeps all tracks synchronized', () => {
  const d = doc([clip('v', 'V1', 'video', 0, 5, { groupId: 'g' }), clip('a', 'A1', 'audio', 0, 5, { groupId: 'g' }),
    clip('next', 'V1', 'video', 5, 9), clip('nextAudio', 'A1', 'audio', 5, 9)]);
  const result = deleteClips(d, new Set(['v']), true);
  assert.deepEqual(result.clips.map(c => c.pin), [0, 0]);
});
test('ripple delete never shifts into surviving footage or locked tracks', () => {
  const d = doc([clip('v', 'V1', 'video', 0, 5), clip('music', 'A1', 'audio', 0, 9), clip('next', 'V1', 'video', 5, 9)]);
  assert.equal(deleteClips(d, new Set(['v']), true).clips.at(-1).pin, 5);
});
