import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server/app.js';

test('concurrent presence readers and comment writers retain every atomic save, including on Windows',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'transcriber-storage-regression-')),errors=[];
  const server=createAppServer({COLLAB_DATA_DIR:directory},{collaboration:{onError:error=>errors.push(error)}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    if(!path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(directory).startsWith('transcriber-storage-regression-'))throw Error('Invalid cleanup target');
    await rm(directory,{recursive:true,force:true});
  });
  const base=`http://127.0.0.1:${server.address().port}/api/collaboration/projects`;
  const project=await(await fetch(base,{method:'POST',body:JSON.stringify({document:{media:{},rows:[],mtl:{tracks:[],clips:[],markers:[]},rules:{},reviews:[],settings:{projectName:'Concurrent comments'}}})})).json();
  const identity={clientId:'1'.repeat(32),participantId:'2'.repeat(32),name:'Editor'},url=base+'/'+project.id;
  const headers={Authorization:'Bearer '+project.editorKey,'Content-Type':'application/json'};
  await fetch(url+'/presence',{method:'POST',headers,body:JSON.stringify(identity)});
  const results=await Promise.all([
    ...Array.from({length:70},(_,n)=>fetch(url+'/discussion',{method:'POST',headers,body:JSON.stringify({...identity,operation:{id:(n+10).toString(16).padStart(32,'0'),action:'create',anchor:{workspace:'timeline',kind:'range',assetKey:'missing',id:'range',timeStart:n,timeEnd:n+1},text:'Comment '+n,mentions:[]}})}).then(async response=>({status:response.status,body:await response.json()}))),
    ...Array.from({length:3},async()=>{for(let n=0;n<90;n++){const response=await fetch(url+'/presence',{method:'POST',headers,body:JSON.stringify(identity)});assert.equal(response.status,200);}return{status:200};})
  ]);
  assert.deepEqual(errors,[]);assert.ok(results.every(result=>result.status===200));
  const discussion=await(await fetch(url+'/discussion',{headers})).json();
  assert.equal(discussion.threads.length,70);assert.equal(new Set(discussion.threads.map(t=>t.messages[0].text)).size,70);
  assert.equal((await(await fetch(url,{headers})).json()).revision,1,'Comment writes must not change the editing revision.');
});
