export const WORKSPACE_NAMES = { transcript: 'Transcript', subtitle: 'Subtitle', timeline: 'Timeline', story: 'Story', multi: 'Multi-Timeline' };
export const PARTICIPANT_COLOURS = ['#2563eb','#b45309','#9333ea','#047857','#be185d','#0e7490','#c2410c','#4f46e5','#15803d','#a21caf','#9f1239','#475569'];
const idPattern = /^[a-f0-9]{32}$/;
const fail = message => { throw new Error(message); };
export function textFingerprint(text) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return (value >>> 0).toString(16) + ':' + text.length;
}
export function participantColour(id) {
  let hash = 0; for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return PARTICIPANT_COLOURS[hash % PARTICIPANT_COLOURS.length];
}
export function cleanActivity(value) {
  if (value == null) return null;
  if (!value || !Object.hasOwn(WORKSPACE_NAMES,value.workspace) || !['view','transcript','cue','clip','card','multi','range'].includes(value.kind)) fail('Invalid collaboration location.');
  const result = { workspace: value.workspace, kind: value.kind, editing: value.editing === true };
  for (const key of ['assetKey','id','rowId','cardId','field','textHash']) {
    if (value[key] != null) { if (typeof value[key] !== 'string' || value[key].length > 240) fail('Invalid location identity.'); result[key] = value[key]; }
  }
  if (value.track != null) { if (!['A','B'].includes(value.track)) fail('Invalid subtitle track.'); result.track = value.track; }
  for (const key of ['start','end','wordStart','wordEnd']) {
    if (value[key] != null) { if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 10000000) fail('Invalid selection offset.'); result[key] = value[key]; }
  }
  if (result.start != null && result.end != null && result.end < result.start) fail('Invalid selection range.');
  for (const key of ['timeStart','timeEnd','playhead']) {
    if (value[key] != null) { if (!Number.isFinite(value[key]) || value[key] < 0 || value[key] > 8640000) fail('Invalid timeline position.'); result[key] = value[key]; }
  }
  for (const [key, limit] of [['quote',600],['draft',2000]]) {
    if (value[key] != null) { if (typeof value[key] !== 'string' || value[key].length > limit) fail('Selection preview is too long.'); result[key] = value[key]; }
  }
  if (value.selectionIds != null) {
    if (!Array.isArray(value.selectionIds) || value.selectionIds.length > 100 || value.selectionIds.some(id => typeof id !== 'string' || id.length > 240)) fail('Invalid selected items.');
    result.selectionIds = [...new Set(value.selectionIds)];
  }
  return result;
}
export const emptyDiscussion = () => ({ revision: 0, members: [], threads: [] });
export function registerMember(discussion, id, name, now) {
  if (!idPattern.test(id) || typeof name !== 'string' || !name.trim() || name.length > 60) fail('Enter a participant name of up to 60 characters.');
  const existing = discussion.members.find(member => member.id === id);
  if (existing?.name === name.trim()) return discussion;
  if (!existing && discussion.members.length >= 500) fail('This project has reached its participant limit.');
  const colour = existing?.colour || PARTICIPANT_COLOURS.find(c => !discussion.members.some(m => m.colour === c)) || participantColour(id);
  const member = { id, name: name.trim(), colour, joinedAt: existing?.joinedAt || now };
  return { ...discussion, revision: discussion.revision + 1, members: existing ? discussion.members.map(m => m.id === id ? member : m) : [...discussion.members, member] };
}
export function validateDiscussion(value) {
  if (value == null) return emptyDiscussion();
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.members) || !Array.isArray(value.threads) || value.members.length > 500 || value.threads.length > 2000) fail('Invalid comment archive.');
  if(new TextEncoder().encode(JSON.stringify(value)).byteLength>8*1024*1024)fail('Comment archive exceeds 8 MiB.');
  const ids = new Set(), messages = new Set();
  const string = (value, max) => typeof value === 'string' && value.length <= max;
  const date = value => string(value,40) && Number.isFinite(Date.parse(value));
  const members = value.members.map(member => {
    if (!member || !idPattern.test(member.id) || ids.has(member.id) || !string(member.name,60) || !member.name.trim() || !/^#[a-fA-F0-9]{6}$/.test(member.colour) || !date(member.joinedAt)) fail('Invalid comment participant.');
    ids.add(member.id); return { id: member.id, name: member.name, colour: member.colour, joinedAt: member.joinedAt };
  });
  const author = value => value && ids.has(value.id) && string(value.name,60);
  const threadIds = new Set();
  const threads = value.threads.map(thread => {
    if (!thread || !idPattern.test(thread.id) || threadIds.has(thread.id) || !date(thread.createdAt) || !date(thread.updatedAt) || typeof thread.resolved !== 'boolean' || !Array.isArray(thread.messages) || !thread.messages.length || thread.messages.length > 200 || (thread.assignee != null && !ids.has(thread.assignee))) fail('Invalid comment thread.');
    threadIds.add(thread.id);
    const anchor = cleanActivity(thread.anchor); if (!anchor || anchor.kind === 'view') fail('A comment needs a project location.');
    delete anchor.draft; delete anchor.editing;
    const list = thread.messages.map(message => {
      if (!message || !idPattern.test(message.id) || messages.has(message.id) || !author(message.author) || !string(message.text,4000) || !message.text.trim() || !date(message.createdAt) || !Array.isArray(message.mentions) || message.mentions.length > 50 || message.mentions.some(id => !ids.has(id))) fail('Invalid comment message.');
      messages.add(message.id); return { id: message.id, text: message.text, author: { id: message.author.id, name: message.author.name }, createdAt: message.createdAt, mentions: [...new Set(message.mentions)] };
    });
    return { id: thread.id, anchor, messages: list, assignee: thread.assignee || null, resolved: thread.resolved, createdAt: thread.createdAt, updatedAt: thread.updatedAt };
  });
  return { revision: value.revision, members, threads };
}
// Comment operations append under the server's project lock; concurrent replies
// never replace a whole document. Creation/reply IDs make retrying idempotent.
export function applyDiscussionOperation(discussion, operation, actor, now) {
  if (!operation || !idPattern.test(operation.id) || !actor || !discussion.members.some(m => m.id === actor.id)) fail('Invalid comment operation.');
  const action = operation.action;
  if (!['create','reply','resolve','reopen','assign'].includes(action)) fail('Unknown comment action.');
  if (discussion.threads.some(t => t.id === operation.id || t.messages.some(m => m.id === operation.id))) return discussion;
  const author = { id: actor.id, name: actor.name };
  const text = () => { if (typeof operation.text !== 'string' || !operation.text.trim() || operation.text.length > 4000) fail('Write a comment of up to 4,000 characters.'); return operation.text.trim(); };
  const mentions = () => { if (operation.mentions != null && (!Array.isArray(operation.mentions) || operation.mentions.length > 50 || operation.mentions.some(id => !discussion.members.some(m => m.id === id)))) fail('Choose mentions from project participants.'); return [...new Set(operation.mentions || [])]; };
  const assignee = () => { if (operation.assignee != null && !discussion.members.some(m => m.id === operation.assignee)) fail('Choose an action owner from project participants.'); return operation.assignee || null; };
  const message = () => ({ id: operation.id, text: text(), mentions: mentions(), author, createdAt: now });
  let threads;
  if (action === 'create') {
    if (discussion.threads.length >= 2000) fail('This project has reached its comment limit.');
    const anchor = cleanActivity(operation.anchor); if (!anchor || anchor.kind === 'view') fail('Select project content before commenting.');
    delete anchor.draft; delete anchor.editing;
    threads = [...discussion.threads, { id: operation.id, anchor, messages: [message()], assignee: assignee(), resolved: false, createdAt: now, updatedAt: now }];
  } else {
    const thread = discussion.threads.find(t => t.id === operation.threadId); if (!thread) fail('Comment thread no longer exists.');
    let next = { ...thread, updatedAt: now };
    if (action === 'reply') { if (thread.messages.length >= 200) fail('This thread has reached its reply limit.'); next.messages = [...thread.messages, message()]; }
    if (action === 'resolve' || action === 'reopen') next.resolved = action === 'resolve';
    if (action === 'assign') next.assignee = assignee();
    threads = discussion.threads.map(t => t.id === thread.id ? next : t);
  }
  return { ...discussion, revision: discussion.revision + 1, threads };
}
export function anchorStatus(doc, anchor) {
  if(anchor.workspace==='story'&&anchor.cardId&&!(doc.rows||[]).some(r=>r.cards.some(c=>c.id===anchor.cardId)))return 'Story card removed';
  if (['card','multi'].includes(anchor.kind)) {
    const item = anchor.kind === 'card' ? (doc.rows || []).flatMap(r => r.cards).find(c => c.id === anchor.id) : doc.mtl?.clips.find(c => c.id === anchor.id);
    if(!item)return 'Item removed';
    if(item.assetKey&&!doc.media?.[item.assetKey])return 'Source removed';
    if(anchor.kind==='card'&&anchor.quote){
      const asset=doc.media?.[item.assetKey],cues=anchor.track==='B'?asset?.cuesB:asset?.cues;
      const linked=(item.cueRefs||[]).map(id=>cues?.find(c=>c.id===id)).filter(Boolean);
      const body=item.bodyManual||!linked.length?item.body||'':linked.map(c=>c.textOverride??asset.words.slice(c.ws,c.we+1).map(w=>w.t).join(' ')).join('');
      const text=anchor.field==='title'?item.title||'':anchor.field==='notes'?item.notes||'':body;
      if(!text.includes(anchor.quote))return 'Text changed';
    }
    return 'available';
  }
  const asset = Object.hasOwn(doc.media||{},anchor.assetKey)?doc.media[anchor.assetKey]:null; if (!asset) return 'Source removed';
  if (anchor.kind === 'cue') {
    const cue = (anchor.track === 'B' ? asset.cuesB : asset.cues)?.find(c => c.id === anchor.id);
    if (!cue) return 'Caption removed';
    const text = cue.textOverride ?? asset.words.slice(cue.ws, cue.we + 1).map(w => w.t).join(' ');
    return anchor.quote && !text.includes(anchor.quote) ? 'Text changed' : 'available';
  }
  if (anchor.kind === 'clip') return asset.clips?.some(c => c.id === anchor.id) ? 'available' : 'Clip removed';
  if (anchor.kind === 'transcript') {
    const text = asset.words.map(w => w.t).join(' ');
    return anchor.quote && !text.includes(anchor.quote) ? 'Text changed' : 'available';
  }
  return 'available';
}
