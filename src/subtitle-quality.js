// Text comes from decode order. Acoustic word ranges may anchor it only after
// reconciliation; punctuation/case differences are harmless, word differences aren't.
export const speechText = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const length = text => [...String(text).replace(/\s/gu, '')].length;
const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const closing = /^[\s\p{Pe}\p{Pf},.!?;:，。！？、；：…]+$/u;
const punctuation = /[,.!?;:，。！？；：]\s*$/u;
const finite = value => value != null && value !== '' && Number.isFinite(Number(value));
const inOrder = words => words.every((w,i) => i === 0 || (w.s >= words[i-1].s && w.e >= words[i-1].e));
const unique = list => [...new Set(list)];
export function confidenceReasons(segment) {
  const reasons = [];
  if (finite(segment.logprob) && segment.logprob < -.85) reasons.push('Low recognition confidence; compare with audio.');
  if (finite(segment.noSpeech) && segment.noSpeech > .55) reasons.push('Model reports possible non-speech.');
  if (finite(segment.compress) && segment.compress > 2.6) reasons.push('Repetitive decoding; compare with audio.');
  return reasons;
}
export function normaliseSpeech(data, offset = 0) {
  const words = (data.words || []).filter(w => finite(w.start) && finite(w.end) && Number(w.start) + offset >= 0 && Number(w.end) > Number(w.start))
    .map(w => ({ s: Number(w.start) + offset, e: Number(w.end) + offset, t: String(w.word ?? w.text ?? '').trim(),
      sp: 'S1', edited: false, timingEstimated: !!data.timingEstimated })).filter(w => w.t);
  const segments = (data.segments || []).filter(s => finite(s.start) && finite(s.end) && Number(s.start) + offset >= 0 && Number(s.end) > Number(s.start) && String(s.text || '').trim())
    .map(s => ({ start: Number(s.start) + offset, end: Number(s.end) + offset, text: String(s.text).trim(),
      logprob: finite(s.avg_logprob ?? s.logprob) ? Number(s.avg_logprob ?? s.logprob) : null,
      noSpeech: finite(s.no_speech_prob ?? s.noSpeech) ? Number(s.no_speech_prob ?? s.noSpeech) : null,
      compress: finite(s.compression_ratio ?? s.compress) ? Number(s.compression_ratio ?? s.compress) : null,
      timingEstimated: !!(s.timingEstimated || data.timingEstimated), qualityReasons: [...(s.qualityReasons || [])] }));
  return { words, segments };
}
// Remove only decoded overlap that can be located in the incoming segment's
// word stream. When alignment fails, retain the text and flag the boundary.
export function appendSpeechChunk(target, data, offset, overlap = 0) {
  const incoming = normaliseSpeech(data, offset), cut = offset + overlap;
  for (const s of incoming.segments) {
    if (s.end <= cut) continue;
    if (s.start < cut) {
      const mine = incoming.words.filter(w => (w.s + w.e) / 2 >= s.start - .05 && (w.s + w.e) / 2 <= s.end + .05);
      const same = mine.length && inOrder(mine) && speechText(mine.map(w => w.t).join('')) === speechText(s.text);
      const dropped = mine.filter(w => w.e <= cut);
      if (same && dropped.length) {
        s.text = afterLetters(s.text, speechText(dropped.map(w => w.t).join('')).length).replace(/^[\s,，。.!?！？;；:：]+/u, '');
        s.start = mine[dropped.length]?.s ?? cut;
      } else {
        s.qualityReasons.push('Chunk boundary could not be reconciled; retained overlap text for review.');
        s.timingEstimated = true;
      }
    }
    if (s.text && !target.segments.some(old => speechText(old.text) === speechText(s.text) && Math.abs(old.start - s.start) < .5 && Math.abs(old.end - s.end) < .5))
      target.segments.push(s);
  }
  for (const w of incoming.words) {
    if (w.e <= cut || target.words.some(old => speechText(old.t) === speechText(w.t) && Math.abs(old.s - w.s) < .35 && Math.abs(old.e - w.e) < .35)) continue;
    target.words.push(w);
  }
}
function afterLetters(text, count) {
  let at = 0, seen = 0;
  for (const ch of text) { if (seen >= count) break; at += ch.length; seen += speechText(ch).length; }
  return text.slice(at);
}
function lexicalTokens(text, terms) {
  // Proper names in the user's dictionary, plus common English honorifics,
  // stay together even in a Chinese sentence.
  const protectedRanges = [];
  for (const term of terms.filter(Boolean).sort((a,b) => b.length - a.length)) {
    let at = 0;
    while ((at = text.toLowerCase().indexOf(term.toLowerCase(), at)) >= 0) { protectedRanges.push([at, at + term.length]); at += term.length; }
  }
  for (const match of text.matchAll(/\b(?:Dr|Mr|Mrs|Ms|Prof)\.?\s+[\p{L}\p{M}]+/gu)) protectedRanges.push([match.index, match.index + match[0].length]);
  const raw = [...new Intl.Segmenter(cjk.test(text) ? 'zh' : 'en', { granularity: 'word' }).segment(text)];
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    let token = raw[i].segment, end = raw[i].index + token.length;
    let protectedEnd = Math.max(end, ...protectedRanges.filter(([a,b]) => a < end && b > raw[i].index).map(([,b]) => b));
    while (i + 1 < raw.length && raw[i + 1].index < protectedEnd) {
      token += raw[++i].segment; end = raw[i].index + raw[i].segment.length;
      protectedEnd = Math.max(protectedEnd, ...protectedRanges.filter(([a,b]) => a < end && b > raw[i].index).map(([,b]) => b));
    }
    if (tokens.length && closing.test(token)) tokens[tokens.length - 1] += token;
    else tokens.push(token);
  }
  return tokens;
}
export function coalesceSegmentFragments(segments, terms = []) {
  const result=[];
  for(const source of [...segments].sort((a,b)=>a.start-b.start)) {
    const s={...source}, prev=result.at(-1);
    if(prev && s.start-prev.end>=-.05 && s.start-prev.end<=.25 && s.end-prev.start<=20 && length(prev.text+s.text)<=100) {
      const separator=/[A-Za-z0-9]$/.test(prev.text) && /^[A-Za-z0-9]/.test(s.text) ? ' ' : '';
      const joined=prev.text+separator+s.text, boundary=prev.text.length;
      const lexical=[...new Intl.Segmenter('zh',{granularity:'word'}).segment(joined)];
      const splitWord=lexical.some(t=>t.isWordLike && cjk.test(t.segment) && t.index<boundary && t.index+t.segment.length>boundary);
      const name=/\b(?:Dr|Mr|Mrs|Ms|Prof)\.?$/u.test(prev.text) && /^[A-Z][a-z]/.test(s.text);
      const leadingPunct=/^[,，。.!?！？;；:：]/u.test(s.text);
      const left=speechText(prev.text), right=speechText(s.text);
      const termSplit=terms.some(term=>{const normal=speechText(term); for(let i=1;i<normal.length;i++) if(left.endsWith(normal.slice(0,i)) && right.startsWith(normal.slice(i))) return true; return false;});
      if(splitWord || name || leadingPunct || termSplit) {
        prev.text=joined; prev.end=Math.max(prev.end,s.end);
        prev.timingEstimated=!!(prev.timingEstimated || s.timingEstimated);
        for(const [field,fn] of [['logprob',Math.min],['noSpeech',Math.max],['compress',Math.max]]) {
          const values=[prev[field],s[field]].filter(finite).map(Number); prev[field]=values.length?fn(...values):null;
        }
        prev.qualityReasons=unique([...(prev.qualityReasons || []),...(s.qualityReasons || [])]);
        continue;
      }
    }
    result.push(s);
  }
  return result;
}
export function captionsFromSegments(segments, words, profile, fix = text => text, terms = []) {
  const cues = []; let unreconciled = 0;
  for (const s of coalesceSegmentFragments(segments,terms)) {
    const text = fix(String(s.text || '').trim());
    if (!text || !finite(s.start) || !finite(s.end) || s.end <= s.start) continue;
    const prof = cjk.test(text) ? { ...profile, maxChars: Math.min(profile.maxChars, 24), targetCps: 7 } : profile;
    const mine = words.filter(w => (w.s + w.e) / 2 >= s.start - .05 && (w.s + w.e) / 2 <= s.end + .05);
    const reconciled = mine.length > 0 && inOrder(mine) && speechText(mine.map(w => w.t).join('')) === speechText(text);
    if (!reconciled) unreconciled++;
    const boundaries = new Set(); let total = 0;
    if (reconciled) for (const w of mine) { total += speechText(w.t).length; boundaries.add(total); }
    const tokens = lexicalTokens(text, terms), pieces = [];
    let buf = '', done = 0;
    for (let i = 0; i < tokens.length; i++) {
      buf += tokens[i]; done += speechText(tokens[i]).length;
      const safe = !reconciled || boundaries.has(done);
      const nextLength = length(buf + (tokens[i + 1] || ''));
      if (safe && (i === tokens.length - 1 || nextLength > prof.maxChars || (punctuation.test(buf) && length(buf) >= prof.maxChars * .45))) {
        pieces.push(buf); buf = '';
      }
    }
    if (buf) pieces.push(buf);
    if (pieces.length > 1 && length(pieces.at(-1)) < 4 && length(pieces.at(-2) + pieces.at(-1)) <= prof.maxChars * 1.4)
      pieces.splice(-2, 2, pieces.at(-2) + pieces.at(-1));
    let cursor = 0, wordIndex = 0, wordLetters = 0;
    const allLetters = speechText(text).length || length(text) || 1;
    for (const piece of pieces) {
      const fromLetters = cursor; cursor += speechText(piece).length || (allLetters === length(text) ? length(piece) : 0);
      let start, end;
      if (reconciled) {
        const first = wordIndex;
        while (wordIndex < mine.length && wordLetters < cursor) wordLetters += speechText(mine[wordIndex++].t).length;
        start = mine[first]?.s ?? s.start; end = mine[Math.max(first, wordIndex - 1)]?.e ?? s.end;
      } else {
        start = s.start + (s.end - s.start) * fromLetters / allLetters;
        end = s.start + (s.end - s.start) * cursor / allLetters;
      }
      const reasons = [...confidenceReasons(s), ...(s.qualityReasons || [])];
      const estimated = !!s.timingEstimated || (!reconciled && pieces.length > 1) || (reconciled && mine.some(w => w.timingEstimated));
      if (estimated) reasons.push('Split timing is estimated; compare with audio.');
      if (end - start < .6) reasons.push('Short caption; review readability.');
      if (end - start > prof.maxDur) reasons.push('Long caption; review pacing against audio.');
      if (length(piece) > prof.maxChars * 1.4) reasons.push('Long phrase retained to avoid splitting a word or name.');
      if (length(piece) / Math.max(.04,end - start) > prof.targetCps * 1.5) reasons.push('Fast reading speed; review caption breaks.');
      end = Math.max(end, start + .04);
      cues.push({ id: `s${cues.length}`, ws: null, we: null, textOverride: piece.trim(), startOverride: start, endOverride: end,
        orig: { start, end, text: piece.trim() }, timingSource: reconciled ? 'word' : estimated ? 'estimated' : 'segment',
        timingEstimated: estimated, confidence: { logprob: s.logprob ?? null, noSpeech: s.noSpeech ?? null, compress: s.compress ?? null },
        qualityReasons: unique(reasons), suspect: reasons.length > 0 });
    }
  }
  return { cues, unreconciled };
}
// Transcript mode must use the same authoritative prose as Subtitle mode.
// A provider's out-of-order/mismatched word array must never rewrite sentences.
export function transcriptWordsFromSegments(segments, words, fix = text => text, terms = []) {
  if (!segments.length) return words.map((w,i)=>({...w,i,t:fix(w.t)}));
  const result=[];
  for(const s of coalesceSegmentFragments(segments,terms)) {
    const text=fix(String(s.text || '').trim()); if(!text || !(s.end>s.start)) continue;
    const mine=words.filter(w=>(w.s+w.e)/2>=s.start-.05 && (w.s+w.e)/2<=s.end+.05);
    const same=mine.length && inOrder(mine) && speechText(mine.map(w=>fix(w.t)).join(''))===speechText(text);
    if(same) {
      let rest=text;
      for(let i=0;i<mine.length;i++) {
        let cut=i===mine.length-1 ? rest.length : rest.length-afterLetters(rest,speechText(fix(mine[i].t)).length).length;
        while(cut<rest.length && /^[\p{Pe}\p{Pf},.!?;:，。！？、；：…]$/u.test(rest[cut])) cut++;
        const t=rest.slice(0,cut).trim(); rest=rest.slice(cut);
        if(t) result.push({...mine[i],t,timingEstimated:!!(mine[i].timingEstimated || s.timingEstimated),timingSource:'word'});
      }
    } else {
      const tokens=lexicalTokens(text,terms), weights=tokens.map(t=>Math.max(1,speechText(t).length)), total=weights.reduce((a,b)=>a+b,0);
      let used=0;
      for(let i=0;i<tokens.length;i++) {
        const from=s.start+(s.end-s.start)*used/total; used+=weights[i];
        const t=tokens[i].trim();
        if(t) result.push({t,s:from,e:s.start+(s.end-s.start)*used/total,sp:'S1',edited:false,timingEstimated:true,timingSource:'estimated'});
      }
    }
  }
  return result.map((w,i)=>({...w,i}));
}
// Never discard a cue swallowed by an overlap. Adjust two partially overlapping
// intervals at a shared boundary; retain nested intervals and flag for a person.
export function sanitiseCaptionTimes(cues, cueTime) {
  const out = [...cues].sort((a,b) => cueTime(a).start - cueTime(b).start).map(c => ({ ...c, qualityReasons: [...(c.qualityReasons || [])] }));
  for (let i = 1; i < out.length; i++) {
    const previous = out[i - 1], current = out[i], a = cueTime(previous), b = cueTime(current);
    if (b.start >= a.end) continue;
    const reason = 'Overlapping recognition timestamps; compare both captions with audio.';
    for (const c of [previous,current]) { c.qualityReasons = unique([...c.qualityReasons,reason]); c.suspect = true; }
    if (b.end > a.end && a.end - b.start < .5) {
      const boundary = (a.end + b.start) / 2;
      previous.endOverride = boundary; current.startOverride = boundary;
    }
  }
  return out;
}
const boilerplate = /amara\.org|字幕组|subtitles?\s+by|thanks?\s+for\s+watching|谢谢观看|谢谢收看|请不吝点赞|www\.[a-z0-9-]+\.(?:com|org|net)|^(?:音乐|掌声|BGM|MUSIC|APPLAUSE)$/i;
export function reviewCaptionQuality(cues, cueText, cueTime) {
  let removed = 0; const out = [];
  for (const c of cues) {
    const text = cueText(c);
    if (!String(text).trim()) { removed++; continue; }
    const reasons = [...(c.qualityReasons || [])];
    if (boilerplate.test(text)) reasons.push('Possible boilerplate or non-speech; retained for audio review.');
    const prev = out.at(-1);
    if (prev && speechText(text) && speechText(text) === speechText(cueText(prev)) && cueTime(c).start - cueTime(prev).end < 1)
      reasons.push('Immediate repeated phrase; retained because repetition may be genuine.');
    out.push({ ...c, qualityReasons: unique(reasons), suspect: !!c.suspect || reasons.length > 0 });
  }
  return { cues: out, removed };
}
// Energy is only a screen for possible missing speech. Bridge brief phonetic
// pauses, use a robust noise floor (not the loudest peak), and never retry
// uncovered quiet intervals simply because they are long.
export function audioActivity(samples, rate = 16000) {
  const win = Math.max(1, Math.floor(rate * .05)), n = Math.ceil(samples.length / win), rms = new Float32Array(n);
  for (let i=0; i<n; i++) { let sum=0; const end=Math.min(samples.length,(i+1)*win); for(let j=i*win;j<end;j++) sum+=samples[j]*samples[j]; rms[i]=Math.sqrt(sum/Math.max(1,end-i*win)); }
  const sorted = [...rms].sort((a,b)=>a-b);
  const threshold = Math.max(.002, (sorted[Math.floor(n*.2)] || 0)*3, (sorted[Math.floor(n*.9)] || 0)*.12);
  return { rms, threshold, step: win/rate, duration: samples.length/rate };
}
export function activityFraction(activity, from, to) {
  const first=Math.max(0,Math.floor(from/activity.step)), last=Math.min(activity.rms.length,Math.ceil(to/activity.step));
  let active=0; for(let i=first;i<last;i++) if(activity.rms[i]>activity.threshold) active++;
  return active/Math.max(1,last-first);
}
export function missingAudioRanges(activity, covered, minActive = .55) {
  const spans = covered.map(([from,to])=>[from-.15,to+.15]).sort((a,b)=>a[0]-b[0]);
  const ranges=[]; let index=0, from=null, last=null, active=0;
  const flush=()=> { if(from != null && active*activity.step>=minActive && last-from>=.65)
    for(let a=from;a<last;a+=18) ranges.push({from:a,to:Math.min(last,a+18),activeSeconds:active*activity.step});
    from=null; last=null; active=0; };
  for(let i=0;i<activity.rms.length;i++) {
    const time=i*activity.step;
    while(index<spans.length && spans[index][1]<time) index++;
    const isCovered=index<spans.length && spans[index][0]<=time;
    if(isCovered) { flush(); continue; }
    if(activity.rms[i]>activity.threshold) { if(from==null) from=time; last=Math.min(activity.duration,time+activity.step); active++; }
    else if(from!=null && time-last>.3) flush();
  }
  flush(); return ranges;
}
export function acceptableRepair(data, offset, range, existing, activity) {
  const result=normaliseSpeech(data,offset), accepted=[];
  for(const s of result.segments) {
    if(s.start<range.from-.35 || s.end>range.to+.35 || confidenceReasons(s).length || boilerplate.test(s.text)) continue;
    if(activityFraction(activity,s.start,s.end)<.18 || existing.some(old=>s.start<old.end-.02 && s.end>old.start+.02)) continue;
    s.repaired=true;
    s.qualityReasons.push('Possible missing audio recovered automatically; confirm against audio.');
    accepted.push(s);
  }
  return { segments: accepted, words: result.words.filter(w=>accepted.some(s=>w.s>=s.start-.05 && w.e<=s.end+.05)) };
}
// Conservative UTF-8 byte budget also bounds tokens without guessing that
// 224 Whisper tokens equals 224 characters. Keep terminology and latest tail.
export function buildSpeechPrompt(terms = [], tail = '', budget = 192) {
  const size = value => new TextEncoder().encode(value).length;
  let seed=''; for(const term of terms.filter(Boolean)) { const candidate=seed ? seed+'、'+term : term; if(size(candidate)>Math.floor(budget*.55)) continue; seed=candidate; }
  let context=''; for(const ch of [...String(tail).trim()].reverse()) { if(size(seed+'\n'+ch+context)>budget) break; context=ch+context; }
  return [seed,context].filter(Boolean).join('\n');
}
export function correctGlossary(text, rules) {
  let result=text;
  for(const [from,to] of rules) {
    if(!from) continue;
    const escaped=from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const before=/^[A-Za-z0-9]/.test(from) ? '(?<![\\p{Script=Latin}\\p{N}_])' : '';
    const after=/[A-Za-z0-9]$/.test(from) ? '(?![\\p{Script=Latin}\\p{N}_])' : '';
    result=result.replace(new RegExp(before+escaped+after,'giu'),()=>to);
  }
  return result;
}
