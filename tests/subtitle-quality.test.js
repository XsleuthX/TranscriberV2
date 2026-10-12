import test from 'node:test';
import assert from 'node:assert/strict';
import { captionsFromSegments, sanitiseCaptionTimes, reviewCaptionQuality, appendSpeechChunk, normaliseSpeech,
  audioActivity, missingAudioRanges, acceptableRepair, buildSpeechPrompt, correctGlossary, coalesceSegmentFragments, transcriptWordsFromSegments } from '../src/subtitle-quality.js';
const profile={maxChars:16,maxDur:5.5,targetCps:7};
const time=c=>({start:c.startOverride,end:c.endOverride});
const text=c=>c.textOverride;
const words=(tokens,start=1)=>tokens.map((t,i)=>({t,s:start+i*.5,e:start+i*.5+.3}));

test('Chinese words and English proper names stay intact; closing punctuation never starts a generated split',()=>{
  const original='所以就用这个词,Dr. Lotus,所以有时候你以为是博士,其实不是博士。到底是荷花还是睡莲？';
  const {cues}=captionsFromSegments([{start:1,end:18,text:original}],[],profile,t=>t,['Dr. Lotus']);
  assert.equal(cues.map(text).join(''),original);
  for(const term of ['Dr. Lotus','博士','睡莲']) assert.ok(cues.some(c=>text(c).includes(term)),term);
  assert.ok(cues.every(c=>!/^[,，。！？?]/u.test(text(c))));
  assert.ok(cues.every(c=>c.timingEstimated && c.qualityReasons.some(r=>r.includes('estimated'))));
});
test('Adjacent provider segments splitting 博士, Dr Lotus or leading punctuation are regrouped without lexical correction',()=>{
  const source=[{start:60,end:63,text:'所以就用这个词,Dr'}, {start:63,end:66,text:'Lotus,所以有时候你以为是博'},
    {start:66,end:68,text:'士,其实不是博士,'},{start:69,end:72,text:'到底是荷花还是碎莲'},{start:72,end:75,text:'?其实那是碎莲'}];
  const joined=coalesceSegmentFragments(source,['Dr. Lotus']);
  assert.equal(joined.length,2); assert.ok(joined[0].text.includes('Dr Lotus')); assert.ok(joined[0].text.includes('博士'));
  assert.ok(joined[1].text.includes('碎莲?')); // No guessed semantic correction.
  const built=captionsFromSegments(source,[],profile,t=>t,['Dr Lotus']);
  assert.equal(built.cues.map(text).join('').replace(/\s/g,''),source.map(s=>s.text).join(''));
  assert.ok(built.cues.some(c=>text(c).includes('博士')));
  assert.ok(built.cues.every(c=>!text(c).startsWith('?')));
  assert.equal(source[0].end,63);
});
test('Punctuation differences reconcile without changing decoded text; starts and ends follow actual words',()=>{
  const tokens=['所以','就','用','这个','词','Dr. Lotus','所以','有时候','你','以为','是','博士','其实','不是','博士'];
  const w=words(tokens), original='所以就用这个词,Dr. Lotus,所以有时候你以为是博士,其实不是博士。';
  const {cues,unreconciled}=captionsFromSegments([{start:0,end:15,text:original}],w,profile);
  assert.equal(unreconciled,0); assert.equal(cues.map(text).join(''),original);
  assert.equal(cues[0].startOverride,1); assert.equal(cues.at(-1).endOverride,w.at(-1).e);
  assert.ok(cues.every(c=>!c.timingEstimated && c.timingSource==='word'));
  for(const c of cues) { assert.ok(w.some(x=>x.s===c.startOverride)); assert.ok(w.some(x=>x.e===c.endOverride)); }
});
test('Long timed speech is not shortened using a reading-speed guess; uncertain word order cannot rewrite text',()=>{
  const long='This carefully spoken sentence contains long pauses.';
  const w=[{t:long,s:2,e:15}];
  const {cues}=captionsFromSegments([{start:0,end:20,text:long}],w,{...profile,maxChars:42,targetCps:17});
  assert.equal(cues.length,1); assert.equal(cues[0].endOverride,15);
  const wrong=words(['葡萄牙','现在','德国']);
  const source='葡萄牙、德国。现在我们需要更长的一行字幕来测试。';
  const result=captionsFromSegments([{start:0,end:15,text:source}],wrong,profile);
  assert.equal(result.cues.map(text).join(''),source); assert.equal(result.unreconciled,1);
  assert.ok(result.cues.every(c=>c.timingEstimated));
});
test('Transcript word spine follows segment prose and punctuation, keeping verified anchors or explicitly estimated timing',()=>{
  const prose='葡萄牙、德国。现在我们开始。';
  const sg=[{start:1,end:9,text:prose}];
  const wrong=words(['葡萄牙','现在','德国']);
  const repaired=transcriptWordsFromSegments(sg,wrong);
  assert.equal(repaired.map(w=>w.t).join(''),prose); assert.ok(repaired.every(w=>w.timingEstimated));
  const anchors=[{t:'葡萄牙',s:1,e:2},{t:'德国',s:3,e:4},{t:'现在我们开始',s:6,e:9}];
  const verified=transcriptWordsFromSegments(sg,anchors);
  assert.equal(verified.map(w=>w.t).join(''),prose);
  assert.deepEqual(verified.map(w=>[w.s,w.e]),[[1,2],[3,4],[6,9]]);
  assert.ok(verified.every(w=>!w.timingEstimated));
});
test('Nested overlapping cue times and genuine repeated acknowledgements never silently delete text',()=>{
  const original=[{id:'a',textOverride:'谢谢观看',startOverride:0,endOverride:4},{id:'b',textOverride:'好',startOverride:1,endOverride:2},
    {id:'c',textOverride:'好',startOverride:2.2,endOverride:3}];
  const clean=sanitiseCaptionTimes(original,time);
  const result=reviewCaptionQuality(clean,text,time);
  assert.deepEqual(result.cues.map(text),original.map(text)); assert.equal(result.removed,0);
  assert.ok(result.cues[0].qualityReasons.some(r=>r.includes('boilerplate')));
  assert.ok(result.cues[2].qualityReasons.some(r=>r.includes('repeated')));
  assert.deepEqual(original[0].qualityReasons,undefined);
});
test('Overlap stitch retains the new clause of a segment crossing a chunk boundary',()=>{
  const target={words:[],segments:[]};
  const data={segments:[{start:0,end:4,text:'已经说过。新的内容！',avg_logprob:-.2}],
    words:[{start:0,end:1,word:'已经说过'},{start:2,end:4,word:'新的内容'}]};
  appendSpeechChunk(target,data,10,2);
  assert.equal(target.segments[0].text,'新的内容！'); assert.equal(target.segments[0].start,12);
  assert.equal(target.words.length,1); assert.equal(target.segments[0].logprob,-.2);
  appendSpeechChunk(target,data,10,2); assert.equal(target.segments.length,1);
  const uncertain={words:[],segments:[]};
  appendSpeechChunk(uncertain,{segments:[{start:0,end:4,text:'不能确定但必须保留的新内容'}]},10,2);
  assert.equal(uncertain.segments.length,1); assert.ok(uncertain.segments[0].timingEstimated);
});
test('No fabricated confidence and no invalid timestamp words enter the project',()=>{
  const result=normaliseSpeech({segments:[{start:0,end:1,text:'Hello'}],words:[{start:0,end:0,word:'bad'},{start:NaN,end:1,word:'bad'},{start:0,end:.5,word:'Hello'}]});
  assert.equal(result.words.length,1); assert.equal(result.segments[0].logprob,null); assert.equal(result.segments[0].noSpeech,null);
});
test('Missing audio detection bridges phonetic pauses while rejecting long silence and steady background',()=>{
  const rate=1000,samples=new Float32Array(rate*20);
  for(let i=rate*5;i<rate*8;i++) if(Math.floor(i/100)%4!==0) samples[i]=Math.sin(i)*.15;
  const activity=audioActivity(samples,rate), ranges=missingAudioRanges(activity,[[0,1],[10,20]]);
  assert.equal(ranges.length,1); assert.ok(ranges[0].from>=5 && ranges[0].to<=8);
  assert.equal(missingAudioRanges(audioActivity(new Float32Array(rate*30),rate),[]).length,0);
  assert.equal(missingAudioRanges(audioActivity(new Float32Array(rate*30).fill(.02),rate),[]).length,0);
});
test('Repair rejects non-empty low confidence, silence hallucinations, overlapping or out-of-window text',()=>{
  const rate=1000,samples=new Float32Array(rate*10);
  for(let i=rate*3;i<rate*6;i++) samples[i]=Math.sin(i)*.1;
  const activity=audioActivity(samples,rate), range={from:3,to:6};
  const response=(fields={})=>({segments:[{start:0,end:2,text:'真实内容',...fields}],words:[{start:0,end:2,word:'真实内容'}]});
  assert.equal(acceptableRepair(response({avg_logprob:-1.4}),3,range,[],activity).segments.length,0);
  assert.equal(acceptableRepair(response({text:'Thanks for watching'}),3,range,[],activity).segments.length,0);
  assert.equal(acceptableRepair(response(),3,range,[{start:3,end:4}],activity).segments.length,0);
  assert.equal(acceptableRepair(response({end:10}),3,range,[],activity).segments.length,0);
  const accepted=acceptableRepair(response({avg_logprob:-.1}),3,range,[],activity);
  assert.equal(accepted.segments.length,1); assert.equal(accepted.words[0].s,3); assert.equal(accepted.segments[0].logprob,-.1);
  assert.equal(acceptableRepair(response(),0,{from:0,to:2},[],activity).segments.length,0);
});
test('Prompt retains dictionary spellings and most recent context under a conservative byte budget',()=>{
  const tail='旧的上下文'.repeat(100)+'最新上下文Dr. Lotus';
  const prompt=buildSpeechPrompt(['Dr. Lotus','MBS','睡莲'],tail);
  assert.ok(prompt.startsWith('Dr. Lotus、MBS、睡莲'));
  assert.ok(prompt.endsWith('最新上下文Dr. Lotus'));
  assert.ok(new TextEncoder().encode(prompt).length<=192);
});
test('Glossary replacement is literal and respects Latin word boundaries inside bilingual speech',()=>{
  assert.equal(correctGlossary('theme he HE。荷花Dr Lotus', [['he','$&'],['Dr Lotus','Dr. Lotus']]), 'theme $& $&。荷花Dr. Lotus');
});
