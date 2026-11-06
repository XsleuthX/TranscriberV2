import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TeamComments from './TeamComments.jsx';
import { WORKSPACE_NAMES, participantColour, textFingerprint, cleanActivity } from './collaboration-activity.js';
import { captureActivity, findActivityElements, findField, fieldText, clippedRect, selectionRects, clipBox, timelinePosition } from './collaboration-dom.js';
import './collaboration-workspace.css';

const initials = name => name.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
const position = rect => ({left:rect.left,top:rect.top,width:rect.width,height:rect.height});
export default function CollaborationWorkspace({ collaboration:c, document:doc, context, onNavigate }) {
  const pendingKey='transcriber.commentAnchor:'+(c.target?.id||'local');
  const [restoredAnchor]=useState(()=>{try{return cleanActivity(JSON.parse(localStorage.getItem(pendingKey)||'null'));}catch{return null;}});
  const [activity,setActivity]=useState(context), [show,setShow]=useState(()=>localStorage.getItem('transcriber.liveSelections')!=='off');
  const [open,setOpen]=useState(!!restoredAnchor), [draftAnchor,setDraftAnchor]=useState(restoredAnchor), [selected,setSelected]=useState(null), [preview,setPreview]=useState(null);
  useEffect(()=>{if(draftAnchor)localStorage.setItem(pendingKey,JSON.stringify(draftAnchor));else localStorage.removeItem(pendingKey);},[draftAnchor,pendingKey]);
  const [geometry,setGeometry]=useState({shapes:[],pins:[],selection:null});
  const latest=useRef({});latest.current={c,doc,context,activity,show,selected};
  const pendingJump=useRef(null), root=useRef(null);
  const ownColour=c.members.find(member=>member.id===c.participantId)?.colour||participantColour(c.participantId);
  useEffect(()=>{const app=document.querySelector('.tx');app?.style.setProperty('--team-self-colour',ownColour);app?.style.setProperty('--team-self-selection',ownColour+'30');},[ownColour]);
  const contextKey=JSON.stringify(context);
  const openComment=()=>{
    const captured=captureActivity(latest.current.context);
    const a=captured&&captured.kind!=='view'?captured:latest.current.activity;
    if(!a||a.kind==='view')return;
    setDraftAnchor({...a,draft:undefined,editing:false});setOpen(true);setSelected(null);
  };
  const jump=anchor=>{document.activeElement?.blur?.();onNavigate(anchor);pendingJump.current={anchor,until:Date.now()+3000};};
  useEffect(()=>{
    let timer;
    const update=event=>{
      if(event?.target?.closest?.('.team-ui, .team-overlay, .collab-panel')){
        if(event.type==='focusin'&&latest.current.activity)latest.current.c.setActivity({...latest.current.activity,editing:false,draft:undefined});
        return;
      }
      const clicked=event?.type==='pointerup'?event.target:null;
      clearTimeout(timer);timer=setTimeout(()=>{
        const next=captureActivity(latest.current.context,clicked);
        if(next){setActivity(next);latest.current.c.setActivity(next);}
      },60);
    };
    const key=event=>{
      if((event.ctrlKey||event.metaKey)&&event.altKey&&event.key.toLowerCase()==='m'&&!event.target.closest?.('.team-comments')){
        event.preventDefault();event.stopPropagation();openComment();
      }
    };
    const away=()=>{const current=latest.current.activity;latest.current.c.setActivity(document.visibilityState==='hidden'?null:current?{...current,editing:false}:null);};
    for(const type of ['selectionchange','input','keyup','pointerup','focusin'])document.addEventListener(type,update,true);
    document.addEventListener('keydown',key,true);window.addEventListener('blur',away);window.addEventListener('focus',update);
    const visibility=()=>{if(document.visibilityState==='hidden')away();else update();};
    document.addEventListener('visibilitychange',visibility);
    return()=>{clearTimeout(timer);for(const type of ['selectionchange','input','keyup','pointerup','focusin'])document.removeEventListener(type,update,true);document.removeEventListener('keydown',key,true);window.removeEventListener('blur',away);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  useEffect(()=>{
    const next=captureActivity(context)||context;setActivity(next);c.setActivity(next);
  },[contextKey]);
  useEffect(()=>{
    let scheduled=false,alive=true;
    const measure=()=>{
      scheduled=false;if(!alive)return;
      const {c,context,activity,show,selected}=latest.current;
      const shapes=[],pins=[];
      if(show&&c.presenceOnline)for(const person of c.people.filter(p=>p.clientId!==c.clientId&&p.activity?.workspace===context.workspace)){
        const a=person.activity,colour=person.colour||participantColour(person.participantId||person.clientId);
        if(['timeline','transcript','subtitle'].includes(a.workspace)&&a.assetKey!==context.assetKey)continue;
        const nodes=findActivityElements(a);let labelled=false;
        for(const node of nodes){
          const box=clippedRect(node);if(!box)continue;
          const field=findField(node,a), same=field&&a.textHash===textFingerprint(fieldText(field));
          const label=person.name+(a.editing?' · editing':' · selecting');
          shapes.push({type:'outline',key:person.clientId+':'+shapes.length,colour,rect:box,name:person.name});
          if(field&&a.kind==='transcript'&&a.start==null&&a.wordStart!=null&&a.wordEnd!=null){
            const words=[...field.querySelectorAll('[data-word-index]')].filter(word=>Number(word.dataset.wordIndex)>=a.wordStart&&Number(word.dataset.wordIndex)<=a.wordEnd);
            for(const word of words)for(const rect of word.getClientRects()){const visible=clipBox(rect,box);if(visible)shapes.push({type:'highlight',key:person.clientId+':w'+shapes.length,colour,rect:visible,name:person.name});}
          }
          if(same&&a.start!=null&&a.end!=null){
            const clip=clippedRect(field), range=selectionRects(field,a.start,a.end);
            if(clip&&range){
              for(const rect of range.rects){const visible=clipBox(rect,clip);if(visible&&a.end>a.start)shapes.push({type:'highlight',key:person.clientId+':h'+shapes.length,colour,rect:visible,name:person.name});}
              const caret=range.caret;
              if(caret&&caret.left>=clip.left-1&&caret.left<=clip.right+1&&caret.top<clip.bottom&&caret.top+caret.height>clip.top){
                shapes.push({type:'caret',key:person.clientId+':caret',colour,rect:{left:caret.left,top:Math.max(caret.top,clip.top),width:2,height:Math.min(caret.height,clip.bottom-caret.top)},name:person.name});
                if(!labelled){shapes.push({type:'label',key:person.clientId+':label',colour,rect:{left:Math.max(4,Math.min(innerWidth-180,caret.left)),top:Math.max(2,caret.top-19)},name:label,person});labelled=true;}
              }
            }
          }
          if(!labelled){shapes.push({type:'label',key:person.clientId+':label',colour,rect:{left:Math.max(4,Math.min(innerWidth-180,box.left+4)),top:Math.max(2,box.top-18)},name:person.name+(a.editing&&!same?' · editing draft':' · selected'),person});labelled=true;}
        }
        if(['timeline','multi'].includes(a.workspace)){
          const line=timelinePosition(a);
          if(line){
            if(line.end>line.left){const rect=clipBox({left:line.left,top:line.top,width:line.end-line.left,height:line.height},line.clip);if(rect)shapes.push({type:'time-range',key:person.clientId+':range',colour,rect,name:person.name});}
            if(line.cursor>=line.clip.left&&line.cursor<=line.clip.right){
              shapes.push({type:'playhead',key:person.clientId+':playhead',colour,rect:{left:line.cursor,top:line.top,width:2,height:line.height},name:person.name});
              if(!labelled)shapes.push({type:'label',key:person.clientId+':time-label',colour,rect:{left:Math.min(innerWidth-180,line.cursor+3),top:line.top+2},name:person.name,person});
            }
          }
        }
      }
      const grouped=new Map();
      for(const thread of c.discussion.threads.filter(t=>!t.resolved&&t.anchor.workspace===context.workspace)){
        const a=thread.anchor;if(a.workspace!=='story'&&a.workspace!=='multi'&&a.assetKey!==context.assetKey)continue;
        let node=findActivityElements(a).find(n=>clippedRect(n));
        if(!node&&a.cardId)node=document.querySelector(`[data-card-id="${CSS.escape(a.cardId)}"]`);
        let box=node&&clippedRect(node);
        if(!box&&a.kind==='range'){
          const line=timelinePosition(a);if(line&&line.left>=line.clip.left&&line.left<=line.clip.right)box={left:line.left,top:line.top,right:line.left+2,bottom:line.top+line.height,width:2,height:line.height};
        }
        if(!box)continue;
        const groupKey=[a.kind,a.id,a.assetKey,a.track].join(':');
        const group=grouped.get(groupKey)||{id:thread.id,count:0,rect:box};group.count++;grouped.set(groupKey,group);
        if(selected===thread.id){
          const field=node&&findField(node,a);
          if(field&&a.textHash===textFingerprint(fieldText(field))&&a.start!=null&&a.end>a.start){
            const clip=clippedRect(field);for(const rect of selectionRects(field,a.start,a.end)?.rects||[]){const visible=clip&&clipBox(rect,clip);if(visible)shapes.push({type:'comment-range',key:thread.id+':'+shapes.length,rect:visible,colour:'#d97706'});}
          }
        }
      }
      for(const group of grouped.values())pins.push({...group,left:Math.max(2,Math.min(innerWidth-35,group.rect.right-25)),top:Math.max(2,group.rect.top+2)});
      let selection=null;
      if(activity?.quote&&activity.workspace===context.workspace){
        const node=findActivityElements(activity)[0],field=node&&findField(node,activity);
        if(field&&fieldText(field)&&activity.textHash===textFingerprint(fieldText(field))){const rect=selectionRects(field,activity.start,activity.end)?.rects[0];if(rect&&clippedRect(field))selection={left:Math.max(8,Math.min(innerWidth-135,rect.left)),top:Math.max(40,rect.top-34)};}
      }
      const pending=pendingJump.current;
      if(pending){const node=findActivityElements(pending.anchor)[0]||(pending.anchor.cardId&&document.querySelector(`[data-card-id="${CSS.escape(pending.anchor.cardId)}"]`));if(node){node.scrollIntoView({block:'center',inline:'nearest'});pendingJump.current=null;}else if(Date.now()>pending.until)pendingJump.current=null;}
      setGeometry({shapes,pins,selection,workspace:context.workspace,assetKey:context.assetKey,panelTop:Math.max(60,Math.min(innerHeight-240,(root.current?.getBoundingClientRect().bottom||100)+8))});
    };
    const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(measure);}};
    const timer=setInterval(schedule,250);window.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);schedule();
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);};
  },[]);
  const forMe=c.discussion.threads.filter(t=>!t.resolved&&(t.assignee===c.participantId||t.messages.some(m=>m.mentions.includes(c.participantId)))).length;
  const peers=c.people.filter(p=>p.clientId!==c.clientId);
  const previewPerson=c.people.find(p=>p.clientId===preview), draft=previewPerson?.activity?.draft;
  const geometryCurrent=geometry.workspace===context.workspace&&geometry.assetKey===context.assetKey;
  return <>
    <div ref={root} className="team-strip team-ui" role="toolbar" aria-label="Live collaboration">
      {c.target?<><span className={'team-live-dot'+(c.presenceOnline?' online':'')}/><span className="team-strip-title">{c.presenceOnline?'Live collaboration':'Reconnecting team…'}</span><div className="team-participants">{peers.slice(0,8).map(person=><button key={person.clientId} className="team-person" style={{'--person-colour':person.colour||participantColour(person.participantId||person.clientId)}} aria-label={'Locate '+person.name} title={person.name+' · '+(WORKSPACE_NAMES[person.activity?.workspace]||'Away')+(person.activity?.editing?' · editing':'')} disabled={!person.activity} onClick={()=>jump(person.activity)}><span className="team-avatar">{initials(person.name)}</span><span>{person.name}<small>{WORKSPACE_NAMES[person.activity?.workspace]||'Away'}{person.activity?.editing?' · editing':''}</small></span></button>)}</div>{!peers.length&&<span className="team-waiting">Invite a teammate with your project link</span>}</>:<span className="team-strip-title">Project comments</span>}
      <div className="team-strip-spacer"/>
      {c.target&&<label className="team-selection-toggle"><input type="checkbox" checked={show} onChange={e=>{setShow(e.target.checked);localStorage.setItem('transcriber.liveSelections',e.target.checked?'on':'off');}}/>Live selections</label>}
      <button className="team-add-comment" aria-label="Add comment" disabled={!activity||activity.kind==='view'||(!!c.target&&c.role!=='editor')} onMouseDown={e=>e.preventDefault()} onClick={openComment}>＋ Add comment</button>
      <button className={'team-comment-toggle'+(open?' active':'')} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Comments <span>{c.discussion.threads.filter(t=>!t.resolved).length}</span>{forMe>0&&<b aria-label={forMe+' mentions or actions for you'}>{forMe} for you</b>}</button>
    </div>
    {createPortal(<div className="team-overlay" aria-label="Remote selections">{geometryCurrent&&geometry.shapes.map(shape=>shape.type==='label'?<button key={shape.key} className="team-remote-label" data-person={shape.person.clientId} tabIndex={shape.name.includes('editing draft')?0:-1} style={{left:shape.rect.left,top:shape.rect.top,background:shape.colour,pointerEvents:shape.name.includes('editing draft')?'auto':'none'}} onClick={()=>setPreview(shape.person.clientId)}>{shape.name}</button>:<div key={shape.key} data-person={shape.name} className={'team-remote-'+shape.type} style={{...position(shape.rect),'--person-colour':shape.colour}} aria-label={shape.name?shape.name+' '+shape.type:undefined}/>)}
      {geometryCurrent&&geometry.pins.map(pin=><button key={pin.id} className="team-comment-pin" style={{left:pin.left,top:pin.top}} aria-label={'Open '+pin.count+' comment'+(pin.count===1?'':'s')+' here'} onClick={()=>{setOpen(true);setSelected(pin.id);}}>▤{pin.count>1&&<b>{pin.count}</b>}</button>)}
      {geometryCurrent&&activity?.workspace===context.workspace&&geometry.selection&&!open&&(!c.target||c.role==='editor')&&<button className="team-selection-comment" style={geometry.selection} onMouseDown={e=>e.preventDefault()} onClick={openComment}>＋ Comment</button>}
      {previewPerson&&<section className="team-draft-preview team-ui" role="dialog" aria-label="Participant activity"><header><b style={{color:previewPerson.colour}}>{previewPerson.name} · {WORKSPACE_NAMES[previewPerson.activity?.workspace]||'Away'}</b><button aria-label="Close activity preview" onClick={()=>setPreview(null)}>×</button></header>{draft!=null?<><small>Live unshared text preview</small><pre>{previewPerson.activity.end<=draft.length?<>{draft.slice(0,previewPerson.activity.start)}<mark>{draft.slice(previewPerson.activity.start,previewPerson.activity.end)}</mark><i className="team-inline-caret" style={{borderColor:previewPerson.colour}}/>{draft.slice(previewPerson.activity.end)}</>:draft}</pre>{previewPerson.activity.end>draft.length&&<small>The caret is beyond this preview.</small>}<small>The shared text keeps its last committed version. Carets align there once the edit is shared.{draft.length===2000?' Preview limited to 2,000 characters.':''}</small></>:<p>{previewPerson.activity?'Selecting content in '+WORKSPACE_NAMES[previewPerson.activity.workspace]+'.':'Away from the project view.'}</p>}</section>}
      <TeamComments c={c} doc={doc} workspace={context.workspace} panelTop={geometry.panelTop} open={open} setOpen={setOpen} selected={selected} setSelected={setSelected} draftAnchor={draftAnchor} setDraftAnchor={setDraftAnchor} onNavigate={jump}/>
    </div>,document.body)}
  </>;
}
