import { chromium, expect as baseExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import { createAppServer } from '../server/app.js';

const directory = await mkdtemp(path.join(tmpdir(), 'transcriber-collaboration-browser-'));
const server = createAppServer({ APP_PASSWORD: 'browser-collaboration-password', COLLAB_DATA_DIR: path.join(directory, 'data') });
let browser;
const errors = [];
const requests = [], pages = [];
const expect = baseExpect.configure({ timeout: 18000 });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const movie = path.join(directory, 'source.mp4');
  const generated = spawnSync(ffmpeg, ['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:d=3','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',movie], { windowsHide: true });
  if (generated.status !== 0) throw Error(generated.stderr.toString());
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL === 'chromium' ? {} : { channel: process.env.BROWSER_CHANNEL || 'msedge' }) });
  async function pageAt(url) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    pages.push(page);
    page.on('requestfailed', request => {if(request.url().includes('/api/collaboration/')){requests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText});if(requests.length>20)requests.shift();}});
    await page.goto(url); await page.getByLabel('Workspace password').fill('browser-collaboration-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.docname')).toBeVisible(); return page;
  }
  const a = await pageAt(base);
  await expect(a.getByText('All changes saved', { exact: true })).toBeVisible();
  const words = [{t:'First',s:0,e:.5,sp:'S1'}, {t:'line.',s:.5,e:1,sp:'S1'}, {t:'Second',s:1,e:1.5,sp:'S1'}, {t:'line.',s:1.5,e:2,sp:'S1'}];
  await a.evaluate(async words => {
    const db = await new Promise(resolve => { const rq = indexedDB.open('transcriber',1); rq.onsuccess = () => resolve(rq.result); });
    const doc = { media: { source: { name:'Interview',type:'local',words,cues:[{id:'one',ws:0,we:1},{id:'two',ws:2,we:3}],cuesB:[],clips:[] } },
      rows:[{id:'row',label:'Opening',cards:[]}],mtl:{tracks:[],clips:[],markers:[]},rules:{targetCps:17},reviews:[],activeAsset:'source',ui:{projectName:'Local original',ws:'subtitle'},v:1 };
    await new Promise(resolve => { const tx = db.transaction('projects','readwrite'); tx.objectStore('projects').put(doc,'current'); tx.oncomplete = resolve; }); db.close();
  }, words);
  await a.reload(); await expect(a.locator('.docname')).toHaveValue('Local original');
  const open = page => page.getByRole('button',{name:'Collaboration and sharing'}).click();
  const close = page => page.getByRole('button',{name:'Close collaboration',exact:true}).click();
  const synced = page => expect(page.locator('.collab-status')).toHaveText('All changes shared');
  const blur = page => page.locator('.logo').click();
  await open(a); await a.getByLabel('Your display name').fill('Alice');
  await a.getByRole('button',{name:'Create shared project',exact:true}).click();
  await expect(a).toHaveURL(/#project=/); await synced(a); const editorLink = a.url();
  const b = await pageAt(editorLink); await expect(b.locator('.docname')).toHaveValue('Local original'); await synced(b);
  await open(b); await b.getByLabel('Your display name').fill('Bob'); await close(b);
  await open(a); await expect(a.locator('.collab-people')).toContainText('Bob');
  await a.getByRole('button',{name:'Create / replace viewer link',exact:true}).click();
  const viewerLink = await a.getByLabel('Viewer link',{exact:true}).inputValue(); await close(a);
  const v = await pageAt(viewerLink); await expect(v.locator('.collab-status')).toHaveText('Live · view only');
  await expect(v.locator('.docname')).not.toBeEditable();
  // Real edits cross two independent browser storage/session contexts.
  await a.keyboard.press('F2'); await b.keyboard.press('F2'); await v.keyboard.press('F2');
  const cue = (page, index) => page.locator('.ctext').nth(index);
  await cue(a,0).fill('Alice first subtitle'); await blur(a); await synced(a);
  await expect(cue(b,0)).toHaveText('Alice first subtitle'); await expect(cue(v,0)).toHaveText('Alice first subtitle');
  await cue(v,0).click(); await v.keyboard.press('Control+a'); await v.keyboard.type('Forbidden viewer edit'); await blur(v);
  await expect(cue(v,0)).toHaveText('Alice first subtitle');
  // A temporary disconnect cannot overwrite another editor's different cue.
  await a.route('**/api/collaboration/**', route => route.abort());
  await cue(a,0).fill('Alice offline subtitle'); await blur(a);
  await expect(a.locator('.collab-status')).toContainText('Offline');
  await cue(b,1).fill('Bob second subtitle'); await blur(b); await synced(b);
  await a.unroute('**/api/collaboration/**'); await synced(a);
  await expect(cue(a,1)).toHaveText('Bob second subtitle'); await expect(cue(b,0)).toHaveText('Alice offline subtitle');
  // Same-field edits pause for a visible choice, retaining both versions.
  await a.route('**/api/collaboration/**', route => route.abort());
  await a.locator('.docname').fill('Alice offline title'); await blur(a);
  await expect(a.locator('.collab-status')).toContainText('Offline');
  await b.locator('.docname').fill('Bob online title'); await blur(b); await synced(b);
  await a.unroute('**/api/collaboration/**');
  await expect(a.getByRole('button',{name:'Review sync issue'})).toBeVisible(); await open(a);
  await expect(a.getByText('Two people changed the same content')).toBeVisible();
  await a.getByRole('button',{name:'Use shared versions',exact:true}).click(); await close(a);
  await expect(a.locator('.docname')).toHaveValue('Bob online title'); await synced(a);
  // Pending offline work survives a full reload via a saved merge baseline.
  await a.route('**/api/collaboration/**', route => route.abort());
  await cue(a,0).fill('Recovered after reload'); await blur(a);
  await expect(a.locator('.collab-status')).toContainText('Offline');
  await expect(a.getByText('Saved on this device',{exact:true})).toBeVisible();
  const sameDeviceViewer = await a.context().newPage();
  sameDeviceViewer.on('pageerror', error => errors.push(error.message));
  await sameDeviceViewer.goto(viewerLink); await expect(sameDeviceViewer.locator('.collab-status')).toHaveText('Live · view only');
  await sameDeviceViewer.keyboard.press('F2');
  await expect(cue(sameDeviceViewer,0)).toHaveText('Alice offline subtitle');
  await sameDeviceViewer.close();
  await a.reload(); await expect(cue(a,0)).toHaveText('Recovered after reload');
  await a.unroute('**/api/collaboration/**'); await synced(a);
  await expect(cue(b,0)).toHaveText('Recovered after reload');
  // Uploaded footage plays from the durable store in a viewer's browser.
  await open(a); await a.getByLabel('Upload shared media for Interview').setInputFiles(movie);
  await expect(a.getByText('Available to teammates',{exact:true})).toBeVisible(); await close(a); await synced(a);
  await expect.poll(() => v.locator('.viewer video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2);
  await expect(v.locator('.viewer video')).toHaveJSProperty('videoWidth',160);
  // Personal workspace navigation never moves another participant's view.
  await b.keyboard.press('F4'); await expect(a.locator('.ctext').first()).toBeVisible();
  await open(a); await a.getByRole('button',{name:'Return to my local project',exact:true}).click();
  await expect(a.locator('.docname')).toHaveValue('Local original');
  await expect(a).toHaveURL(base + '/');
  await mkdir('.test-temp', { recursive: true });
  await open(b); await b.screenshot({ path: '.test-temp/collaboration.png', fullPage: false });
  expect(errors).toEqual([]);
  console.log('Collaboration passed: password-link handoff, separate editor/viewer sessions, live presence, subtitles, nonconflicting merge, conflict resolution, offline reload recovery, shared video playback, personal navigation and local-project preservation.');
} catch(error) {
  console.error('Collaboration browser errors:',errors,'Recent request failures:',requests);
  await mkdir('.test-temp',{recursive:true});
  for(let i=0;i<pages.length;i++)await pages[i].screenshot({path:`.test-temp/sync-failure-${i}.png`,fullPage:false}).catch(()=>{});
  throw error;
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  if (!path.basename(directory).startsWith('transcriber-collaboration-browser-')) throw Error('Invalid cleanup');
  await rm(directory, { recursive: true, force: true });
}
