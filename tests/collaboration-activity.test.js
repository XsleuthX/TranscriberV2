import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanActivity, emptyDiscussion, registerMember, validateDiscussion, applyDiscussionOperation, anchorStatus, textFingerprint } from '../src/collaboration-activity.js';
import { exportProjectJSON, importProjectJSON } from '../src/project-json.js';
const alice='a'.repeat(32),bob='b'.repeat(32),now='2026-11-06T10:00:00.000Z';
const anchor={workspace:'subtitle',kind:'cue',assetKey:'one',id:'cue',track:'B',field:'text',start:1,end:4,quote:'ell',textHash:textFingerprint('Hello')};
function people(){return registerMember(registerMember(emptyDiscussion(),alice,'Alice',now),bob,'Bob',now);}
const actor={id:alice,name:'Alice'};

test('presence sanitizes location payloads, distinguishes sources/tracks and keeps UTF-16 offsets',()=>{
  const location=cleanActivity({...anchor,draft:'Hello',editing:true,password:'secret',screenX:300});
  assert.equal(location.assetKey,'one');assert.equal(location.track,'B');assert.equal(location.start,1);
  assert.ok(!('password' in location)&&!('screenX' in location));
  assert.throws(()=>cleanActivity({...anchor,start:4,end:1}),/range/);
  assert.throws(()=>cleanActivity({...anchor,workspace:'unknown'}),/location/);
  assert.throws(()=>cleanActivity({...anchor,workspace:'__proto__'}),/location/);
  assert.throws(()=>cleanActivity({...anchor,selectionIds:Array(101).fill('a')}),/selected/);
  assert.notEqual(textFingerprint('😀 hello'),textFingerprint('😃 hello'));
});
test('member identities and colours persist across rename, and mentions/assignments reference IDs',()=>{
  let discussion=people();const colour=discussion.members[0].colour;
  assert.notEqual(colour,discussion.members[1].colour);
  discussion=registerMember(discussion,alice,'Alice renamed',now);assert.equal(discussion.members[0].colour,colour);assert.equal(discussion.members.length,2);
  discussion=applyDiscussionOperation(discussion,{id:'1'.repeat(32),action:'create',anchor,text:'Please check @Bob',mentions:[bob],assignee:bob},actor,now);
  const thread=discussion.threads[0];assert.equal(thread.assignee,bob);assert.deepEqual(thread.messages[0].mentions,[bob]);
  assert.ok(!('draft' in thread.anchor));assert.ok(!('editing' in thread.anchor));
  assert.throws(()=>applyDiscussionOperation(discussion,{id:'2'.repeat(32),action:'assign',threadId:thread.id,assignee:'c'.repeat(32)},actor,now),/owner/);
});
test('replies append without losing concurrent messages, retries are idempotent, and resolving/reopening retains history',()=>{
  let d=applyDiscussionOperation(people(),{id:'1'.repeat(32),action:'create',anchor,text:'First'},actor,now);
  const reply={id:'2'.repeat(32),action:'reply',threadId:d.threads[0].id,text:'Second',mentions:[]};
  d=applyDiscussionOperation(d,reply,{id:bob,name:'Bob'},now);assert.equal(applyDiscussionOperation(d,reply,actor,now),d);
  d=applyDiscussionOperation(d,{...reply,id:'3'.repeat(32),text:'Third'},actor,now);assert.deepEqual(d.threads[0].messages.map(m=>m.text),['First','Second','Third']);
  d=applyDiscussionOperation(d,{id:'4'.repeat(32),action:'resolve',threadId:d.threads[0].id},actor,now);assert.equal(d.threads[0].resolved,true);
  d=applyDiscussionOperation(d,{id:'5'.repeat(32),action:'reopen',threadId:d.threads[0].id},actor,now);assert.equal(d.threads[0].resolved,false);assert.equal(d.threads[0].messages.length,3);
  assert.deepEqual(validateDiscussion(d),d);
});
test('comments survive project JSON and removed/changed targets stay explicit; malformed archives are rejected',()=>{
  const discussion=applyDiscussionOperation(people(),{id:'1'.repeat(32),action:'create',anchor,text:'<script>literal</script>',mentions:[bob]},actor,now);
  const project={media:{one:{name:'One',type:'local',words:[{t:'Hello',s:0,e:1}],cues:[],cuesB:[{id:'cue',ws:0,we:0}],clips:[]}},rows:[],mtl:{tracks:[],clips:[],markers:[]},rules:{},reviews:[],discussion,ui:{},activeAsset:'one'};
  assert.deepEqual(importProjectJSON(exportProjectJSON(project)).discussion,discussion);
  assert.equal(anchorStatus(project,anchor),'available');project.media.one.cuesB[0].textOverride='Goodbye';assert.equal(anchorStatus(project,anchor),'Text changed');
  project.media.one.cuesB=[];assert.equal(anchorStatus(project,anchor),'Caption removed');delete project.media.one;assert.equal(anchorStatus(project,anchor),'Source removed');
  assert.equal(anchorStatus(project,{...anchor,kind:'transcript',assetKey:'__proto__'}),'Source removed');
  const invalid=structuredClone(discussion);invalid.threads[0].messages[0].mentions=['unknown'];assert.throws(()=>validateDiscussion(invalid),/message/);
  assert.deepEqual(validateDiscussion(undefined),emptyDiscussion());
});
