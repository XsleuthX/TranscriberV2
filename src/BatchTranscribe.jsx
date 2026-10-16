import React from 'react';
export default function BatchTranscribe({media,selected,onSelected,replace,onReplace,onStart,onCancel,busy,items,available,disabled}) {
  const eligible=Object.keys(media).filter(k=>available(k)&&(replace||!(media[k].cues?.length||media[k].words?.length)));
  return <section className="fld" aria-label="Batch transcription"><details><summary>Batch transcribe media</summary>
    <p>Queue selected sources using the engine, model, language and dictionary above. One source runs at a time; each API request is billed by your provider. Keep this tab open.</p>
    <label><input type="checkbox" aria-label="Replace existing transcripts in batch" disabled={busy} checked={replace} onChange={e=>onReplace(e.target.checked)}/>Include and replace existing transcripts</label>
    <div style={{display:'flex',gap:6,margin:'8px 0'}}><button className="btn sm" disabled={busy} onClick={()=>onSelected(new Set(eligible))}>Select eligible media</button><button className="btn sm" disabled={busy} onClick={()=>onSelected(new Set())}>Clear selection</button></div>
    <div style={{maxHeight:220,overflow:'auto'}}>{Object.entries(media).map(([key,m])=><label key={key} style={{display:'block',margin:'6px 0'}}><input type="checkbox" aria-label={'Batch source '+m.name} disabled={busy||!eligible.includes(key)} checked={selected.has(key)&&eligible.includes(key)} onChange={e=>onSelected(new Set(e.target.checked?[...selected,key]:[...selected].filter(k=>k!==key)))}/>{m.name}{!available(key)?' · relink required':m.cues?.length||m.words?.length?' · existing transcript':''}</label>)}</div>
    <button className="btn pri" disabled={disabled||busy||!eligible.some(k=>selected.has(k))} onClick={()=>onStart(eligible.filter(k=>selected.has(k)))}>Start batch transcription</button>
    {busy&&<button className="btn" onClick={onCancel}>Cancel batch transcription</button>}
  </details>{items.length>0&&<><p>{items.filter(i=>i.state==='completed').length} completed · {items.filter(i=>i.state==='failed').length} failed · {items.filter(i=>['pending','running'].includes(i.state)).length} remaining</p><div aria-label="Batch transcription results" role="status" style={{maxHeight:220,overflow:'auto',fontSize:11}}>{items.map(i=><p key={i.key}>{media[i.key]?.name||i.key}: {i.state}{i.error?' — '+i.error:''}</p>)}</div></>}</section>;
}
