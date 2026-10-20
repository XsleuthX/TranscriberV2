import test from 'node:test';
import assert from 'node:assert/strict';
import {serialScheduler,transcribeQueue,cacheAudio} from '../src/media-queue.js';
import {spellingCoverage,scan} from '../src/vet-core.js';
import {formatAudit} from '../src/vet-audit.js';
import {emptyVet,vetPolicy,validVet} from '../src/subtitle-vet.js';
import {parseQuotePicks,parseStoryPlan} from '../src/ai-assembly.js';
import {exportProjectJSON,importProjectJSON} from '../src/project-json.js';
test('batch preparation serializes more than twelve imports and continues after failures',async()=>{
 const schedule=serialScheduler();let running=0,peak=0;const finished=[];
 const jobs=Array.from({length:16},(_,i)=>schedule(async()=>{running++;peak=Math.max(peak,running);await Promise.resolve();running--;if(i===3)throw Error('Corrupt audio');finished.push(i);}));
 const out=await Promise.allSettled(jobs);assert.equal(peak,1);assert.equal(out.filter(r=>r.status==='fulfilled').length,15);assert.ok(finished.includes(15));
});
test('transcription queue reports failures and cancels pending sources without starting them',async()=>{
 const controller=new AbortController(),started=[];
 const items=await transcribeQueue(['a','b','c','d'],async key=>{started.push(key);if(key==='a')throw Error('Bad audio');if(key==='b')return {state:'completed'};controller.abort();return {state:'cancelled'};},controller.signal);
 assert.deepEqual(started,['a','b','c']);assert.deepEqual(items.map(i=>i.state),['failed','completed','cancelled','cancelled']);
});
test('decoded batch audio cache evicts recoverable old sources and protects active audio',()=>{
 const map=new Map();cacheAudio(map,'a',new Float32Array(4),{limit:32});cacheAudio(map,'b',new Float32Array(4),{limit:32});
 cacheAudio(map,'c',new Float32Array(4),{limit:32,protectedKeys:new Set(['a'])});assert.deepEqual([...map.keys()],['a','c']);
});
test('spelling checklist is exact and guards non-word boundaries and context-dependent terms',()=>{
 assert.ok(spellingCoverage().count>900);
 const flags=scan({cues:[{id:0,current:'color COLOR Color écolor color2 _color program license check meter https://color.com Dr. colorful.'}]},[],{uk:true,chinese:'off',contextual:false});
 assert.deepEqual(flags.map(f=>f.from),['color','COLOR','Color','colorful']);assert.deepEqual(flags.map(f=>f.to),['colour','COLOUR','Colour','colourful']);
});
test('format checklist flags timing, nested overlaps, length, lines, speed and whitespace without edits',()=>{
 const cues=[{id:'a',index:0,text:'A very long line\n\n trailing ',start:0,end:10},{id:'b',index:1,text:'abc',start:1,end:2},{id:'c',index:2,text:'',start:3,end:3}];
 const options={...emptyVet().options,format:true};const flags=formatAudit(cues,options,{maxChars:5,maxDur:5,targetCps:1});
 for(const check of ['timing','overlap','lineLength','lineCount','readingSpeed','whitespace','empty'])assert.ok(flags.some(f=>f.check===check),check);
 assert.equal(formatAudit(cues,{...options,format:false},{}).length,0);
 assert.equal(formatAudit(cues,{...options,audit:{overlap:false}},{}).filter(f=>f.check==='overlap').length,0);
 const doc={vet:{...emptyVet(),options},rules:{maxChars:35,maxDur:6,targetCps:14}};
 assert.match(vetPolicy(doc),/"maxChars":35/);assert.ok(validVet(doc.vet));assert.equal(validVet({...doc.vet,options:{...options,minDuration:-1}}),false);
 const backup={...doc,media:{},rows:[],mtl:{tracks:[],clips:[],markers:[]},reviews:[],activeAsset:null};
 assert.deepEqual(importProjectJSON(exportProjectJSON(backup)).vet,doc.vet);
});
test('Story suggestions avoid overlapping quote content even when model gives different IDs',()=>{
 const items=Array.from({length:4},(_,i)=>({id:'c'+i,assetKey:'a',index:i,cueId:'cue'+i,text:'Line '+i,start:i*3,end:i*3+2}));
 const picks=parseQuotePicks(JSON.stringify({clips:[{from:'c0',to:'c1'},{from:'c1',to:'c2'},{from:'c3',to:'c3'}]}),items);
 assert.equal(picks.length,2);
 const candidates=[{...picks[0],id:'q1'},{...picks[0],id:'q2'},{...picks[1],id:'q3'}];
 const plan=parseStoryPlan(JSON.stringify({sections:[{title:'Hook',clips:['q1','q2','q3']}]}),candidates);assert.deepEqual(plan[0].clips.map(c=>c.id),['q1','q3']);
});
