import React,{useState,useRef,useEffect} from 'react';
import {createPortal} from 'react-dom';
import {parseComments,ruleList} from './subtitle-vet.js';
import {occurrences} from './vet-core.js';
const labels={uk:'UK spelling',chinese:'Chinese punctuation',team:'Team rules'};
const download=(name,data)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function Dialog({title,onClose,children}) {
  const ref=useRef();useEffect(()=>{const d=ref.current;d.showModal();return()=>d.close();},[]);
  return createPortal(<dialog ref={ref} className="vet-dialog" aria-label={title} onCancel={e=>{e.preventDefault();onClose();}}>
    <header><strong>{title}</strong><button className="btn sm" onClick={onClose} aria-label="Close vet dialog">Close</button></header>{children}</dialog>,document.body);
}
export function VetCard({flag,onApply,onDismiss,onReveal}) {
  return <article className="vet-card" data-vet-cue={flag.cueId}>
    <button className="vet-seek" onClick={()=>onReveal(flag)}>#{flag.cueIndex+1} · Sub {flag.track} · {flag.startTime.toFixed(2)}s</button>
    <small>{flag.presetLabel}</small>
    <p className="vet-diff">{flag.before.slice(0,flag.offset)}<del>{flag.from}</del><mark>{flag.to || '∅'}</mark>{flag.before.slice(flag.limit)}</p>
    <p>{flag.reason}</p>
    <details><summary>Before / after</summary><p className="vet-verbatim">{flag.before}</p><p className="vet-verbatim">{flag.suggestion}</p></details>
    <div className="vet-actions"><button className="btn sm pri" onClick={()=>onApply([flag])}>Apply</button><button className="btn sm" onClick={()=>onDismiss([flag])}>Dismiss</button><button className="btn sm" onClick={()=>onReveal(flag,true)}>Open in editor</button></div>
  </article>;
}
export function VetIssues({flags,...handlers}) {
  return <div className="paper vet-issues" aria-label="Vetting issues">{flags.length?flags.map(f=><VetCard key={f.key} flag={f} {...handlers}/>):<p className="hint">No pending suggestions in this scope.</p>}</div>;
}
export default function SubtitleVet({open,onToggle,only,onOnly,state,onState,flags,scope,scopeKey,onReveal,onApply,onDismiss,onUndo,canUndo,cues,report,disabled,category,onCategory,dual,track,onTrack}) {
  const [panel,setPanel]=useState(null),[selected,setSelected]=useState(null),[preview,setPreview]=useState(null),[message,setMessage]=useState('');
  const [comments,setComments]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[note,setNote]=useState('');
  const [matchCase,setMatchCase]=useState(true),[whole,setWhole]=useState(false),[preserve,setPreserve]=useState(false);
  const input=useRef();
  useEffect(()=>{setSelected(null);setPreview(null);setPanel(null);},[scopeKey]);
  const visible=flags.filter(f=>category==='all'||f.kindOfCheck===category);
  const current=visible.find(f=>f.key===selected), bulk=visible.filter(f=>!f.contextual);
  const pick=delta=>{if(!visible.length)return;const index=visible.findIndex(f=>f.key===selected);const f=visible[(index+delta+visible.length)%visible.length];setSelected(f.key);onReveal(f);};
  const patch=change=>onState({...state,...change});
  const addRules=rules=>{if(state.rules.length+rules.length>1000)throw new Error('Keep at most 1000 rules.');patch({rules:[...state.rules,...rules]});};
  const importRules=async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try {if(file.size>2e6)throw new Error('Rules file is too large.');addRules(ruleList(JSON.parse(await file.text())));setMessage('Rules imported.');}catch(err){setMessage(err.message);}};
  return <><style>{`
  .vet-bar{position:relative;display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:6px 12px;border-top:1px solid var(--rule,#ddd);font-size:11px;background:var(--field,#fafafa)}
  .vet-bar label{display:flex;align-items:center;gap:4px}.vet-bar .btn{font-size:11px}.vet-bar select{font-size:11px}.vet-bar small{color:var(--ink-3,#666)}
  .vet-pop{position:absolute;right:8px;top:100%;width:380px;max-height:55vh;overflow:auto;z-index:70;background:white;border:1px solid #ccd4cc;border-radius:8px;box-shadow:0 8px 22px #0002}
  .vet-card{padding:12px;border-bottom:1px solid #dde2dd;background:white;text-align:left;min-width:0}.vet-card>small{display:block;color:#657165;font-size:10px;margin:5px 0}.vet-seek{color:#326152;background:none;border:0;font:inherit;cursor:pointer}
  .vet-card p{font-size:12px;line-height:1.65;margin:6px 0;overflow-wrap:anywhere}.vet-diff,.vet-verbatim{white-space:pre-wrap}.vet-diff del{background:#fbe4df;color:#8e3e32}.vet-diff mark{background:#dfefdc;padding:1px 2px}.vet-card details{font-size:11px}.vet-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}
  .vet-issues{overflow:auto;flex:1;padding:10px!important}.vet-issues .vet-card{margin-bottom:8px;border:1px solid #dce1dc;border-radius:6px}
  .vet-dialog{font:13px Inter,'Segoe UI',sans-serif;color:#27362c;background:white;border:1px solid #ccd4cc;border-radius:10px;width:min(640px,90vw);max-height:80vh;overflow:auto;padding:18px;box-sizing:border-box}.vet-dialog::backdrop{background:#0005}.vet-dialog header{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.vet-dialog nav{display:flex;gap:8px;margin-bottom:14px}.vet-dialog label{display:block;margin:12px 0}.vet-dialog input[type=text],.vet-dialog textarea{display:block;box-sizing:border-box;width:100%;padding:8px;margin-top:5px;border:1px solid #bbc8bc;border-radius:4px;font:inherit}.vet-dialog select{font:inherit}.vet-dialog small{display:block;color:#687468;margin:5px 0}.vet-dialog .vet-rule{border-top:1px solid #ddd;padding:10px 0}.vet-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere}.vet-dialog button{cursor:pointer}.vet-dialog .vet-check{display:flex;gap:6px;align-items:center}.vet-dialog .vet-notes{white-space:pre-wrap;padding:8px;background:#fff5df}.vet-dialog .vet-history{border-top:1px solid #ddd;padding:8px 0}
  `}</style><div className="vet-bar" role="toolbar" aria-label="Subtitle vetting">
    <button className={'btn sm'+(open?' pri':'')} aria-pressed={open} onClick={onToggle}>Vet{open?' · '+flags.length+' issues':''}</button>
    {open&&<><small>{scope}</small>{dual&&<select aria-label="Vet subtitle track" value={track} onChange={e=>onTrack(e.target.value)}><option value="A">Sub A</option><option value="B">Sub B</option></select>}<button className="btn sm" disabled={!visible.length} onClick={()=>pick(-1)}>Previous issue</button><button className="btn sm" disabled={!visible.length} onClick={()=>pick(1)}>Next issue</button>
      <label><input type="checkbox" checked={only} onChange={e=>onOnly(e.target.checked)}/>Issues only</label>
      <select aria-label="Vet category" value={category} onChange={e=>{onCategory(e.target.value);setSelected(null);}}><option value="all">All checks</option>{Object.entries(labels).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
      <button className="btn sm" disabled={!bulk.length||disabled} onClick={()=>setPreview([...bulk])}>Apply shown…</button>
      <button className="btn sm" disabled={!canUndo} onClick={onUndo}>Undo vet / edit</button>
      <button className="btn sm" onClick={()=>setPanel('checks')}>Vet settings</button>
    </>}
    {open&&current&&!only&&<div className="vet-pop" role="dialog" aria-label="Vet suggestion" onKeyDown={e=>{if(e.key==='Escape')setSelected(null);}}><button className="btn sm" onClick={()=>setSelected(null)}>Close suggestion</button><VetCard flag={current} onApply={onApply} onDismiss={onDismiss} onReveal={onReveal}/></div>}
  </div>
  {panel&&<Dialog title="Subtitle vet settings" onClose={()=>setPanel(null)}><nav>{['checks','rules','history'].map(p=><button className={'btn sm'+(panel===p?' pri':'')} key={p} onClick={()=>{setPanel(p);setMessage('');}}>{p==='rules'?'Team rules':p[0].toUpperCase()+p.slice(1)}</button>)}</nav>
    {message&&<p role="status">{message}</p>}
    {panel==='checks'&&<><label><input type="checkbox" checked={state.options.uk} onChange={e=>patch({options:{...state.options,uk:e.target.checked}})}/>Suggest UK spelling (−ise)</label>
      <label><input type="checkbox" checked={state.options.contextual} onChange={e=>patch({options:{...state.options,contextual:e.target.checked}})}/>Include context-dependent spellings</label><small>Program, check, licence/license and meter need individual review. They are excluded from bulk application.</small>
      <label>Chinese punctuation <select aria-label="Chinese punctuation policy" value={state.options.chinese} onChange={e=>patch({options:{...state.options,chinese:e.target.value}})}><option value="off">Off</option><option value="cjk">Suggest removing Chinese punctuation</option><option value="all">Suggest removing punctuation on Chinese lines</option></select></label>
      <small>Numbers, URLs, email addresses, common honorifics, contractions and formatting tags are protected. All changes require Apply.</small><p>Checks run locally. No API key or transcription is needed.</p></>}
    {panel==='rules'&&<><label>Paste team comments<textarea aria-label="Team comments" rows={3} value={comments} onChange={e=>setComments(e.target.value)} placeholder={'old text → new text\nReplace "old" with "new"'}/></label>
      <button className="btn sm" onClick={()=>{try{const parsed=parseComments(comments);const rules=ruleList(parsed.rules);if(state.rules.length+rules.length>1000)throw new Error('Keep at most 1000 rules.');patch({rules:[...state.rules,...rules],notes:[...state.notes,...parsed.unparsed]});setComments('');setMessage(rules.length+' rules added; '+parsed.unparsed.length+' notes need review.');}catch(e){setMessage(e.message);}}}>Create rules</button>
      {state.notes.length>0&&<div className="vet-notes"><strong>Notes needing manual review</strong><p>{state.notes.join('\n')}</p><button className="btn sm" onClick={()=>patch({notes:[]})}>Mark notes reviewed</button></div>}
      <form onSubmit={e=>{e.preventDefault();try{addRules(ruleList([{from,to,note,caseSensitive:matchCase,wholeWord:whole,preserveCase:preserve}]));setFrom('');setTo('');setNote('');setMessage('Rule added.');}catch(err){setMessage(err.message);}}}>
        <label>Find text<input type="text" aria-label="Rule find text" required value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Replace with<input type="text" aria-label="Rule replacement" value={to} onChange={e=>setTo(e.target.value)}/></label><small>A blank replacement removes matching text.</small><label>Reviewer / note<input type="text" aria-label="Rule note" value={note} onChange={e=>setNote(e.target.value)}/></label>
        <label className="vet-check"><input type="checkbox" checked={matchCase} onChange={e=>setMatchCase(e.target.checked)}/>Case sensitive</label><label className="vet-check"><input type="checkbox" checked={whole} onChange={e=>setWhole(e.target.checked)}/>Whole words</label><label className="vet-check"><input type="checkbox" checked={preserve} onChange={e=>setPreserve(e.target.checked)}/>Preserve English case</label><button className="btn sm" type="submit">Add correction rule</button>
      </form><div className="vet-actions"><button className="btn sm" onClick={()=>input.current.click()}>Import rules JSON</button><input ref={input} type="file" accept=".json" hidden onChange={importRules}/><button className="btn sm" onClick={()=>download('subtitle-vet-rules.json',{format:'subtitle-vet-rules',version:1,rules:state.rules})}>Export rules</button></div>
      {state.rules.map(r=>{const hits=cues.flatMap(c=>occurrences(c.text,r).map(h=>({...h,cue:c.id})));return <div className="vet-rule" key={r.id}><strong>{r.from} → {r.to||'(remove text)'}</strong><small>{r.note}</small><small>{hits.length} remaining matches in {new Set(hits.map(h=>h.cue)).size} cues · {scope}</small><div className="vet-actions"><label><input type="checkbox" checked={r.enabled} onChange={e=>patch({rules:state.rules.map(x=>x.id===r.id?{...x,enabled:e.target.checked}:x)})}/>Enabled</label><button className="btn sm" onClick={()=>patch({rules:state.rules.filter(x=>x.id!==r.id)})}>Remove rule</button></div></div>;})}
    </>}
    {panel==='history'&&<><button className="btn sm" onClick={()=>download('subtitle-vet-report.json',report)}>Download review report</button><button className="btn sm" disabled={!state.dismissed.length} onClick={()=>patch({dismissed:[]})}>Restore dismissed suggestions</button>
      {!state.log.length&&<p>No review decisions yet.</p>}{[...state.log].reverse().map(l=><div className="vet-history" key={l.id}><strong>{l.action}</strong><small>{new Date(l.time).toLocaleString()}</small>{l.changes.map((c,i)=><details key={i}><summary>{c.assetKey} · Sub {c.track} · {c.start.toFixed(2)}s</summary><p className="vet-verbatim">Before: {c.before}</p><p className="vet-verbatim">After: {c.after}</p></details>)}</div>)}</>}
  </Dialog>}
  {preview&&<Dialog title="Apply shown suggestions" onClose={()=>setPreview(null)}><p>{preview.length} suggestions across {new Set(preview.map(f=>f.cueId)).size} cues · {scope}</p><small>Context-dependent words require individual review. Conflicting or stale suggestions stay pending. This is one Undo action.</small>
    <div>{preview.slice(0,50).map(f=><div key={f.key} className="vet-rule">#{f.cueIndex+1}: <del>{f.from}</del> → <mark>{f.to||'(remove)'}</mark></div>)}{preview.length>50&&<p>And {preview.length-50} more shown suggestions.</p>}</div><button className="btn pri" disabled={disabled} onClick={()=>{onApply(preview);setPreview(null);}}>Apply {preview.length} shown suggestions</button></Dialog>}
  </>;
}
