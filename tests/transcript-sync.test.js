import test from 'node:test';
import assert from 'node:assert/strict';
import { editTranscript } from '../src/transcript-edit.js';
import { scan, spellingCoverage, parseComments } from '../src/vet-core.js';
const cueText=(c,w)=>c.textOverride??w.slice(c.ws,c.we+1).map(w=>w.t).join(' ');
const cueTime=(c,w)=>({start:c.startOverride??w[c.ws]?.s??0,end:c.endOverride??w[c.we]?.e??1});
const fixture=()=>({words:['We','recognize','color.','Stop','weaponizing','words.'].map((t,i)=>({i,t,s:i,e:i+.8,sp:'S1'})),cues:[{id:'a',ws:0,we:2,textOverride:'We recognize\ncolor.',startOverride:0,endOverride:2.8},{id:'b',ws:null,we:null,textOverride:'Stop weaponizing words.',startOverride:3,endOverride:5.8}],cuesB:[{id:'a_B',ws:0,we:2,textOverride:'French text',startOverride:0,endOverride:2.8}],clips:[{id:'clip',in:0,out:2.8,cueRefs:['a']}]});
const run=(a,text)=>editTranscript(a,0,a.words.length-1,text,cueText,cueTime);
test('Transcript corrections reach indexed and pinned Sub A cues, retaining line breaks, times, B and references',()=>{
 const a=fixture(),r=run(a,'We recognise colour. Stop weaponising words.');
 assert.equal(r.conflicts,0);assert.deepEqual(r.asset.cues.map(c=>c.textOverride),['We recognise\ncolour.','Stop weaponising words.']);
 assert.deepEqual(r.asset.words.map(w=>[w.s,w.e]),a.words.map(w=>[w.s,w.e]));
 assert.deepEqual(r.asset.cues.map(c=>[c.id,c.startOverride,c.endOverride]),a.cues.map(c=>[c.id,c.startOverride,c.endOverride]));
 assert.deepEqual(r.asset.cuesB.map(c=>[c.textOverride,c.startOverride,c.endOverride]),[['French text',0,2.8]]);
 assert.deepEqual(r.asset.clips,a.clips);assert.equal(a.words[1].t,'recognize');
});
test('Inserted and deleted words do not duplicate text across cues and may empty a cue without deleting its ID',()=>{
 const a=fixture(),r=run(a,'We really recognise colour. Stop words.');
 assert.deepEqual(r.asset.cues.map(c=>c.textOverride),['We really recognise\ncolour.','Stop words.']);
 const deleted=run(a,'We recognize color.');assert.equal(deleted.asset.cues[1].textOverride,'');assert.equal(deleted.asset.cues[1].id,'b');
 const empty=run(a,'');assert.equal(empty.asset.words.length,0);assert.deepEqual(empty.asset.cues.map(c=>c.textOverride),['','']);
 assert.deepEqual(empty.asset.cuesB.map(c=>c.textOverride),['French text']);
});
test('Manual cue-only wording survives unrelated transcript corrections; ambiguous edits are reported',()=>{
 const a=fixture();a.cues[0].textOverride='<i>We recognize</i> lovely color.';
 const r=run(a,'We recognise colour. Stop weaponizing words.');
 assert.equal(r.asset.cues[0].textOverride,'<i>We recognise</i> lovely colour.');assert.equal(r.conflicts,0);
 a.cues[0].textOverride='Independent rewrite.';const conflict=run(a,'We realise color. Stop weaponizing words.');
 assert.equal(conflict.asset.cues[0].textOverride,'Independent rewrite.');assert.ok(conflict.conflicts>0);
});
test('Paragraph boundaries and CJK edits retain later source timings',()=>{
 const a=fixture(),r=editTranscript(a,0,2,'We recognise lovely colour.',cueText,cueTime);
 assert.equal(r.asset.cues[1].textOverride,a.cues[1].textOverride);assert.deepEqual(r.asset.words.slice(-3),a.words.slice(-3).map((w,i)=>({...w,i:i+4})));
 const c={words:[{i:0,t:'你',s:0,e:1},{i:1,t:'好',s:1,e:2}],cues:[{id:'c',ws:0,we:1,textOverride:'你好',startOverride:0,endOverride:2}]};
 assert.equal(run(c,'您好').asset.cues[0].textOverride,'您好');
});
test('UK families cover inflections and nouns without arbitrary suffix rewrites',()=>{
 const text='weaponize weaponizes weaponized weaponizing weaponization weaponizations WEAPONIZING Weaponizing recognize recognizable modernizing digitization paralyzing color size sizes sized sizing prize prized prizes prizing seize seizing capsize capsizing squeeze squeezing';
 const flags=scan({cues:[{id:0,current:text}]},[],{uk:true,chinese:'off'});
 assert.deepEqual(flags.map(f=>f.to),['weaponise','weaponises','weaponised','weaponising','weaponisation','weaponisations','WEAPONISING','Weaponising','recognise','recognisable','modernising','digitisation','paralysing','colour']);
 assert.ok(spellingCoverage().count>900);assert.ok(spellingCoverage().families>100);
 assert.equal(scan({cues:[{id:0,current:'https://weaponizing.com a@weaponizing.com weaponizing2 _weaponizing éweaponizing <i>weaponizing</i>'}]},[],{uk:true,chinese:'off'}).length,1);
 const parsed=parseComments('weaponizing → weaponising\nDr Lotus → Dr. Lotus\nReplace "health care" with "healthcare"');assert.equal(parsed.rules.length,3);assert.deepEqual(parsed.unparsed,[]);
});
