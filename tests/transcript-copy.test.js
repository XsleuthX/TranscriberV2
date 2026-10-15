import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptText} from '../src/transcript-copy.js';
test('copies a million characters from the complete document without truncation',()=>{
  const words=Array.from({length:100001},(_,i)=>({t:i===100000?'FINAL_TAIL':'transcript',s:i,e:i+1}));
  const text=transcriptText(words);
  assert.ok(text.length>1e6);assert.equal(text.split(' ').length,100001);assert.ok(text.endsWith('FINAL_TAIL'));
  assert.equal(transcriptText(words,{a:100000,b:99999}),'transcript FINAL_TAIL');
});
test('copy preserves Unicode and punctuation with no display dependency',()=>{
  assert.equal(transcriptText([{t:'你'},{t:'好'},{t:'，'},{t:'world'},{t:'!'}]),'你好， world!');
  assert.equal(transcriptText([]),'');
});
