import test from 'node:test';import assert from 'node:assert/strict';
import {storyRange,saveStoryRange,storyGroupRange,parseStoryTimecode} from '../src/story-range.js';
import {exportProjectJSON,importProjectJSON} from '../src/project-json.js';
const cues=[{id:'a',start:0,end:2},{id:'b',start:4,end:6},{id:'c',start:8,end:10}],time=c=>c;
const card={id:'card',kind:'cue',col:'video',label:'Studio',cueRefs:['a','b','c'],sourceCueRefs:['a','b','c'],sin:0,sout:10};
test('Exact manual timecodes override live cues, while legacy cards retain cue-derived ranges',()=>{
 const patch=saveStoryRange(card,{start:1.12,end:9.28,refs:['a','b','c'],relink:true});
 assert.deepEqual(storyRange({...card,...patch},cues,time),{start:1.12,end:9.28});
 assert.deepEqual(storyRange({...card,sin:1.12,sout:9.28},cues,time),{start:0,end:10});
 assert.deepEqual(storyRange({...card,...patch,rangeMode:'cues'},cues,time),{start:0,end:10});
 assert.deepEqual(storyRange({...card,...patch},cues.map(c=>({...c,start:c.start+.4,end:c.end+.4})),time),{start:1.12,end:9.28});
 assert.deepEqual(storyGroupRange({...card,...patch},['b','c'],0,1,cues,time),{start:1.12,end:9.28});
 assert.deepEqual(storyGroupRange({...card,...patch},['a'],0,2,cues,time),{start:1.12,end:2});
 assert.deepEqual(storyGroupRange({...card,...patch},['c'],1,2,cues,time),{start:8,end:9.28});
});
test('Saving silent ranges and authored audio never erases text; relinking is explicit',()=>{
 const saved=saveStoryRange(card,{start:2.2,end:3.8,refs:[],relink:true},'Authored text');assert.equal(saved.body,'Authored text');assert.deepEqual(saved.sourceCueRefs,card.sourceCueRefs);assert.deepEqual(saved.cueRefs,[]);
 const audio={...card,kind:'audio',body:'VO copy'};
 assert.deepEqual(saveStoryRange(audio,{start:1,end:3,refs:['a'],relink:false}),{sin:1,sout:3,rangeMode:'manual'});
 assert.throws(()=>saveStoryRange(card,{start:2,end:1,refs:[],relink:false}));
});
test('25fps timecodes validate field bounds and preserve source offset and individual frames',()=>{
 assert.equal(parseStoryTimecode('00:00:01:03'),1.12);assert.ok(Math.abs(parseStoryTimecode('01:00:01:03',3600)-1.12)<1e-9);
 for(const text of ['00:00:01:25','00:60:00:00','00:00:60:00','invalid'])assert.equal(parseStoryTimecode(text),null);
 assert.ok(parseStoryTimecode('00:59:59:00',3600)<0);
});
test('Manual Story ranges round-trip in project JSON and invalid overrides fail validation',()=>{
 const project={media:{},rows:[{id:'r',label:'Row',cards:[{...card,assetKey:null,rangeMode:'manual',sin:1.12,sout:9.28}]}],mtl:{tracks:[],clips:[],markers:[]},rules:{},ui:{},reviews:[]};
 const saved=exportProjectJSON(project);assert.equal(importProjectJSON(saved).rows[0].cards[0].sin,1.12);
 const invalid=JSON.parse(saved);invalid.project.rows[0].cards[0].sout=0;assert.throws(()=>importProjectJSON(JSON.stringify(invalid)),/manual Story range/);
});
