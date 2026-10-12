export function textMatches(text, query, matchCase = false) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...String(text).matchAll(new RegExp(escaped, matchCase ? 'gu' : 'giu'))].map(m => ({ start: m.index, end: m.index + m[0].length }));
}
export function replaceText(text, query, replacement, matchCase = false, only = null) {
  const matches = textMatches(text, query, matchCase); let result = '', cursor = 0;
  matches.forEach((m, i) => { if (only !== null && only !== i) return; result += text.slice(cursor, m.start) + replacement; cursor = m.end; });
  return { text: result + text.slice(cursor), count: only === null ? matches.length : (matches[only] ? 1 : 0) };
}
export function timedText(words) {
  let text = ''; const spans = [];
  for (const word of words) {
    if (text && !(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(text) && /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word.t)) && !/^[,，。！？、；：.!?;:]/.test(word.t)) text += ' ';
    const start = text.length; text += word.t; spans.push({ start, end: text.length, word });
  }
  return { text, spans };
}
// Each replacement inherits timing from the characters it replaces. Unchanged
// words keep their original timestamps; inserting/removing tokens keeps cues
// anchored to their previous media times in the caller.
export function replaceTimedWords(words, query, replacement, matchCase = false, only = null) {
  const { text, spans } = timedText(words), matches = textMatches(text, query, matchCase).filter((_, i) => only === null || i === only);
  if (!matches.length) return { words, count: 0 };
  const characters = new Array(text.length).fill(null); // RegExp indexes use UTF-16 offsets.
  spans.forEach(({ start, end, word }, sourceIndex) => {
    for (let i = start; i < end; i++) characters[i] = { s: word.s + (word.e - word.s) * (i - start) / (end - start), e: word.s + (word.e - word.s) * (i - start + 1) / (end - start), word, sourceIndex };
  });
  let edited = '', timing = [], cursor = 0;
  const append = values => { for (const value of values) timing.push(value); };
  const nearest = (index, step) => { for (let i = index; i >= 0 && i < characters.length; i += step) if (characters[i]) return characters[i]; };
  for (const match of matches) {
    edited += text.slice(cursor, match.start); append(characters.slice(cursor, match.start));
    const owners = characters.slice(match.start, match.end).filter(Boolean);
    const previous = nearest(match.start - 1, -1), next = nearest(match.end, 1);
    const from = owners[0]?.s ?? previous?.e ?? next?.s ?? 0, to = owners.at(-1)?.e ?? next?.s ?? previous?.e ?? from;
    edited += replacement;
    for (let i = 0; i < replacement.length; i++) timing.push({ s: from + (to - from) * i / replacement.length, e: from + (to - from) * (i + 1) / replacement.length, sourceIndex: owners[0]?.sourceIndex ?? previous?.sourceIndex ?? next?.sourceIndex, word: { sp: owners[0]?.word.sp || previous?.word.sp || 'S1', edited: true } });
    cursor = match.end;
  }
  edited += text.slice(cursor); append(characters.slice(cursor));
  const tokens = [...edited.matchAll(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu)];
  const rebuilt = tokens.map((token, i) => {
    const owners = timing.slice(token.index, token.index + token[0].length).filter(Boolean), first = owners[0], last = owners.at(-1);
    return { i, t: token[0], s: first?.s ?? 0, e: last?.e ?? first?.s ?? 0, sp: first?.word.sp || 'S1', edited: owners.some(o => o.word.edited), sourceIndex: first?.sourceIndex };
  });
  return { words: rebuilt, count: matches.length };
}
