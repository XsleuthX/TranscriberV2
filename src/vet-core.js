// Local review engine adapted from the user-supplied Subtitle Vet UI.
  const pairs = `color:colour colors:colours colored:coloured coloring:colouring colorful:colourful colorless:colourless
favorite:favourite favorites:favourites favor:favour favors:favours favored:favoured favoring:favouring favorable:favourable unfavorable:unfavourable
honor:honour honors:honours honored:honoured honoring:honouring honorable:honourable dishonor:dishonour
labor:labour labors:labours labored:laboured laboring:labouring laborer:labourer laborers:labourers
neighbor:neighbour neighbors:neighbours neighborhood:neighbourhood neighborhoods:neighbourhoods neighboring:neighbouring
behavior:behaviour behaviors:behaviours behavioral:behavioural humor:humour humorous:humorous rumor:rumour rumors:rumours
odor:odour odors:odours flavor:flavour flavors:flavours flavored:flavoured flavoring:flavouring
center:centre centers:centres centered:centred centering:centring theater:theatre theaters:theatres liter:litre liters:litres meter:metre meters:metres
organize:organise organizes:organises organized:organised organizing:organising organizer:organiser organizers:organisers organization:organisation organizations:organisations organizational:organisational
recognize:recognise recognizes:recognises recognized:recognised recognizing:recognising recognition:recognition
realize:realise realizes:realises realized:realised realizing:realising realization:realisation
analyze:analyse analyzes:analyses analyzed:analysed analyzing:analysing analysis:analysis
apologize:apologise apologizes:apologises apologized:apologised apologizing:apologising
summarize:summarise summarizes:summarises summarized:summarised summarizing:summarising
emphasize:emphasise emphasizes:emphasises emphasized:emphasised emphasizing:emphasising
specialize:specialise specializes:specialises specialized:specialised specializing:specialising
prioritize:prioritise prioritizes:prioritises prioritized:prioritised prioritizing:prioritising
optimize:optimise optimizes:optimises optimized:optimised optimizing:optimising optimization:optimisation
customize:customise customizes:customises customized:customised customizing:customising customization:customisation
standardize:standardise standardizes:standardises standardized:standardised standardizing:standardising
authorize:authorise authorized:authorised authorizes:authorises authorizing:authorising authorization:authorisation
mobilize:mobilise mobilized:mobilised mobilizes:mobilises mobilizing:mobilising
traveling:travelling traveled:travelled traveler:traveller travelers:travellers
canceling:cancelling canceled:cancelled cancelation:cancellation
labeling:labelling labeled:labelled modeling:modelling modeled:modelled modeler:modeller
jewelry:jewellery gray:grey grays:greys airplane:aeroplane airplanes:aeroplanes
pajamas:pyjamas skeptical:sceptical skeptic:sceptic skeptics:sceptics
defense:defence defenses:defences offense:offence offenses:offences
license:licence licenses:licences program:programme programs:programmes
catalog:catalogue catalogs:catalogues dialog:dialogue dialogs:dialogues
check:cheque checks:cheques practice:practice`.split(/\s+/).map(x => x.split(':')).filter(([a,b]) => a !== b);
  const contextual = new Set(['meter','meters','program','programs','license','licenses','check','checks']);
  const dictionary = new Map(pairs);
  const han = /\p{Script=Han}/u;
  const punct = /\p{P}/gu;
  const tags = /(<[^>]*>|\{\\[^}]*\}|&(?:#\d+|#x[0-9a-f]+|[a-z]+);)/gi;
  const protectedText = /(?:https?:\/\/|www\.)[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[^\s<>]*)?|\b(?:Dr|Mr|Mrs|Ms|Prof)\.|[+-]?\d+(?:[.,:\/-]\d+)+%?|[A-Za-z]+(?:['’][A-Za-z]+)+|[A-Za-z]+(?:-[A-Za-z]+)+/giu;
  const time = /^(\d{2,}:\d{2}:\d{2},\d{3})[ \t]+-->[ \t]+(\d{2,}:\d{2}:\d{2},\d{3})(.*)$/;
  function milliseconds(s) { const [h,m,sec,ms] = s.split(/[:,]/).map(Number); return ((h * 60 + m) * 60 + sec) * 1000 + ms; }
  function parseSrt(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('This file is empty. Choose a non-empty SRT file.');
    const bom = input.startsWith('\uFEFF');
    const newline = input.includes('\r\n') ? '\r\n' : '\n';
    const normalized = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const blocks = normalized.replace(/^(?:[ \t]*\n)+/, '').replace(/\n[ \t]*$/, '').split(/\n[ \t]*\n+/).filter(block=>block.trim());
    const warnings = [];
    const cues = blocks.map((block, i) => {
      const lines = block.split('\n');
      if (!/^\d+$/.test(lines[0].trim())) throw new Error(`Block ${i + 1}: expected a numeric subtitle index. No content has been imported.`);
      const timing = (lines[1] || '').match(time);
      if (!timing || !lines.slice(2).some(x=>x.trim())) throw new Error(`Cue ${lines[0]}: invalid timestamp or missing subtitle text. Expected 00:00:00,000 --> 00:00:01,000.`);
      for (const t of [timing[1],timing[2]]) { const [,m,s] = t.split(':'); if (Number(m)>59 || Number(s.split(',')[0])>59) throw new Error(`Cue ${lines[0]}: minutes and seconds must be between 00 and 59.`); }
      if (milliseconds(timing[2]) <= milliseconds(timing[1])) warnings.push(`Cue ${lines[0]} ends before or at its start time.`);
      if (Number(lines[0]) !== i + 1) warnings.push(`Cue ${lines[0]} has a non-sequential index; original numbering is preserved.`);
      const original = lines.slice(2).join('\n');
      return { id: i, index: lines[0], timing: lines[1], start: timing[1], end: timing[2], original, current: original };
    });
    return { cues, bom, newline, trailingNewline: /\n$/.test(normalized), warnings };
  }
  function serializeSrt(doc) {
    return (doc.bom ? '\uFEFF' : '') + doc.cues.map(c => `${c.index}\n${c.timing}\n${c.current}`).join('\n\n').replace(/\n/g, doc.newline) + (doc.trailingNewline ? doc.newline : '');
  }
  export function spans(text, protectContent = true) {
    const result=[]; let offset=0;
    for (const piece of text.split(tags)) {
      if (!piece) continue;
      const tag=/^(<[^>]*>|\{\\[^}]*\}|&(?:#\d+|#x[0-9a-f]+|[a-z]+);)$/i.test(piece);
      if(tag || !protectContent) result.push({text:piece,offset,protected:tag});
      else {
        let at=0;
        for(const m of piece.matchAll(protectedText)) {
          if(m.index>at)result.push({text:piece.slice(at,m.index),offset:offset+at,protected:false});
          result.push({text:m[0],offset:offset+m.index,protected:true});at=m.index+m[0].length;
        }
        if(at<piece.length)result.push({text:piece.slice(at),offset:offset+at,protected:false});
      }
      offset+=piece.length;
    }
    return result;
  }
  function caseLike(from,to) { if (from===from.toUpperCase()) return to.toUpperCase(); if (/^[A-Z][a-z]+$/.test(from)) return to.charAt(0).toUpperCase()+to.slice(1); return to; }
  function escaped(s) { return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }
  export function occurrences(text,rule) {
    if (!rule.from) return [];
    const reg = new RegExp(escaped(rule.from), rule.caseSensitive ? 'gu' : 'giu');
    const found = [];
    for (const span of spans(text,false)) {
      if (span.protected) continue;
      for (const m of span.text.matchAll(reg)) {
        const start = span.offset + m.index, end = start + m[0].length;
        const left=Array.from(span.text.slice(0,m.index)).pop() || '', right=Array.from(span.text.slice(m.index+m[0].length))[0] || '';
        if (rule.wholeWord && (/\p{L}|\p{N}|_/u.test(left) || /\p{L}|\p{N}|_/u.test(right))) continue;
        // Do not repeatedly expand a source embedded in its own replacement (e.g. support → support team).
        if (rule.to && rule.to.length>rule.from.length) {
          const targetReg=new RegExp(escaped(rule.to),rule.caseSensitive?'gu':'giu');
          if(Array.from(span.text.matchAll(targetReg)).some(t=>m.index>=t.index && m.index+m[0].length<=t.index+t[0].length))continue;
        }
        found.push({start,end,from:m[0],to:rule.preserveCase ? caseLike(m[0],rule.to) : rule.to});
      }
    }
    return found;
  }
  function issueKey(issue) { return JSON.stringify([issue.cue,issue.kind,issue.ruleId || '',issue.start,issue.from,issue.to]); }
  export function scan(doc,rules,options={uk:true,chinese:true,contextual:false}) {
    const issues=[];
    function push(c,kind,start,from,to,label,extra={}) { const v={cue:c.id,kind,start,end:start+from.length,from,to,label,...extra}; v.key=issueKey(v); issues.push(v); }
    for (const c of doc.cues) {
      if(options.uk) for(const span of spans(c.current)) {
        if(span.protected) continue;
        for(const m of span.text.matchAll(/[A-Za-z]+/g)) {
          const word=m[0].toLowerCase(), replacement=dictionary.get(word);
          if(replacement && (options.contextual || !contextual.has(word))) push(c,'uk',span.offset+m.index,m[0],caseLike(m[0],replacement),'UK spelling', {contextual:contextual.has(word)});
        }
      }
      if(options.chinese && options.chinese !== 'off') {
        let lineStart=0;
        for(const line of c.current.split('\n')) {
          if(han.test(line.replace(tags,''))) for(const span of spans(line)) {
            if(span.protected) continue;
            const pattern=options.chinese === 'cjk' ? /[，。！？、；：「」『』（）【】《》〈〉…—]/gu : punct;
            for(const m of span.text.matchAll(pattern)) push(c,'chinese',lineStart+span.offset+m.index,m[0],'','Chinese punctuation');
          }
          lineStart+=line.length+1;
        }
      }
      for(const rule of rules.filter(r=>r.enabled !== false)) for(const m of occurrences(c.current,rule)) {
        if(m.from!==m.to) push(c,'team',m.start,m.from,m.to,rule.note || 'Team correction',{ruleId:rule.id});
      }
    }
    return issues.sort((a,b)=>a.cue-b.cue || a.start-b.start || a.kind.localeCompare(b.kind));
  }
  export function applyIssues(doc,issues) {
    const groups=new Map(), changes=[], conflicts=[];
    for(const issue of issues) { if(!groups.has(issue.cue)) groups.set(issue.cue,[]); groups.get(issue.cue).push(issue); }
    for(const [id,list] of groups) {
      const cue=doc.cues.find(c=>c.id===id); if(!cue) continue;
      const ordered=list.sort((a,b)=>a.start-b.start || (a.kind==='team'?-1:1));
      const accepted=[];
      for(const issue of ordered) {
        if(cue.current.slice(issue.start,issue.end)!==issue.from) { conflicts.push(issue); continue; }
        if(accepted.some(x=>issue.start<x.end && issue.end>x.start)) { conflicts.push(issue); continue; }
        accepted.push(issue);
      }
      const before=cue.current;
      for(const issue of accepted.reverse()) cue.current=cue.current.slice(0,issue.start)+issue.to+cue.current.slice(issue.end);
      if(!cue.current.trim() || /\n[ \t]*\n/.test(cue.current)) { cue.current=before;conflicts.push(...accepted); }
      else if(before!==cue.current) changes.push({cue:id,index:cue.index,before,after:cue.current,issues:accepted});
    }
    return {changes,conflicts};
  }
  export function parseComments(input) {
    const rules=[],unparsed=[];
    for(const raw of input.split('\n').map(x=>x.trim()).filter(Boolean)) {
      let match=raw.match(/^(?:replace|change)\s+["“'](.+?)["”']\s+(?:with|to)\s+["“'](.*?)["”']\s*[.!]?$/i);
      if(!match) match=raw.match(/^(.+?)\s*(?:→|=>|->)\s*(.*)$/);
      if(!match) {unparsed.push(raw);continue;}
      const strip=x=>x.trim().replace(/^["“'](.*)["”']$/,'$1');
      const from=strip(match[1]),to=strip(match[2]);
      if(!from || from===to) {unparsed.push(raw);continue;}
      rules.push({from,to,note:raw,caseSensitive:true,wholeWord:false,preserveCase:false,enabled:true});
    }
    return {rules,unparsed};
  }
  export function diff(before,after) {
    const a=Array.from(before),b=Array.from(after);
    // Character LCS makes Chinese and English changes equally visible. Bound memory for unusually long cues.
    if(a.length*b.length>300000) return {before:[{text:before,changed:true}],after:[{text:after,changed:true}]};
    const table=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));
    for(let i=a.length-1;i>=0;i--) for(let j=b.length-1;j>=0;j--) table[i][j]=a[i]===b[j]?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
    const out={before:[],after:[]};
    function add(side,text,changed) {const last=out[side].at(-1);if(last && last.changed===changed)last.text+=text;else out[side].push({text,changed});}
    let i=0,j=0;
    while(i<a.length || j<b.length) {
      if(i<a.length && j<b.length && a[i]===b[j]) {add('before',a[i],false);add('after',b[j],false);i++;j++;}
      else if(j<b.length && (i===a.length || table[i][j+1]>table[i+1][j])) {add('after',b[j++],true);}
      else add('before',a[i++],true);
    }
    return out;
  }
