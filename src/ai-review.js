export const AI_PRESETS = [
  { id: 'freeform', label: 'Freeform chat', hint: 'Ask a question or request any text output. Replies stay in the output box.' },
  { id: 'subtitle_check', label: 'Subtitle Check', hint: 'Use the shared Vet checklist and your natural-language brief. Propose specific cue-linked edits with explanations in Transcript and Subtitle modes; review Apply/Dismiss before changing content.' },
  { id: 'subtitle_polish', label: 'Subtitle Polish', hint: 'Suggest cue text improvements. Review each suggestion before applying; timing stays intact.' },
  { id: 'transcript_check', label: 'Transcript Check', hint: 'Flag suspect words in the transcript and offer word corrections without changing timestamps.' },
  { id: 'timeline_get_clips', label: 'Timeline Get Clips', hint: 'Find punchy, self-contained quotes in Sub A of the active media and add source-linked clips in Timeline.' },
  { id: 'story_suggestion', label: 'Story Suggestion', hint: 'Read Sub A across all media, choose relevant quotes, and build an editable sample story with source-linked cards.' },
];
export const targetId = (kind, asset, track, id) => JSON.stringify([kind, asset || '', track || '', String(id)]);
export function reviewTargets(preset, doc, activeAsset, context, cueText, cueTime) {
  const targets = [];
  const add = item => { item.target = targetId(item.kind, item.assetKey, item.track, item.id); item.signature = JSON.stringify(item); targets.push(item); };
  const asset = doc.media[activeAsset];
  const cueItems = (key, tracks) => tracks.forEach(track => {
    const own = doc.media[key]; if (!own) return;
    const counterpart = track === 'B' ? own.cues || [] : own.cuesB || [];
    const list=track === 'B' ? own.cuesB || [] : own.cues || [];
    list.forEach((c,index) => {
      const timing = cueTime(c, own.words || []);
      const paired = counterpart.filter(q => {const t=cueTime(q,own.words||[]);return t.end>timing.start&&t.start<timing.end;});
      add({ kind: 'cue', assetKey: key, sourceName: own.name, track, id: c.id, pairedText: paired.length ? paired.map(q=>cueText(q,own.words||[])).join('\n') : undefined,
        context:list.slice(Math.max(0,index-2),index+3).map(q=>cueText(q,own.words||[])).join('\n').slice(0,4000),
        text: cueText(c, own.words || []), ...timing, ws: c.ws, we: c.we, suspect: !!c.suspect });
    });
  });
  if (preset.startsWith('subtitle_')) cueItems(activeAsset, context === 'BOTH' ? ['A', 'B'] : [context]);
  if (preset === 'transcript_check') (asset?.words || []).forEach((w, index) => add({ kind: 'word', assetKey: activeAsset, id: index, text: w.t, start: w.s, end: w.e,
    context: (asset.words || []).slice(Math.max(0, index - 4), index + 5).map(w => w.t).join(' ') }));
  if (preset === 'timeline_review') (asset?.clips || []).forEach(c => add({ kind: 'clip', assetKey: activeAsset, id: c.id, start: c.in, end: c.out, label: c.label, enabled: c.enabled !== false,
    text: (asset.cues || []).filter(q => { const t = cueTime(q, asset.words); return t.end > c.in && t.start < c.out; }).map(q => cueText(q, asset.words)).join('\n') }));
  if (preset === 'story_review') doc.rows.forEach(row => row.cards.forEach(c => {
    const own = doc.media[c.assetKey];
    const track = context === 'B' && own?.cuesB?.some(q => cueText(q, own.words).trim()) ? 'B' : 'A';
    const cues = track === 'B' ? own?.cuesB : own?.cues;
    add({ kind: 'card', assetKey: c.assetKey, track, id: c.id, rowId: row.id, section: row.label, start: c.sin, end: c.sout, label: c.title || c.label,
      text: !c.bodyManual && c.cueRefs?.length ? c.cueRefs.map(ref => cues?.find(q => q.id.replace(/_B$/, '') === ref.replace(/_B$/, ''))).filter(Boolean).map(q => cueText(q, own.words)).join('\n') : c.body || '', missingSource: !own });
  }));
  if (preset === 'multi_timeline_review') doc.mtl.clips.forEach(c => {
    const key = c.assetKey || doc.rows.flatMap(row => row.cards).find(card => card.id === c.storyCardId)?.assetKey;
    const own = doc.media[key], track = doc.mtl.tracks.find(t => t.id === c.trackId);
    add({ kind: 'multi', assetKey: key, id: c.id, trackId: c.trackId, label: c.title, trackLabel: track?.name || track?.label,
      start: c.pin, end: c.pout, sourceIn: c.sin, sourceOut: c.sout, kindOfTrack: track?.kind, muted: track?.muted, visible: track?.visible, text: c.text || '', missingSource: !!key && !own,
      transcript: (own?.cues || []).filter(q => { const t = cueTime(q, own.words); return t.end > c.sin && t.start < c.sout; }).map(q => cueText(q, own.words)).join('\n') });
  });
  return targets;
}
export function reviewBatches(targets) {
  const batches = []; let batch = [], length = 0;
  for (const [index, target] of targets.entries()) {
    const item = { ...target }; delete item.signature;
    // Short opaque request IDs avoid asking the model to echo an escaped JSON
    // tuple. The caller maps only IDs issued for this particular batch.
    item.target = 'r' + (index + 1);
    for (const key of ['text', 'transcript', 'pairedText', 'context']) if (item[key]?.length > 4000) { item[key] = item[key].slice(0, 4000); item.excerpt = true; }
    const size = JSON.stringify(item).length;
    if (batch.length && (batch.length >= 25 || length + size > 16000)) { batches.push(batch); batch = []; length = 0; }
    batch.push(item); length += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function parseReview(text, targets) {
  const json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
  if (!Array.isArray(json.flags) || json.flags.length > 100) throw new Error('Expected a JSON flags array (up to 100 flags).');
  const allowed = new Map();
  targets.forEach(t => { allowed.set(t.target, t); if (t.requestTarget) allowed.set(t.requestTarget.toLowerCase(), t); });
  const flags = [], seen = new Set(); let rejected = 0;
  for (const flag of json.flags) {
    if (!flag || typeof flag !== 'object') { rejected++; continue; }
    let id = flag.target;
    if (Array.isArray(id)) id = JSON.stringify(id);
    if (typeof id === 'string') {
      id = id.trim();
      if (/^r\d+$/i.test(id)) id = id.toLowerCase();
      else { try { const tuple = JSON.parse(id); if (Array.isArray(tuple)) id = JSON.stringify(tuple); } catch {} }
    }
    const item = allowed.get(id);
    const reason = [flag.reason, flag.explanation, flag.message].find(value => typeof value === 'string' && value.trim());
    if (!item || !reason || (flag.suggestion != null && (typeof flag.suggestion !== 'string' || flag.suggestion.length > 8000))) { rejected++; continue; }
    const normalized = { ...item, reason: reason.trim().slice(0, 2000), suggestion: ['cue', 'word'].includes(item.kind) ? flag.suggestion : undefined };
    delete normalized.requestTarget;
    const key = JSON.stringify([normalized.target, normalized.reason, normalized.suggestion]);
    if (!seen.has(key)) { flags.push(normalized); seen.add(key); }
  }
  flags.rejected = rejected;
  return flags;
}
