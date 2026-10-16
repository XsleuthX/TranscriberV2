import { scan, applyIssues, parseComments } from './vet-core.js';
import { timedText, replaceTimedWords } from './text-replace.js';
import {formatAudit,defaultAudit,auditChecks} from './vet-audit.js';
export { parseComments };
export const emptyVet = () => ({ options:{uk:true,chinese:'off',contextual:false,format:false,audit:defaultAudit(),minDuration:.6,maxLines:2},rules:[],dismissed:[],log:[],notes:[] });
export const vetState = doc => ({...emptyVet(),...(doc.vet||{}),options:{...emptyVet().options,...doc.vet?.options}});
export const vetPolicy = doc => {const v=vetState(doc);return JSON.stringify({options:v.options,checklist:{spelling:v.options.uk?'US to UK; -ise house style (not Oxford -ize); preserve case and names. Local dictionary covers 153 mappings. Protect URLs, emails, numeric expressions, honorifics, contractions, hyphenated words and subtitle markup. AI may flag uncertain spelling contextually; never infer audio evidence.':'Off unless explicitly requested',contextualWords:v.options.contextual,chinesePunctuation:v.options.chinese,format:v.options.format?{checks:{...defaultAudit(),...v.options.audit},maxChars:doc.rules?.maxChars||42,maxDuration:doc.rules?.maxDur||5.5,charactersPerSecond:doc.rules?.targetCps||17,minDuration:v.options.minDuration,maxLines:v.options.maxLines}:'Off',teamRules:true,aiMeaningGrammarTranslation:true},rules:v.rules.filter(r=>r.enabled),notes:v.notes,guidelines:v.guidelines||''});};
export async function subtitleFileText(file) {
  const bytes=new Uint8Array(await file.arrayBuffer());
  const encoding=bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8';
  return new TextDecoder(encoding,{fatal:true}).decode(bytes);
}
export function validVet(value) {
  const o=value?.options;
  if(o?.format!==undefined&&typeof o.format!=='boolean')return false;
  if(o?.audit!==undefined&&(!o.audit||typeof o.audit!=='object'||Object.entries(o.audit).some(([k,v])=>!Object.hasOwn(auditChecks,k)||typeof v!=='boolean')))return false;
  if(o?.minDuration!==undefined&&(!Number.isFinite(o.minDuration)||o.minDuration<0||o.minDuration>10))return false;
  if(o?.maxLines!==undefined&&(!Number.isInteger(o.maxLines)||o.maxLines<1||o.maxLines>10))return false;
  if(value?.guidelines!==undefined&&(typeof value.guidelines!=='string'||value.guidelines.length>32000))return false;
  if(!value || typeof value!=='object' || !value.options || typeof value.options.uk!=='boolean' || typeof value.options.contextual!=='boolean' || !['off','cjk','all'].includes(value.options.chinese)) return false;
  if(!Array.isArray(value.rules)||value.rules.length>1000||!Array.isArray(value.dismissed)||value.dismissed.length>10000||value.dismissed.some(v=>typeof v!=='string') || !Array.isArray(value.log)||value.log.length>500||!Array.isArray(value.notes)||value.notes.some(n=>typeof n!=='string'))return false;
  if(value.rules.some(r=>!r || typeof r.id!=='string' || !r.id || typeof r.from!=='string' || !r.from || typeof r.to!=='string' || typeof r.note!=='string' || ['caseSensitive','wholeWord','preserveCase','enabled'].some(k=>typeof r[k]!=='boolean')))return false;
  if(new Set(value.rules.map(r=>r.id)).size!==value.rules.length)return false;
  return value.log.every(l=>l && typeof l.id==='string' && typeof l.time==='string' && typeof l.action==='string' && Array.isArray(l.changes) && l.changes.every(c=>c && typeof c.assetKey==='string' && ['A','B'].includes(c.track) && typeof c.cueId==='string' && typeof c.before==='string' && typeof c.after==='string' && Number.isFinite(c.start) && Number.isFinite(c.end)));
}
export function ruleList(value) {
  const rules=Array.isArray(value)?value:value?.rules;
  if(!Array.isArray(rules)||rules.length>1000)throw new Error('Expected up to 1000 correction rules.');
  const result=rules.map((r,i)=>({id:'import_'+i+'_'+crypto.randomUUID(),from:r?.from,to:r?.to,note:r?.note||'',caseSensitive:r?.caseSensitive!==false,wholeWord:!!r?.wholeWord,preserveCase:!!r?.preserveCase,enabled:r?.enabled!==false}));
  if(!validVet({...emptyVet(),rules:result}))throw new Error('Each rule needs nonempty find text and a text replacement.');
  return result;
}
export function scanVet(doc,assetKey,track,cueText,cueTime) {
  const asset=doc.media[assetKey]; if(!asset)return [];
  const state=vetState(doc), list=track==='B'?asset.cuesB||[]:asset.cues||[];
  const input={cues:list.map(c=>({id:c.id,current:cueText(c,asset.words||[])}))};
  const cueMap=new Map(list.map((c,i)=>[c.id,{c,i}]));
  const dismissed=new Set(state.dismissed);
  const textFlags=scan(input,state.rules,state.options).map(issue=>{
    const {c,i}=cueMap.get(issue.cue), timing=cueTime(c,asset.words||[]),before=cueText(c,asset.words||[]);
    const key=JSON.stringify([assetKey,track,c.id,before,issue.kind,issue.start,issue.from,issue.to]);
    return {...issue,key,assetKey,track,cueId:c.id,cueIndex:i,before,signature:before,startTime:timing.start,endTime:timing.end,
      origin:'vet',kindOfCheck:issue.kind,kind:'cue',id:c.id,reviewId:key,presetLabel:issue.label,
      reason:issue.contextual?'Context-dependent spelling. Check the intended meaning.':issue.kind==='chinese'?'Remove this punctuation only if required by your subtitle style.':issue.label,
      suggestion:before.slice(0,issue.start)+issue.to+before.slice(issue.end), ws:c.ws,we:c.we, start:timing.start,end:timing.end,
      offset:issue.start,limit:issue.end};
  });
  const formatFlags=formatAudit(list.map((c,index)=>({id:c.id,index,text:cueText(c,asset.words||[]),...cueTime(c,asset.words||[])})),state.options,doc.rules).map(f=>{
    const c=list[f.index],key=JSON.stringify([assetKey,track,f.id,f.text,'format',f.check,f.reason]);
    return {key,reviewId:key,origin:'vet',kind:'cue',kindOfCheck:'format',presetLabel:'Format · '+auditChecks[f.check],assetKey,track,cueId:f.id,id:f.id,cueIndex:f.index,before:f.text,startTime:f.start,endTime:f.end,start:f.start,end:f.end,ws:c.ws,we:c.we,reason:f.reason,contextual:true};
  });
  return [...textFlags,...formatFlags].filter(f=>!dismissed.has(f.key));
}
export function dismissVet(doc,issues) {
  const state=vetState(doc);
  return {...state,dismissed:[...new Set([...state.dismissed,...issues.map(i=>i.key)])].slice(-10000),
    log:[...state.log,{id:crypto.randomUUID(),time:new Date().toISOString(),action:'Dismissed '+issues.length+' suggestions',changes:[]}].slice(-500)};
}
export function applyVet(doc,issues,cueText,cueTime) {
  const media={...doc.media}, state=vetState(doc), changes=[], conflicts=[];
  const scopes=new Map(),groups=new Map();
  for(const issue of issues) {
    const scope=JSON.stringify([issue.assetKey,issue.track]);
    if(!scopes.has(scope))scopes.set(scope,new Map(scanVet(doc,issue.assetKey,issue.track,cueText,cueTime).map(f=>[f.key,f])));
    const live=scopes.get(scope).get(issue.key);
    if(!live){conflicts.push(issue);continue;}
    const key=JSON.stringify([live.assetKey,live.track,live.cueId]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(live);
  }
  for(const flags of [...groups.values()].sort((a,b)=>b[0].startTime-a[0].startTime)) {
    const f=flags[0], asset=media[f.assetKey], field=f.track==='B'?'cuesB':'cues';
    const c=asset[field].find(c=>c.id===f.cueId), before=cueText(c,asset.words||[]);
    const scratch={cues:[{id:c.id,current:before}]};
    const result=applyIssues(scratch,flags.map(i=>({...i,cue:i.cueId,start:i.offset,end:i.limit,kind:i.kindOfCheck})));
    conflicts.push(...result.conflicts); if(!result.changes.length)continue;
    const after=scratch.cues[0].current, range=cueTime(c,asset.words||[]);
    let next;
    try { next=replaceVetCue(asset,c.id,f.track,after,cueText,cueTime); }
    catch {conflicts.push(...flags);continue;}
    media[f.assetKey]=next;
    changes.push({assetKey:f.assetKey,track:f.track,cueId:c.id,before,after,start:range.start,end:range.end,
      checks:flags.map(f=>({kind:f.kindOfCheck,ruleId:f.ruleId||null,note:f.label}))});
  }
  const vet=changes.length?{...state,log:[...state.log,{id:crypto.randomUUID(),time:new Date().toISOString(),action:'Applied vet suggestions',changes}].slice(-500)}:state;
  return {media,vet,changes,conflicts};
}

export function replaceVetCue(asset,id,track,after,cueText,cueTime) {
  if(!after.trim())throw new Error('A suggestion cannot empty a cue. Edit or delete it manually.');
  const field=track==='B'?'cuesB':'cues',c=asset[field]?.find(q=>q.id===id);
  if(!c)throw new Error('Cue no longer exists.');
  const range=cueTime(c,asset.words||[]);
    let next={...asset,[field]:asset[field].map(q=>q.id===c.id?{...q,textOverride:after,startOverride:range.start,endOverride:range.end}:q)};
    if(track==='A') {
      const old=asset.words||[], indices=old.map((w,i)=>({w,i})).filter(({w})=>(w.s+w.e)/2>=range.start && (w.s+w.e)/2<range.end);
      // Shared/cross-boundary words cannot be replaced safely as a single cue.
      if(indices.some(({w})=>w.s<range.start-.04 || w.e>range.end+.04)) throw new Error('Cue shares words across its boundaries. Edit this cue manually.');
      const first=indices[0]?.i??old.findIndex(w=>w.s>=range.start), at=first<0?old.length:first;
      let replacement;
      if(indices.length) {
        const mine=indices.map(x=>x.w);
        replacement=replaceTimedWords(mine,timedText(mine).text,after,true).words;
      } else {
        const tokens=after.match(/[\p{Script=Han}]|[^\s\p{Script=Han}]+/gu)||[after];
        replacement=tokens.map((t,i)=>({t,s:range.start+(range.end-range.start)*i/tokens.length,e:range.start+(range.end-range.start)*(i+1)/tokens.length,sp:'S1'}));
      }
      const w=[...old.slice(0,at),...replacement.map(w=>({...w,edited:true,timingEstimated:true})),...old.slice(at+indices.length)].map((w,i)=>({...w,i}));
      const pin=list=>list.map(q=>{
        const time=cueTime(q,old), txt=q.id===c.id && list===asset.cues?after:cueText(q,old);
        if(q.ws==null)return {...q,textOverride:txt,startOverride:time.start,endOverride:time.end};
        let ws=w.findIndex(x=>x.e>time.start);if(ws<0)ws=Math.max(0,w.length-1);
        let we=w.findLastIndex(x=>x.s<time.end);we=Math.max(ws,we);
        return {...q,ws,we,textOverride:txt,startOverride:time.start,endOverride:time.end};
      });
      next={...next,words:w,timingEstimated:true,cues:pin(asset.cues||[]),cuesB:pin(asset.cuesB||[])};
    }

  return next;
}
