const FORMAT = 'transcriber-project';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error('Invalid project JSON: ' + message); };
const array = (value, label) => { if (!Array.isArray(value)) fail(label + ' must be an array.'); };
const ids = (values, label) => {
  array(values, label); const seen = new Set();
  for (const value of values) {
    if (!object(value) || typeof value.id !== 'string' || !value.id || seen.has(value.id)) fail(label + ' contains a missing or duplicate ID.');
    seen.add(value.id);
  }
  return seen;
};
function encodePCM(buffer) {
  const bytes = new Uint8Array(buffer); let result = '';
  // Chunks divisible by three can be concatenated as base64 without padding.
  for (let offset = 0; offset < bytes.length; offset += 24576)
    result += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24576)));
  return { encoding: 'pcm16-base64', data: result, byteLength: bytes.length };
}
function decodePCM(value) {
  if (!object(value) || value.encoding !== 'pcm16-base64' || typeof value.data !== 'string' ||
    !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength % 2 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data) ||
    Math.floor(value.data.length * 3 / 4) - (value.data.endsWith('==') ? 2 : value.data.endsWith('=') ? 1 : 0) !== value.byteLength)
    fail('Invalid cached audio encoding.');
  const bytes = new Uint8Array(value.byteLength); let at = 0;
  for (let offset = 0; offset < value.data.length; offset += 32768) {
    const chunk = atob(value.data.slice(offset, offset + 32768));
    for (let i = 0; i < chunk.length; i++) bytes[at++] = chunk.charCodeAt(i);
  }
  return bytes.buffer;
}
export function exportProjectJSON(project) {
  const media = Object.fromEntries(Object.entries(project.media).map(([id, asset]) => {
    const copy = { ...asset, url: null, offline: true };
    // Iconik session/proxy routes expire. Only persistent asset identity travels.
    if (copy.iconik) copy.iconik = { assetId: copy.iconik.assetId, proxyId: copy.iconik.proxyId };
    if (asset.pcm instanceof ArrayBuffer) copy.pcm = encodePCM(asset.pcm);
    else delete copy.pcm;
    return [id, copy];
  }));
  return JSON.stringify({ format: FORMAT, version: 1, exportedAt: new Date().toISOString(),
    project: { media, rows: project.rows, mtl: project.mtl, rules: project.rules, reviews: project.reviews || [],
      activeAsset: project.media[project.activeAsset] ? project.activeAsset : Object.keys(project.media)[0] || null, ui: project.ui || {}, v: 1 } }, null, 2);
}
export function importProjectJSON(text) {
  const envelope = JSON.parse(text, (key, value) => {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('Unsafe object key.');
    return value;
  });
  if (envelope?.format !== FORMAT || envelope.version !== 1 || !object(envelope.project)) fail('Unsupported format or version.');
  const p = envelope.project;
  if (!object(p.media)) fail('Media is missing.');
  for (const [key, asset] of Object.entries(p.media)) {
    if (!key || !object(asset) || typeof asset.name !== 'string' || !['local', 'iconik', 'youtube', 'drive'].includes(asset.type)) fail('Invalid media entry.');
    array(asset.words, 'Words'); ids(asset.cues, 'Sub A cues'); ids(asset.cuesB, 'Sub B cues'); ids(asset.clips, 'Source clips');
    asset.words.forEach(w => { if (!object(w) || typeof w.t !== 'string' || !Number.isFinite(w.s) || !Number.isFinite(w.e) || w.s < 0 || w.e < w.s) fail('Invalid transcript word.'); });
    for (const cue of [...asset.cues, ...asset.cuesB]) {
      const segmentOnly = cue.ws == null && cue.we == null && typeof cue.textOverride === 'string' &&
        Number.isFinite(cue.startOverride) && Number.isFinite(cue.endOverride) && cue.endOverride > cue.startOverride;
      if ((!segmentOnly && (!Number.isInteger(cue.ws) || !Number.isInteger(cue.we) || cue.ws < 0 || cue.we < cue.ws ||
        (asset.words.length && cue.we >= asset.words.length))) ||
        (cue.textOverride != null && typeof cue.textOverride !== 'string')) fail('Invalid cue range or text.');
      for (const field of ['startOverride', 'endOverride']) if (cue[field] != null && (!Number.isFinite(cue[field]) || cue[field] < 0)) fail('Invalid cue timing.');
    }
    for (const clip of asset.clips) if (!Number.isFinite(clip.in) || !Number.isFinite(clip.out) || clip.in < 0 || clip.out <= clip.in) fail('Invalid source clip timing.');
    asset.url = null; asset.offline = true;
    if (asset.iconik) {
      if (!object(asset.iconik) || typeof asset.iconik.assetId !== 'string') fail('Invalid Iconik identity.');
      asset.iconik = { assetId: asset.iconik.assetId, proxyId: asset.iconik.proxyId };
    }
    if (asset.pcm != null) {
      asset.pcm = decodePCM(asset.pcm);
      if (!Number.isFinite(asset.pcmRate) || asset.pcmRate <= 0) fail('Invalid audio sample rate.');
    }
  }
  ids(p.rows, 'Story rows'); const cardIds = new Set();
  for (const row of p.rows) {
    if (typeof row.label !== 'string') fail('Invalid Story section title.');
    ids(row.cards, 'Story cards');
    for (const card of row.cards) {
      if (cardIds.has(card.id)) fail('Duplicate Story card ID.'); cardIds.add(card.id);
      // Removing a source intentionally leaves its cards as missing-source
      // placeholders. A backup must retain those references and authored text.
      if (card.assetKey != null && typeof card.assetKey !== 'string') fail('Invalid Story source reference.');
      for (const field of ['cueRefs', 'sourceCueRefs']) { array(card[field], field); if (card[field].some(id => typeof id !== 'string')) fail('Invalid Story cue reference.'); }
      if (card.body != null && typeof card.body !== 'string') fail('Invalid Story text.');
      for (const field of ['title', 'label', 'notes', 'speaker']) if (card[field] != null && typeof card[field] !== 'string') fail('Invalid Story label.');
      if (!['cue', 'clip', 'audio', 'caption', 'generic', 'music', 'sfx', 'vo', 'nat', 'ambience'].includes(card.kind) || !['video', 'audio'].includes(card.col)) fail('Invalid Story card type.');
      for (const field of ['sin', 'sout']) if (card[field] != null && (!Number.isFinite(card[field]) || card[field] < 0)) fail('Invalid Story timing.');
    }
  }
  if (!object(p.mtl)) fail('Multi-Timeline is missing.');
  const tracks = ids(p.mtl.tracks, 'Tracks'); ids(p.mtl.clips, 'Timeline clips'); array(p.mtl.markers, 'Markers');
  for (const track of p.mtl.tracks) {
    if (!['video', 'audio', 'subtitle', 'overlay'].includes(track.kind) || typeof track.name !== 'string') fail('Invalid track.');
    if (track.height != null && (!Number.isFinite(track.height) || track.height < 12 || track.height > 300)) fail('Invalid track height.');
  }
  for (const clip of p.mtl.clips) {
    if (!tracks.has(clip.trackId) || (clip.assetKey != null && typeof clip.assetKey !== 'string')) fail('Unknown timeline track or invalid source reference.');
    for (const field of ['pin', 'pout', 'sin', 'sout']) if (!Number.isFinite(clip[field]) || clip[field] < 0) fail('Invalid timeline timing.');
    if (clip.pout <= clip.pin || clip.sout < clip.sin) fail('Invalid timeline range.');
    for (const field of ['title', 'text', 'color']) if (clip[field] != null && typeof clip[field] !== 'string') fail('Invalid timeline label.');
  }
  if (!object(p.rules) || !object(p.ui) || (p.activeAsset != null && !p.media[p.activeAsset])) fail('Settings or active media is missing.');
  if (p.ui.dictionary != null) {
    if (!object(p.ui.dictionary)) fail('Invalid dictionary.');
    for (const field of ['asr','tr']) {
      array(p.ui.dictionary[field], 'Dictionary');
      if (p.ui.dictionary[field].some(r => !object(r) || typeof r.from !== 'string' || typeof r.to !== 'string')) fail('Invalid dictionary entry.');
    }
  }
  if (p.ui.priming != null && typeof p.ui.priming !== 'boolean') fail('Invalid priming preference.');
  for (const value of Object.values(p.rules)) if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) fail('Invalid subtitle rule.');
  array(p.reviews, 'Review flags');
  for (const review of p.reviews) {
    if (!object(review) || typeof review.target !== 'string' || typeof review.reason !== 'string' || typeof review.preset !== 'string' || !['cue', 'word', 'clip', 'card', 'multi'].includes(review.kind)) fail('Invalid review flag.');
    for (const field of ['preset', 'presetLabel', 'suggestion', 'reviewId', 'signature']) if (review[field] != null && typeof review[field] !== 'string') fail('Invalid review text.');
  }
  const ui = {};
  if (typeof p.ui.projectName === 'string') ui.projectName = p.ui.projectName.slice(0, 300);
  for (const [field, min, max] of [['uiZoom', .5, 2], ['docSize', 10, 40], ['mtlZoom', 2, 800], ['time', 0, 8640000]])
    if (Number.isFinite(p.ui[field]) && p.ui[field] >= min && p.ui[field] <= max) ui[field] = p.ui[field];
  if (['transcript', 'subtitle', 'timeline', 'story', 'multi'].includes(p.ui.ws)) ui.ws = p.ui.ws;
  if (['A', 'B', 'DUAL'].includes(p.ui.track)) ui.track = p.ui.track;
  if (typeof p.ui.mtlSnap === 'boolean') ui.mtlSnap = p.ui.mtlSnap;
  if (typeof p.ui.priming === 'boolean') ui.priming = p.ui.priming;
  if (p.ui.dictionary) ui.dictionary = Object.fromEntries(['asr','tr'].map(field =>
    [field,p.ui.dictionary[field].map(({from,to})=>({from,to}))]));
  return { media: p.media, rows: p.rows, mtl: p.mtl, rules: p.rules, reviews: p.reviews, activeAsset: p.activeAsset, ui, v: 1 };
}
