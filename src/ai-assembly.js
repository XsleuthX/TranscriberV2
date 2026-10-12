// The model chooses source IDs; the editor alone computes text and timecodes.
export function assemblySources(doc, activeAsset, wholeProject, cueText, cueTime) {
  const items = [];
  for (const [assetKey, asset] of Object.entries(doc.media)) {
    if (!wholeProject && assetKey !== activeAsset) continue;
    (asset.cues || []).forEach((cue, index) => {
      const text = cueText(cue, asset.words || []), range = cueTime(cue, asset.words || []);
      if (!text.trim() || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return;
      items.push({ id: 'c' + (items.length + 1), assetKey, sourceName: asset.name, cueId: cue.id,
        index, text, start: range.start, end: range.end });
    });
  }
  return items;
}
export function assemblyBatches(items) {
  const batches = []; let batch = [], size = 0;
  for (const item of items) {
    const bytes = JSON.stringify(item).length;
    if (batch.length && (batch.length >= 40 || size + bytes > 14000)) { batches.push(batch); batch = []; size = 0; }
    batch.push(item); size += bytes;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function readAssemblyJSON(text) {
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}
export function parseQuotePicks(text, items) {
  const json = readAssemblyJSON(text);
  if (!Array.isArray(json.clips) || json.clips.length > 12) throw new Error('Expected up to 12 clips.');
  const found = [], seen = new Set(), byId = new Map(items.map(item => [item.id, item]));
  for (const pick of json.clips) {
    const first = byId.get(pick?.from), last = byId.get(pick?.to);
    if (!first || !last || first.assetKey !== last.assetKey || last.index < first.index || last.index - first.index > 15) continue;
    const cues = items.filter(item => item.assetKey === first.assetKey && item.index >= first.index && item.index <= last.index);
    if (cues.length !== last.index - first.index + 1 || last.end <= first.start || last.end - first.start > 120) continue;
    const key = first.id + ':' + last.id;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ assetKey: first.assetKey, cueRefs: cues.map(c => c.cueId.replace(/_B$/, '')),
      in: first.start, out: last.end, text: cues.map(c => c.text).join('\n'),
      label: typeof pick.label === 'string' && pick.label.trim() ? pick.label.trim().slice(0, 100) : first.text.slice(0, 60),
      why: typeof pick.why === 'string' ? pick.why.slice(0, 2000) : '' });
  }
  if (json.clips.length && !found.length) throw new Error('No returned clip used a valid, contiguous source range.');
  return found;
}
export function parseStoryPlan(text, candidates) {
  const json = readAssemblyJSON(text);
  if (!Array.isArray(json.sections) || !json.sections.length || json.sections.length > 12) throw new Error('Expected 1–12 story sections.');
  const byId = new Map(candidates.map(c => [c.id, c])), used = new Set();
  const sections = json.sections.map(section => {
    if (typeof section?.title !== 'string' || !section.title.trim() || !Array.isArray(section.clips)) throw new Error('A story section needs a title and clip IDs.');
    const clips = section.clips.map(id => {
      if (!byId.has(id)) throw new Error('Story referenced an unknown clip.');
      if (used.has(id)) return null;
      used.add(id); return byId.get(id);
    }).filter(Boolean);
    return { title: section.title.trim().slice(0, 100), clips };
  }).filter(section => section.clips.length);
  if (!sections.length) throw new Error('The story contained no usable clips.');
  return sections;
}
