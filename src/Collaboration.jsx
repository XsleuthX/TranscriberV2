import React, { useEffect, useRef, useState } from 'react';
import './collaboration.css';

export default function Collaboration({ collaboration: c, media, fileFor, onUploaded, onBackup }) {
  const [open, setOpen] = useState(false), [message, setMessage] = useState('');
  const panel = useRef(null), trigger = useRef(null);
  useEffect(() => { if (open) panel.current?.querySelector('button')?.focus(); }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const copy = async value => { try { await navigator.clipboard.writeText(value); setMessage('Link copied.'); } catch { setMessage('Select and copy the link below.'); } };
  const link = (label, value) => value && <label className="collab-link">{label}<span><input aria-label={label} value={value} readOnly onFocus={e => e.target.select()} /><button onClick={() => copy(value)}>Copy</button></span></label>;
  return <>
    <button ref={trigger} className="btn sm" onClick={() => setOpen(true)} aria-label="Collaboration and sharing">{c.target ? `${c.people.length || 1} online · ${c.role || 'connecting'}` : 'Share project'}</button>
    {c.target && <span className="collab-status" role="status">{c.status}</span>}
    {(c.error || c.conflict) && !open && <button className="btn sm collab-alert" onClick={() => setOpen(true)}>Review sync issue</button>}
    {open && <div className="collab-shade" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <section ref={panel} className="collab-panel" role="dialog" aria-modal="true" aria-label="Project collaboration" onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
        if (event.key === 'Tab') {
          const controls = [...panel.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <header><h2>Project collaboration</h2><button onClick={close} aria-label="Close collaboration">×</button></header>
        <p>{c.target ? c.status : 'Create a shared copy of this project. Teammates use your workspace sign-in and a project link.'}</p>
        <label>Your display name<input aria-label="Your display name" maxLength={60} value={c.name} onChange={e => c.setName(e.target.value)} /></label>
        <small>Display names identify active browsers; they are not verified user accounts.</small>
        {c.error && <p className="collab-alert" role="alert">{c.error}</p>}
        {!c.target ? <><p>Transcript, subtitles, Story, timelines, review decisions and team rules will be shared. Upload source media after creating the shared copy.</p><button className="collab-primary" disabled={c.busy || !c.canCreate} onClick={c.create}>{c.busy ? 'Creating…' : 'Create shared project'}</button></> : <>
          <ul className="collab-people">{c.people.map(p => <li key={p.clientId}><span className="collab-dot" />{p.name}<small>{p.role}</small></li>)}</ul>
          {c.role === 'editor' && <>
            {link('Editor link', c.editorLink)}
            <button disabled={c.busy} onClick={c.newViewerLink}>Create / replace viewer link</button>
            <small>Replacing the viewer link revokes the previous viewer link. Editor links allow editing and sharing.</small>
            {link('Viewer link', c.viewerLink)}
            <h3>Shared media</h3>
            <p>Upload footage so everyone can preview it. Otherwise each teammate relinks their own copy or reconnects Iconik.</p>
            {Object.entries(media).map(([id, asset]) => <div className="collab-media" key={id}><span>{asset.name}<small>{asset.sharedFile ? 'Available to teammates' : 'Local / reconnect required'}</small></span><label className="collab-upload">{c.busy ? 'Working…' : 'Upload media'}<input aria-label={'Upload shared media for ' + asset.name} type="file" accept="video/mp4,video/webm,video/quicktime,audio/*" disabled={c.busy || !c.ready} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) c.upload(file, id, onUploaded); }} /></label>{fileFor(id) && <button disabled={c.busy} onClick={() => c.upload(fileFor(id), id, onUploaded)}>Share linked file</button>}</div>)}
          </>}
          {c.role === 'viewer' && <p>You have view-only access. Playback, navigation and exports are available. Ask an editor for an editor link to change the project.</p>}
          {c.conflict && <div className="collab-conflict" role="alert"><h3>Two people changed the same content</h3><p>Sync is paused. Nonconflicting edits from both people are retained. Choose which version to use for these conflicts:</p><ul>{c.conflict.paths.slice(0, 12).map(path => <li key={path}>{path}</li>)}</ul><button onClick={onBackup}>Download my project backup</button><div><button onClick={() => c.resolve('remote')}>Use shared versions</button><button onClick={() => c.resolve('local')}>Use my versions</button></div></div>}
          <p><small>Updates arrive about every 1.5 seconds after leaving a text editor. Incoming changes reset Undo history to protect teammates’ edits. Keep this tab open until changes are shared.</small></p>
          <button onClick={c.local}>Return to my local project</button>
        </>}
        {message && <p role="status">{message}</p>}
      </section>
    </div>}
  </>;
}
