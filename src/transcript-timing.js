// The chosen speech model supplies text; Whisper supplies acoustic anchors.
// Changed/unmatched words have estimated timing, explicitly shown in the UI.
export function alignTranscript(text, timing) {
  const tokens = value => String(value || '').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) || [];
  const target = tokens(text), source = (timing.words || []).flatMap(w => {
    const parts = tokens(w.word ?? w.text), start = Number(w.start), end = Number(w.end);
    if (!Number.isFinite(start) || !(end > start)) return [];
    return parts.map((word, i) => ({ word, start: start + (end - start) * i / parts.length, end: start + (end - start) * (i + 1) / parts.length }));
  });
  if (!target.length) return { text: '', words: [], segments: [], timingEstimated: true };
  if (!source.length) throw new Error('Whisper returned no word timing for the selected speech model. Try Whisper-1 or a shorter recording.');
  if (target.length * source.length > 4000000) throw new Error('Transcript is too large to align safely. Use shorter chunks.');
  const norm = t => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const a = source.map(w => norm(w.word)), b = target.map(norm);
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    dp[i][j] = a[i] && a[i] === b[j] ? 1 + dp[i + 1][j + 1] : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const map = new Map(); let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] && a[i] === b[j]) { map.set(j++, source[i++]); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  const words = target.map((word, k) => ({ word, ...(map.has(k) ? { start: map.get(k).start, end: map.get(k).end } : {}) }));
  for (let k = 0; k < words.length;) {
    if (words[k].start != null) { k++; continue; }
    let z = k; while (z < words.length && words[z].start == null) z++;
    let from = k ? words[k - 1].end : source[0].start;
    let to = z < words.length ? words[z].start : source.at(-1).end;
    // Adjacent acoustic words leave no gap for an insertion. Share a small
    // part of an adjacent word instead of producing zero-duration tokens.
    if (to <= from) {
      if (k && words[k - 1].end > words[k - 1].start) {
        from = words[k - 1].end - Math.min(.2, (words[k - 1].end - words[k - 1].start) / 2);
        words[k - 1].end = from;
      } else if (z < words.length && words[z].end > words[z].start) {
        to = words[z].start + Math.min(.2, (words[z].end - words[z].start) / 2);
        words[z].start = to;
      }
    }
    const span = Math.max(0, to - from);
    for (let x = k; x < z; x++) Object.assign(words[x], { start: from + span * (x - k) / (z - k), end: from + span * (x - k + 1) / (z - k) });
    k = z;
  }
  // Keep the chosen model's exact transcript as segment text. Caption building
  // can then split it against the aligned word stream without replacing prose.
  return { ...timing, text, words, segments: [{ start: words[0].start, end: words.at(-1).end, text }], timingEstimated: true };
}
