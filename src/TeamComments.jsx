import React, { useEffect, useRef, useState } from 'react';
import { WORKSPACE_NAMES, anchorStatus } from './collaboration-activity.js';

const initials = name => name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const stamp = value => new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
export function anchorLabel(anchor, doc) {
  const source = doc.media?.[anchor.assetKey]?.name;
  const kind = {transcript:'Paragraph',cue:'Caption',clip:'Clip',card:'Story card',multi:'Sequence clip',range:'Time range'}[anchor.kind] || 'Selection';
  return `${WORKSPACE_NAMES[anchor.workspace]} · ${kind}${anchor.track?' · Sub '+anchor.track:''}${source?' · '+source:''}`;
}

function Composer({ c, onSubmit, label, draftKey, allowAssign = false, onCancel }) {
  const [initial] = useState(()=>{const raw=localStorage.getItem(draftKey)||'';try{const value=JSON.parse(raw);return value&&typeof value.text==='string'?value:{text:raw};}catch{return{text:raw};}});
  const [text,setText] = useState(initial.text||''), [chosen,setChosen] = useState(initial.chosen||[]), [assignee,setAssignee] = useState(initial.assignee||'');
  const [error,setError] = useState(''), [query,setQuery] = useState(null);
  const textarea = useRef(null), operationId = useRef(initial.operationId||crypto.randomUUID().replaceAll('-',''));
  const self = {id:c.participantId,name:c.name,colour:'#2563eb'};
  const members = c.members.some(m=>m.id===c.participantId) ? c.members : [...c.members,self];
  const canWrite = !c.target || (c.ready && c.role==='editor' && c.presenceOnline);
  useEffect(() => { textarea.current?.focus(); }, []);
  useEffect(()=>{if(text||chosen.length||assignee)localStorage.setItem(draftKey,JSON.stringify({text,chosen,assignee,operationId:operationId.current}));else localStorage.removeItem(draftKey);},[text,chosen,assignee,draftKey]);
  const change = value => {
    operationId.current=crypto.randomUUID().replaceAll('-','');if(error)setError('');
    setText(value);
    const match = /(?:^|\s)@([^@\n]{0,60})$/.exec(value.slice(0,textarea.current?.selectionStart ?? value.length));
    setQuery(match ? match[1] : null);
  };
  const mention = member => {
    operationId.current=crypto.randomUUID().replaceAll('-','');
    const el=textarea.current, caret=el.selectionStart, before=text.slice(0,caret).replace(/@[^@\n]{0,60}$/, ()=> '@'+member.name+' ');
    const next=before+text.slice(caret);setText(next);setChosen(ids=>[...new Set([...ids,member.id])]);setQuery(null);
    requestAnimationFrame(()=>{el.focus();el.setSelectionRange(before.length,before.length);});
  };
  return <form className="team-composer" onSubmit={async event=>{
    event.preventDefault();setError('');
    try {
      const mentions=chosen.filter(id=>text.includes('@'+members.find(m=>m.id===id)?.name));
      await onSubmit({id:operationId.current,text,mentions,assignee:assignee||null});
      setText('');setChosen([]);setAssignee('');localStorage.removeItem(draftKey);operationId.current=crypto.randomUUID().replaceAll('-','');
    } catch(error){setError(error.message);}
  }}>
    <textarea ref={textarea} aria-label={label} value={text} maxLength={4000} placeholder="Write a comment… Type @ to mention" onChange={e=>change(e.target.value)} disabled={!canWrite||c.commentBusy}/>
    {query!==null&&<div className="team-mention-list" role="listbox" aria-label="Mention a participant">{members.filter(m=>m.name.toLowerCase().includes(query.toLowerCase())).map(m=><button type="button" key={m.id} aria-label={m.name} onMouseDown={e=>e.preventDefault()} onClick={()=>mention(m)}><span style={{background:m.colour}}>{initials(m.name)}</span>{m.name}{m.id===c.participantId?' (you)':''}</button>)}{!members.some(m=>m.name.toLowerCase().includes(query.toLowerCase()))&&<small>No matching project participant.</small>}</div>}
    {!!chosen.length&&<small>Mentioning {chosen.map(id=>members.find(m=>m.id===id)?.name).filter(Boolean).join(', ')}</small>}
    {allowAssign&&<label className="team-assignment">Action owner<select aria-label="Assign comment action" value={assignee} onChange={e=>{operationId.current=crypto.randomUUID().replaceAll('-','');setAssignee(e.target.value);}} disabled={!canWrite||c.commentBusy}><option value="">No action assigned</option>{members.map(m=><option key={m.id} value={m.id}>{m.name}{m.id===c.participantId?' (you)':''}</option>)}</select></label>}
    {error&&<p role="alert" className="team-error">{error}</p>}
    {!canWrite&&<small>{c.role==='viewer'?'An editor link is needed to comment.':'Reconnect before posting. Your draft stays on this device.'}</small>}
    <footer><button type="button" onClick={onCancel}>Cancel</button><button className="team-primary" type="submit" disabled={!canWrite||!text.trim()||c.commentBusy}>{c.commentBusy?'Posting…':label==='Reply to thread'?'Reply':'Post comment'}</button></footer>
  </form>;
}

export default function TeamComments({ c, doc, workspace, panelTop, open, setOpen, selected, setSelected, draftAnchor, setDraftAnchor, onNavigate }) {
  const [filter,setFilter] = useState('open'), [error,setError] = useState('');
  const box=useRef(null), trigger=useRef(null);
  const threads=c.discussion.threads, forMe=thread=>thread.assignee===c.participantId||thread.messages.some(m=>m.mentions.includes(c.participantId));
  const visible=threads.filter(thread=>filter==='resolved'?thread.resolved:filter==='all'?true:!thread.resolved&&(filter==='mine'?forMe(thread):filter==='view'?thread.anchor.workspace===workspace:true)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const canWrite=!c.target||(c.role==='editor'&&c.ready&&c.presenceOnline);
  const action=async operation=>{setError('');try{await c.comment(operation);}catch(error){setError(error.message);}};
  useEffect(()=>{if(open&&!draftAnchor)box.current?.querySelector('button')?.focus();},[open]);
  useEffect(()=>{if(open)c.refreshDiscussion().catch(()=>{});},[open]);
  useEffect(()=>{if(selected){setFilter('all');requestAnimationFrame(()=>box.current?.querySelector(`[data-thread-id="${CSS.escape(selected)}"]`)?.scrollIntoView({block:'nearest'}));}},[selected]);
  if(!open)return null;
  return <aside ref={box} className="team-comments team-ui" style={{top:panelTop}} aria-label="Project comments" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);}}}>
    <header><div><h2>Comments & actions</h2><small>{c.target?'Shared with this project':'Saved with this local project'}</small></div><button aria-label="Close comments" onClick={()=>setOpen(false)}>×</button></header>
    <nav aria-label="Comment filters">{[['open','Open'],['mine','For me'],['view','This view'],['resolved','Resolved'],['all','All']].map(([id,label])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}{id==='mine'&&threads.some(t=>!t.resolved&&forMe(t))?' · '+threads.filter(t=>!t.resolved&&forMe(t)).length:''}</button>)}</nav>
    {error&&<p role="alert" className="team-error">{error}</p>}
    {c.discussionError&&<p className="team-error" role="status">Comments are offline. {c.discussionError}</p>}
    {draftAnchor&&<section className="team-new-comment"><h3>New comment</h3><small>{anchorLabel(draftAnchor,doc)}</small>{draftAnchor.quote&&<blockquote>{draftAnchor.quote}</blockquote>}<Composer key={'new:'+JSON.stringify(draftAnchor)} c={c} label="Comment text" allowAssign draftKey={'transcriber.commentDraft:'+(c.target?.id||'local')+':'+JSON.stringify(draftAnchor)} onCancel={()=>setDraftAnchor(null)} onSubmit={async value=>{
      await c.comment({...value,action:'create',anchor:draftAnchor});setDraftAnchor(null);setSelected(value.id);setFilter('all');
    }}/></section>}
    {!draftAnchor&&<p className="team-comments-hint">Select text, a clip, a card or a timeline range, then choose <b>Add comment</b>. Use Ctrl/⌘+Alt+M.</p>}
    <div className="team-thread-list">{visible.map(thread=>{
      const expanded=selected===thread.id, status=anchorStatus(doc,thread.anchor), owner=c.members.find(m=>m.id===thread.assignee);
      return <article key={thread.id} data-thread-id={thread.id} className={'team-thread'+(expanded?' selected':'')+(thread.resolved?' resolved':'')}>
        <button className="team-thread-anchor" onClick={()=>{setSelected(thread.id);onNavigate(thread.anchor);}} title="Go to commented content">{anchorLabel(thread.anchor,doc)} <span>↗</span></button>
        {thread.anchor.quote&&<blockquote>{thread.anchor.quote}</blockquote>}
        {status!=='available'&&<small className="team-anchor-warning">{status} · original comment retained</small>}
        {owner&&<div className={'team-action-owner'+(owner.id===c.participantId?' mine':'')}>☐ Action for {owner.name}{owner.id===c.participantId?' (you)':''}</div>}
        {(expanded?thread.messages:thread.messages.slice(0,1)).map(message=>{
          const author=c.members.find(m=>m.id===message.author.id);
          return <div className="team-message" key={message.id}><div className="team-message-author"><span style={{background:author?.colour||'#475569'}}>{initials(message.author.name)}</span><b>{message.author.name}</b><time dateTime={message.createdAt}>{stamp(message.createdAt)}</time></div><p>{message.text}</p>{!!message.mentions.length&&<div className="team-mentions">{message.mentions.map(id=><span key={id} className={id===c.participantId?'mine':''}>@{c.members.find(m=>m.id===id)?.name||'Participant'}</span>)}</div>}</div>;
        })}
        <div className="team-thread-actions"><button onClick={()=>setSelected(expanded?null:thread.id)}>{expanded?'Collapse':thread.messages.length>1?`${thread.messages.length-1} replies`:'Open thread'}</button><button disabled={!canWrite||c.commentBusy} onClick={()=>action({action:thread.resolved?'reopen':'resolve',threadId:thread.id})}>{thread.resolved?'Reopen':'Resolve'}</button></div>
        {expanded&&<><label className="team-assignment">Action owner<select aria-label="Change action owner" disabled={!canWrite||c.commentBusy} value={thread.assignee||''} onChange={e=>action({action:'assign',threadId:thread.id,assignee:e.target.value||null})}><option value="">No action assigned</option>{c.members.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{!thread.resolved&&<Composer key={thread.id} c={c} label="Reply to thread" draftKey={'transcriber.commentReply:'+(c.target?.id||'local')+':'+thread.id} onCancel={()=>setSelected(null)} onSubmit={value=>c.comment({...value,action:'reply',threadId:thread.id})}/>}</>}
        {thread.resolved&&<small className="team-resolved">✓ Resolved</small>}
      </article>;
    })}{!visible.length&&<div className="team-empty">{filter==='mine'?'No open mentions or assigned actions for you.':'No comments in this view yet.'}</div>}</div>
    <footer className="team-comment-note">Mentions notify participants in this project’s <b>For me</b> list. Names identify browsers, not verified accounts.</footer>
  </aside>;
}
