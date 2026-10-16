export const auditChecks={timing:'Valid time range and duration',overlap:'Overlapping cues',lineLength:'Characters per line',lineCount:'Lines per cue',readingSpeed:'Reading speed',whitespace:'Whitespace and blank lines',empty:'Empty subtitle text'};
export const defaultAudit=()=>Object.fromEntries(Object.keys(auditChecks).map(k=>[k,true]));
export function formatAudit(cues,options,rules) {
  if(!options.format)return [];
  const enabled={...defaultAudit(),...options.audit},out=[];
  const maxChars=rules?.maxChars||42,maxDuration=rules?.maxDur||5.5,cps=rules?.targetCps||17,maxLines=options.maxLines||2,minDuration=options.minDuration??.6;
  let previous=null;
  for(const cue of cues){
    const text=cue.text.replace(/<[^>]*>|\{\\[^}]*\}/g,''),lines=text.split('\n'),duration=cue.end-cue.start;
    const flag=(check,reason)=>{if(enabled[check])out.push({...cue,check,reason});};
    if(!Number.isFinite(cue.start)||!Number.isFinite(cue.end)||cue.start<0||duration<=0)flag('timing','Invalid or non-positive cue time range.');
    else {
      if(duration<minDuration||duration>maxDuration)flag('timing',`Duration ${duration.toFixed(2)}s is outside ${minDuration}–${maxDuration}s.`);
      const speed=Array.from(text.replace(/\s/g,'')).length/duration;
      if(speed>cps)flag('readingSpeed',`Reading speed ${speed.toFixed(1)} characters/s exceeds ${cps}.`);
    }
    if(previous&&cue.start<previous.end-.001)flag('overlap',`Cue overlaps cue ${previous.index+1}.`);
    if(Number.isFinite(cue.end)&&(!previous||cue.end>previous.end))previous=cue;
    const longest=Math.max(...lines.map(l=>Array.from(l).length));
    if(longest>maxChars)flag('lineLength',`Longest line has ${longest} characters; limit ${maxChars}.`);
    if(lines.length>maxLines)flag('lineCount',`${lines.length} lines; limit ${maxLines}.`);
    if(/(^[ \t]|[ \t]$|[ \t]{2,}|\n[ \t]*\n)/m.test(text))flag('whitespace','Leading/trailing spaces, repeated spaces or a blank line.');
    if(!text.trim())flag('empty','Cue has no visible text.');
  }
  return out;
}
