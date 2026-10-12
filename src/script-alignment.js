// Use the same token boundaries for pasted lines and Whisper words. In
// particular a Chinese sentence is not one whitespace-delimited word.
const normalize = text => text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export function scriptTokens(text) {
  const parts = String(text).match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [], tokens = [];
  for (const part of parts.flatMap(t => t.split(/(?<=[-–—])/u))) {
    if (normalize(part)) tokens.push(part);
    else if (tokens.length) tokens[tokens.length - 1] += part;
  }
  return tokens;
}

export function alignScriptLines(lines, heard, { normalizeText = text => text, frame = .04 } = {}) {
  const norm = text => normalize(normalizeText(text));
  const source = heard.flatMap(word => {
    const parts = scriptTokens(word.t).filter(t => norm(t));
    if (!Number.isFinite(word.s) || !Number.isFinite(word.e) || word.e <= word.s) return [];
    const weight = parts.reduce((sum, t) => sum + norm(t).length, 0); let offset = 0;
    return parts.map(t => {
      const s = word.s + (word.e - word.s) * offset / weight; offset += norm(t).length;
      return { t, s, e: word.s + (word.e - word.s) * offset / weight, sp: word.sp || 'S1', norm: norm(t) };
    });
  }).sort((a, b) => a.s - b.s || a.e - b.e);
  if (!source.length) throw new Error('Whisper returned no usable word timestamps. Existing subtitles were kept.');
  for (let i = 0; i < source.length;) {
    let end = i + 1, limit = source[i].e;
    while (end < source.length && source[end].s < limit - .000001) { limit = Math.max(limit, source[end].e); end++; }
    if (end > i + 1) {
      const start = source[i].s, weight = source.slice(i, end).reduce((sum, w) => sum + w.norm.length, 0); let done = 0;
      for (let j = i; j < end; j++) { source[j].s = start + (limit - start) * done / weight; done += source[j].norm.length; source[j].e = start + (limit - start) * done / weight; source[j].estimated = true; }
    }
    i = end;
  }
  const target = lines.flatMap((text, line) => scriptTokens(text).filter(t => norm(t)).map(t => ({ t, line, norm: norm(t) })));
  if (!target.length) throw new Error('Paste lines containing spoken words.');
  // Sparse sequence matching avoids allocating a recording-sized LCS matrix.
  const positions = new Map();
  source.forEach((word, index) => { const list = positions.get(word.norm) || []; list.push(index); positions.set(word.norm, list); });
  const tails = [], nodes = []; let comparisons = 0;
  target.forEach((word, targetIndex) => {
    const candidates = positions.get(word.norm) || [];
    if ((comparisons += candidates.length) > 5000000) throw new Error('This script is too repetitive to align safely in one pass. Align a shorter section. Existing subtitles were kept.');
    for (let j = candidates.length - 1; j >= 0; j--) {
      const sourceIndex = candidates[j]; let lo = 0, hi = tails.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (tails[mid] < sourceIndex) lo = mid + 1; else hi = mid; }
      if (tails[lo] === sourceIndex) continue;
      nodes[lo] = { targetIndex, sourceIndex, previous: lo ? nodes[lo - 1] : null }; tails[lo] = sourceIndex;
    }
  });
  const mapping = new Map();
  for (let node = nodes.at(-1); node; node = node.previous) mapping.set(node.targetIndex, node.sourceIndex);
  if (!mapping.size) throw new Error('The pasted text does not match the recognized speech. Check the source/language and retry. Existing subtitles were kept.');
  const words = target.map((word, i) => {
    const anchor = mapping.has(i) ? source[mapping.get(i)] : null;
    return { t: word.t, i, line: word.line, sp: anchor?.sp || 'S1', s: anchor?.s, e: anchor?.e, edited: !anchor, timingEstimated: !anchor || !!anchor.estimated };
  });
  for (let i = 0; i < words.length;) {
    if (words[i].s != null) { i++; continue; }
    let end = i; while (end < words.length && words[end].s == null) end++;
    let from = i ? words[i - 1].e : source[0].s, to = end < words.length ? words[end].s : source.at(-1).e;
    if (to <= from) {
      if (i) { from = words[i - 1].s + (words[i - 1].e - words[i - 1].s) / 2; words[i - 1].e = from; words[i - 1].timingEstimated = true; }
      else { to = words[end].s + (words[end].e - words[end].s) / 2; words[end].s = to; words[end].timingEstimated = true; }
    }
    const weights = words.slice(i, end).map(w => Math.max(1, norm(w.t).length)), total = weights.reduce((a, b) => a + b, 0); let done = 0;
    for (let j = i; j < end; j++) { words[j].s = from + (to - from) * done / total; done += weights[j - i]; words[j].e = from + (to - from) * done / total; }
    i = end;
  }
  const cues = lines.map((text, line) => {
    const mine = words.filter(w => w.line === line);
    const previous = words.filter(w => w.line < line).at(-1), next = words.find(w => w.line > line);
    const start = mine[0]?.s ?? previous?.e ?? next?.s ?? 0;
    const end = Math.max(mine.at(-1)?.e ?? next?.s ?? start + frame, start + Math.min(frame, Math.max(.001, (mine.at(-1)?.e ?? start + frame) - start)));
    return { id: `al_${line}`, ws: mine[0]?.i ?? null, we: mine.at(-1)?.i ?? null,
      textOverride: text, startOverride: start, endOverride: end, orig: { start, end, text },
      timingEstimated: !mine.length || mine.some(w => w.timingEstimated), matchedWords: mine.filter(w => !w.edited).length };
  });
  return { words, cues, matched: mapping.size, estimatedLines: cues.filter(c => c.timingEstimated).length };
}
