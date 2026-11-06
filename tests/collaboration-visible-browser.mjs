import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer } from '../server/app.js';
const expect=baseExpect.configure({timeout:20000});
const directory=await mkdtemp(path.join(tmpdir(),'transcriber-visible-team-'));
const server=createAppServer({APP_PASSWORD:'visible-collaboration-password',COLLAB_DATA_DIR:directory},{collaboration:{onError:error=>console.error('Collaboration server error:',error)}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;const errors=[];let pages=[];let debugProject;const commentResponses=[],presenceSamples=[];
try{
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL==='chromium'?{}:{channel:process.env.BROWSER_CHANNEL||'msedge'})});
  const words=['Hello','team,','review','this','opening.','Another','short','sentence.'].map((t,i)=>({t,i,s:i*.6,e:(i+1)*.6,sp:'S1'}));
  const cues=[{id:'cue-1',ws:0,we:4},{id:'cue-2',ws:5,we:7},...Array.from({length:48},(_,i)=>({id:'cue-'+(i+3),ws:0,we:4,startOverride:(i+2)*3,endOverride:(i+3)*3}))];
  const asset=name=>({name,type:'local',duration:160,mediaKind:'video',words:structuredClone(words),cues:structuredClone(cues),cuesB:cues.map(c=>({...c,textOverride:c.id==='cue-1'?'你好，团队。😀':'第二行。'})),clips:[{id:'clip-1',in:0,out:3,label:'Opening clip',color:'#397385'},{id:'clip-2',in:4,out:7,label:'Second clip',color:'#607d42'}]});
  const document={media:{one:asset('Interview one'),two:asset('Interview two')},rows:[{id:'row-1',label:'Opening',cards:[
    {id:'card-1',kind:'generic',col:'video',assetKey:'one',label:'Interview',title:'Opening',body:'A story draft for review.',bodyManual:true,cueRefs:[],sourceCueRefs:[],sin:0,sout:3},
    {id:'card-linked',kind:'cue',col:'video',assetKey:'one',label:'Interview',title:'',body:'',cueRefs:['cue-1','cue-2'],sourceCueRefs:['cue-1','cue-2'],sin:0,sout:4.8}]}],
    mtl:{tracks:[{id:'V1',name:'Video 1',kind:'video',height:56},{id:'A1',name:'Audio 1',kind:'audio',height:44}],clips:[
      {id:'sequence-1',trackId:'V1',kind:'video',assetKey:'one',pin:0,pout:3,sin:0,sout:3,title:'Opening',color:'#397385',groupId:'g1'},
      {id:'sequence-audio',trackId:'A1',kind:'audio',assetKey:'one',pin:0,pout:3,sin:0,sout:3,title:'Opening audio',color:'#457453',groupId:'g1'},
      {id:'sequence-2',trackId:'V1',kind:'video',assetKey:'two',pin:4,pout:7,sin:0,sout:3,title:'Second source',color:'#74598d',groupId:'g2'}],markers:[]},
    rules:{maxChars:42,maxDur:5.5,gapBreak:.7,targetCps:17},reviews:[],settings:{projectName:'Visible team review',dictionary:{asr:[],tr:[]},priming:true}};
  async function pageAt(url,name){
    const context=await browser.newContext({viewport:{width:1600,height:1000},acceptDownloads:true});
    await context.addInitScript(value=>{if(!localStorage.getItem('transcriber.displayName'))localStorage.setItem('transcriber.displayName',value);},name);
    const page=await context.newPage();pages.push(page);page.on('pageerror',error=>errors.push(error.message));
    page.on('response',async response=>{if(response.url().includes('/discussion')){try{const data=await response.json();commentResponses.push({name,status:response.status(),error:data.error,revision:data.revision,unchanged:data.unchanged,counts:data.threads?.map(t=>t.messages.length)});}catch{}}});
    page.on('response',async response=>{if(response.url().endsWith('/presence')){try{const data=await response.json();presenceSamples.push({name,people:data.people?.map(p=>({name:p.name,activity:p.activity}))});if(presenceSamples.length>12)presenceSamples.shift();}catch{}}});
    await page.goto(url);await page.getByLabel('Workspace password').fill('visible-collaboration-password');await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await expect(page.locator('.docname')).toBeVisible();return page;
  }
  const a=await pageAt(base,'Alice');
  const created=await a.request.post(base+'/api/collaboration/projects',{data:{document}});expect(created.status()).toBe(201);const project=await created.json();debugProject=project.id;
  const editorURL=base+`/#project=${project.id}&key=${project.editorKey}`,viewerURL=base+`/#project=${project.id}&key=${project.viewerKey}`;
  await a.goto(editorURL);const b=await pageAt(editorURL,'Bob'),v=await pageAt(viewerURL,'Visitor');
  await expect(b.getByRole('button',{name:'Locate Alice',exact:true})).toBeVisible();
  const mode=async(page,key)=>{await page.bringToFront();await page.locator('.foot').count().catch(()=>0);await page.keyboard.press('Escape');await page.keyboard.press('F'+key);};
  const select=async(page,selector,start,end)=>{
    await page.bringToFront();await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.locator(selector).first().evaluate((field,[start,end])=>{
      field.focus();const walker=document.createTreeWalker(field,NodeFilter.SHOW_TEXT),nodes=[];let node,length=0;
      while((node=walker.nextNode())){nodes.push({node,start:length,end:length+node.length});length+=node.length;}
      const a=nodes.find(n=>n.end>=start),b=nodes.find(n=>n.end>=end),range=document.createRange();range.setStart(a.node,start-a.start);range.setEnd(b.node,end-b.start);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));
    },[start,end]);
  };
  const remote=(page,type,name='Alice')=>page.locator('.team-remote-'+type+'[data-person="'+name+'"]');
  console.log('Checking Transcript selections.');
  await mode(b,1);await mode(a,1);await select(a,'.line [data-collab-field="text"]',2,9);
  await expect(remote(b,'highlight')).not.toHaveCount(0);await expect(remote(b,'caret')).toHaveCount(1);
  const transcriptColour=await remote(b,'caret').evaluate(el=>getComputedStyle(el).backgroundColor);
  console.log('Checking Subtitle carets, track/source scope, draft previews and comments.');
  await mode(b,2);await mode(v,2);await mode(a,2);await select(a,'.ctext',2,8);
  await expect(remote(b,'caret')).toHaveCount(1);await expect(remote(v,'caret')).toHaveCount(1);
  expect(await remote(b,'caret').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(transcriptColour);
  await b.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('B');
  await select(a,'.ctext',2,8);await expect(remote(b,'caret')).toHaveCount(0);
  await a.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('B');await select(a,'.ctext',3,8);await expect(remote(b,'caret')).toHaveCount(1);
  await a.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('A');
  await b.locator('.barsel[title="Which subtitle track this view reads and writes"]').selectOption('A');
  await b.locator('.asset').filter({has:b.locator('b',{hasText:'Interview two'})}).click();await select(a,'.ctext',2,8);await expect(remote(b,'caret')).toHaveCount(0);
  await b.locator('.asset').filter({has:b.locator('b',{hasText:'Interview one'})}).click();await select(a,'.ctext',2,8);await expect(remote(b,'caret')).toHaveCount(1);
  await b.locator('.paper').evaluate(el=>{el.scrollTop=3000;});await expect(remote(b,'caret')).toHaveCount(0);
  await b.getByRole('button',{name:'Locate Alice',exact:true}).click();await select(a,'.ctext',2,8);await expect(remote(b,'caret')).toHaveCount(1);
  await b.getByRole('button',{name:'View',exact:true}).click();await b.getByRole('button',{name:'125%',exact:true}).click();await b.locator('.tx > div[style*="z-index: 89"]').click({position:{x:10,y:10}});
  await select(a,'.ctext',2,8);await expect(remote(b,'caret')).toHaveCount(1);
  await expect.poll(async()=>{
    const caretPosition=await b.locator('.cue[data-collab-id="cue-1"] .ctext').evaluate(field=>{const node=field.firstChild,range=document.createRange();range.setStart(node,8);range.setEnd(node,8);return range.getBoundingClientRect().left;});
    const actual=await remote(b,'caret').boundingBox();return actual?Math.abs(actual.x-caretPosition):Infinity;
  }).toBeLessThan(3);
  await b.getByRole('button',{name:'View',exact:true}).click();await b.getByRole('button',{name:'100%',exact:true}).click();await b.locator('.tx > div[style*="z-index: 89"]').click({position:{x:10,y:10}});
  await a.keyboard.type('LIVE');
  await expect(b.locator('.team-remote-label').filter({hasText:'editing draft'})).toBeVisible();await expect(remote(b,'caret')).toHaveCount(0);
  await b.locator('.team-remote-label').filter({hasText:'editing draft'}).click();await expect(b.getByLabel('Participant activity')).toContainText('LIVE');
  await b.getByRole('button',{name:'Close activity preview'}).click();await a.locator('.logo').click();
  await expect(b.locator('.ctext').first()).toContainText('LIVE');
  // Anchor a thread to actual selected text, mention Bob and assign an action.
  await select(a,'.ctext',0,5);await a.getByRole('button',{name:'Add comment',exact:true}).click();
  const comments=a.getByLabel('Project comments');await expect(comments.locator('.team-new-comment blockquote')).toBeVisible();await comments.getByLabel('Comment text').fill('Please check @Bo');
  await comments.getByRole('listbox',{name:'Mention a participant'}).getByRole('button',{name:'Bob',exact:true}).click();
  await comments.getByLabel('Assign comment action').selectOption({label:'Bob'});await comments.getByRole('button',{name:'Post comment',exact:true}).click();
  await expect(comments.locator('.team-thread')).toHaveCount(1);await a.getByRole('button',{name:'Close comments'}).click();
  await b.getByRole('button',{name:/^Comments /}).click();const bc=b.getByLabel('Project comments');
  await bc.getByRole('button',{name:/^For me/}).click();await expect(bc.locator('.team-thread')).toContainText('Action for Bob (you)');
  await bc.getByRole('button',{name:'Open thread',exact:true}).click();await bc.getByLabel('Reply to thread').fill('Checking this now.');await bc.getByRole('button',{name:'Reply',exact:true}).click();
  await expect(bc.locator('.team-thread')).toContainText('Checking this now.');
  await mkdir('.test-temp',{recursive:true});await b.screenshot({path:'.test-temp/team-subtitle-comments.png',fullPage:false});
  await bc.getByRole('button',{name:'Resolve',exact:true}).click();await bc.getByRole('button',{name:'Resolved',exact:true}).click();
  await expect(bc.locator('.team-thread')).toContainText('Resolved');await bc.getByRole('button',{name:'Reopen',exact:true}).click();
  await b.getByRole('button',{name:'Close comments'}).click();
  await v.getByRole('button',{name:/^Comments /}).click();const vc=v.getByLabel('Project comments');await vc.getByRole('button',{name:'1 replies',exact:true}).click();await expect(vc.locator('.team-thread')).toContainText('Checking this now.');await expect(vc.getByRole('button',{name:'Resolve',exact:true})).toBeDisabled();await v.getByRole('button',{name:'Close comments'}).click();
  await a.bringToFront();await a.getByRole('button',{name:/^Undo/}).first().click();await expect(a.locator('.ctext').first()).toContainText('Hello');
  await a.getByRole('button',{name:/^Redo/}).first().click();await expect(a.locator('.ctext').first()).toContainText('LIVE');
  console.log('Checking source Timeline clip/range presence.');
  await mode(b,3);await mode(a,3);await a.locator('.tlclip[data-collab-id="clip-1"]').click({position:{x:20,y:25}});await expect(remote(b,'outline')).not.toHaveCount(0);await expect(remote(b,'playhead')).toHaveCount(1);
  const lane=await a.locator('.tllane').boundingBox();await a.mouse.move(lane.x+5,lane.y+72);await a.mouse.down();await a.mouse.move(lane.x+120,lane.y+72,{steps:8});await a.mouse.up();await expect(remote(b,'time-range')).toHaveCount(1);
  await b.screenshot({path:'.test-temp/team-timeline.png',fullPage:false});
  console.log('Checking Story text carets and comment navigation.');
  await mode(b,4);await mode(a,4);await select(a,'[data-card-id="card-1"] .dbody',2,9);await expect(remote(b,'caret')).toHaveCount(1);
  await b.screenshot({path:'.test-temp/team-story.png',fullPage:false});
  await a.locator('[data-card-id="card-1"] .dtitle').evaluate(field=>{field.focus();field.setSelectionRange(1,4);document.dispatchEvent(new Event('selectionchange'));});await expect(remote(b,'caret')).toHaveCount(1);
  await select(a,'[data-card-id="card-1"] .dbody',2,9);
  await a.getByRole('button',{name:'Add comment',exact:true}).click();await a.getByLabel('Comment text').fill('Review this Story wording.');await a.getByRole('button',{name:'Post comment',exact:true}).click();await a.getByRole('button',{name:'Close comments'}).click();
  console.log('Checking Multi-Timeline clip selection and playheads.');
  await mode(b,5);await mode(a,5);await a.locator('[data-multi-id="sequence-1"]').click({position:{x:20,y:15}});await expect(remote(b,'outline')).not.toHaveCount(0);await expect(remote(b,'playhead')).toHaveCount(1);
  await a.keyboard.press('i');await a.locator('[data-multi-id="sequence-2"]').click({position:{x:25,y:16}});await a.keyboard.press('o');
  await a.getByRole('button',{name:'Add comment',exact:true}).click();await a.getByLabel('Comment text').fill('Check the sequence cut.');await a.getByRole('button',{name:'Post comment',exact:true}).click();
  await a.getByRole('button',{name:'Close comments'}).focus();await a.keyboard.press('Delete');await expect(a.locator('[data-multi-id]')).toHaveCount(3);
  await a.getByRole('button',{name:'Close comments'}).click();
  // A deleted target keeps its thread and original quotation.
  const snapshot=await (await a.request.get(base+`/api/collaboration/projects/${project.id}`,{headers:{Authorization:'Bearer '+project.editorKey}})).json();
  snapshot.document.media.one.cues=snapshot.document.media.one.cues.filter(c=>c.id!=='cue-1');
  const saved=await a.request.put(base+`/api/collaboration/projects/${project.id}`,{headers:{Authorization:'Bearer '+project.editorKey},data:{revision:snapshot.revision,document:snapshot.document}});expect(saved.status()).toBe(200);
  await a.getByRole('button',{name:/^Comments /}).click();await a.getByLabel('Project comments').getByRole('button',{name:'All',exact:true}).click();await expect(a.getByLabel('Project comments')).toContainText('Caption removed');
  const threadData=await (await a.request.get(base+`/api/collaboration/projects/${project.id}/discussion`,{headers:{Authorization:'Bearer '+project.viewerKey}})).json();
  expect(threadData.threads.length).toBe(3);expect(threadData.threads[0].messages.length).toBe(2);
  const alice=threadData.members.find(m=>m.name==='Alice'),bob=threadData.members.find(m=>m.name==='Bob');expect(alice.colour).not.toBe(bob.colour);
  await a.reload();await a.getByRole('button',{name:/^Comments /}).click();await a.getByLabel('Project comments').getByRole('button',{name:'All',exact:true}).click();await expect(a.getByLabel('Project comments').locator('.team-thread')).toHaveCount(3);
  await mkdir('.test-temp',{recursive:true});await a.screenshot({path:'.test-temp/collaboration-visible.png',fullPage:false});
  expect(errors).toEqual([]);console.log('Visible collaboration passed across all five modes: scoped coloured selections/carets, draft previews, timeline ranges/playheads, anchored comments, mentions, assignments, replies, resolve/reopen, viewer access, deleted anchors and reload.');
}catch(error){await mkdir('.test-temp',{recursive:true});for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`.test-temp/visible-failure-${i}.png`,fullPage:false}).catch(()=>{});console.error('Browser errors:',errors);console.error('Presence samples:',JSON.stringify(presenceSamples));console.error('Comment responses:',commentResponses.slice(-25));if(debugProject){const stored=JSON.parse(await readFile(path.join(directory,debugProject+'.json'),'utf8'));console.error('Stored comments:',{revision:stored.discussion?.revision,threads:stored.discussion?.threads.map(t=>({resolved:t.resolved,messages:t.messages.map(m=>m.text)}))});}throw error;
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(!path.basename(directory).startsWith('transcriber-visible-team-'))throw Error('Invalid cleanup');await rm(directory,{recursive:true,force:true});}
