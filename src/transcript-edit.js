import { spans } from './vet-core.js';
// Transcript prose and Sub A share one editing transaction. Cue IDs/times and
// Sub B translations survive changes to the number of transcript words.
const tokenPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu;
const tokens = text => [...String(text).matchAll(tokenPattern)].map(m=>({t:m[0],at:m.index,end:m.index+m[0].length}));
const norm = text => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'') || text;
function anchors(a,b) {
  // A paragraph is bounded by the reading view, but a large paste need not be.
  if(a.length*b.length>2000000) {
    const out=[];let i=0,j=0;
    while(i<a.length&&i<b.length&&norm(a[i].t)===norm(b[i].t)){out.push([i,i]);i++;}
    while(a.length-1-j>=i&&b.length-1-j>=i&&norm(a.at(-1-j).t)===norm(b.at(-1-j).t)){j++;}
    for(let k=j;k>0;k--)out.push([a.length-k,b.length-k]);
    return out;
  }
  const table=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));
  for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)
    table[i][j]=norm(a[i].t)===norm(b[j].t)?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
  const out=[];let i=0,j=0;
  while(i<a.length&&j<b.length){if(norm(a[i].t)===norm(b[j].t)){out.push([i++,j++]);}else if(table[i+1][j]>=table[i][j+1])i++;else j++;}
  return out;
}
function edits(a,b) {
  const out=[];let i=0,j=0;
  for(const [x,y] of [...anchors(a,b),[a.length,b.length]]) {
    if(x>i)for(let k=0;k<x-i;k++)out.push({from:i+k,to:i+k+1,words:b.slice(j+Math.ceil(k*(y-j)/(x-i)),j+Math.ceil((k+1)*(y-j)/(x-i)))});
    else if(y>j)out.push({from:i,to:x,words:b.slice(j,y)});
    if(x<a.length&&a[x].t!==b[y].t)out.push({from:x,to:x+1,words:[b[y]]});
    i=x+1;j=y+1;
  }
  return out;
}
function flatten(words,start=0) {
  return words.flatMap((w,index)=>{const ts=tokens(w.t);return ts.map((t,i)=>({...w,t:t.t,sourceIndex:start+index,s:w.s+(w.e-w.s)*i/ts.length,e:w.s+(w.e-w.s)*(i+1)/ts.length}));});
}
function join(list) {
  let text='';for(const {t} of list){if(text&&!(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(text)&&/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(t))&&!/^[,，。！？、；：.!?;:]/.test(t))text+=' ';text+=t;}return text;
}
function projectText(before,oldTokens,newTokens) {
  const own=spans(before,false).filter(s=>!s.protected).flatMap(s=>tokens(s.text).map(t=>({...t,at:t.at+s.offset,end:t.end+s.offset}))),changes=edits(oldTokens,newTokens),mapping=new Map(anchors(oldTokens,own));
  let result=before,conflicts=0;
  for(const change of changes.reverse()) {
    const assigned=Array.from({length:change.to-change.from},(_,i)=>mapping.get(change.from+i));
    let left,right;
    if(assigned.length) {
      if(assigned.some((n,i)=>n===undefined||(i>0&&n!==assigned[i-1]+1))){conflicts++;continue;}
      left=own[assigned[0]].at;right=own[assigned.at(-1)].end;
      if(spans(before.slice(left,right),false).some(s=>s.protected)){conflicts++;continue;}
    } else {
      const next=mapping.get(change.from),prev=mapping.get(change.from-1);
      if(next!==undefined){left=right=own[next].at;}
      else if(prev!==undefined){left=right=own[prev].end;}
      else if(!own.length){left=right=0;}
      else {conflicts++;continue;}
    }
    let replacement=join(change.words);
    if(!assigned.length&&replacement) {
      if(left&&/[^\s]$/.test(result.slice(0,left))&&!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(result.slice(0,left)))replacement=' '+replacement;
      if(right<result.length&&/^\S/.test(result.slice(right))&&!/^[,，。！？、；：.!?;:\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(result.slice(right)))replacement+=' ';
    }
    // A deletion consumes one adjoining space, retaining deliberate line breaks.
    if(!replacement&&assigned.length){if(result[right]===' ')right++;else if(result[left-1]===' ')left--;}
    result=result.slice(0,left)+replacement+result.slice(right);
  }
  return {text:result.trim()?result:'',conflicts};
}
export function editTranscript(asset,first,last,text,cueText,cueTime) {
  const old=asset.words||[];
  if(first<0||last<first||last>=old.length)throw new Error('Transcript paragraph changed. Reopen it before editing.');
  const original=flatten(old.slice(first,last+1),first),incoming=tokens(text);
  if(original.map(w=>w.t).join(' ')===incoming.map(w=>w.t).join(' '))return {asset,conflicts:0};
  const rebuilt=[];let i=0,j=0;
  const matches=[...anchors(original,incoming),[original.length,incoming.length]];
  for(const [x,y] of matches) {
    const removed=original.slice(i,x),added=incoming.slice(j,y);
    const start=removed[0]?.s??original[x]?.s??original.at(-1)?.e??0;
    const end=Math.max(start,removed.at(-1)?.e??start);
    added.forEach((t,k)=>{
      const slot=Math.floor(k*removed.length/added.length),owner=removed[slot]||original[x]||original.at(-1);
      const count=removed.length?Math.ceil((slot+1)*added.length/removed.length)-Math.ceil(slot*added.length/removed.length):added.length;
      const rank=removed.length?k-Math.ceil(slot*added.length/removed.length):k;
      const from=removed.length?owner.s:start,to=removed.length?owner.e:end;
      rebuilt.push({...owner,t:t.t,s:from+(to-from)*rank/count,e:from+(to-from)*(rank+1)/count,edited:true,timingEstimated:true});
    });
    if(x<original.length)rebuilt.push({...original[x],t:incoming[y].t,edited:original[x].edited||original[x].t!==incoming[y].t});
    i=x+1;j=y+1;
  }
  const annotated=[...old.slice(0,first).map((w,i)=>({...w,sourceIndex:i})),...rebuilt,...old.slice(last+1).map((w,i)=>({...w,sourceIndex:last+1+i}))];
  const words=annotated.map(({sourceIndex,...w},i)=>({...w,i}));
  let conflicts=0;
  const pin=(list,isA)=>list.map(c=>{
    const range=cueTime(c,old),before=cueText(c,old);
    const owns=(w,index)=>c.ws!=null&&c.we!=null?index>=c.ws&&index<=c.we:(w.s+w.e)/2>=range.start&&(w.s+w.e)/2<range.end;
    const indices=new Set(old.flatMap((w,index)=>owns(w,index)?[index]:[]));
    let after=before;
    if(isA&&[...indices].some(index=>index>=first&&index<=last)) {
      const oldTokens=flatten(old.filter((_,index)=>indices.has(index)));
      const newTokens=flatten(annotated.filter(w=>indices.has(w.sourceIndex)));
      const projected=projectText(before,oldTokens,newTokens);after=projected.text;conflicts+=projected.conflicts;
    }
    const owned=annotated.flatMap((w,index)=>indices.has(w.sourceIndex)?[index]:[]);
    return {...c,ws:owned[0]??null,we:owned.at(-1)??null,textOverride:after,startOverride:range.start,endOverride:range.end};
  });
  return {asset:{...asset,words,cues:pin(asset.cues||[],true),cuesB:pin(asset.cuesB||[],false),timingEstimated:asset.timingEstimated||rebuilt.some(w=>w.timingEstimated)},conflicts};
}
