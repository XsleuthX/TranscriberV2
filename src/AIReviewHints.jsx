import React, { createContext, useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
export const AIReviewContext = createContext({ flags: [], activeAsset: '', editTrack: 'A' });
export function ReviewHint({ kind, id, track, assetKey, wordStart, wordEnd, startTime, endTime }) {
  const review = useContext(AIReviewContext), [open, setOpen] = useState(false);
  const button = useRef(null);
  const bounds = button.current?.getBoundingClientRect();
  const flags = review.flags.filter(flag => {
    if (kind !== 'multi' && flag.assetKey && flag.assetKey !== (assetKey ?? review.activeAsset)) return false;
    if (kind === 'transcript') return flag.track !== 'B' && (flag.kind === 'word' ? +flag.id >= wordStart && +flag.id <= wordEnd : flag.kind === 'cue' && (flag.ws != null ? flag.we >= wordStart && flag.ws <= wordEnd : flag.end > startTime && flag.start < endTime));
    return flag.kind === kind && flag.id === id && (kind === 'card' || !flag.track || flag.track === (track ?? review.editTrack));
  });
  if (!flags.length) return null;
  const label=flags.every(f=>f.origin==='vet')?'Vet':flags.some(f=>f.origin==='vet')?'Review':'AI';
  return <span className="ai-hint" onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <button ref={button} type="button" className="ai-flag" aria-label={`${label} flags: ${flags.length}`} aria-expanded={open}
      onClick={() => setOpen(true)} onMouseEnter={() => setOpen(true)} onFocus={() => setOpen(true)} onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}>{label} {flags.length}</button>
    {open && createPortal(<span role="dialog" aria-label={label==='AI'?'AI review hint':'Vet review hint'} className="ai-popover" onClick={e => e.stopPropagation()}
      style={{ position: 'fixed', zIndex: 10000, left: Math.max(8, Math.min(window.innerWidth - 338, bounds?.left || 8)), top: Math.max(8, Math.min(window.innerHeight - 260, (bounds?.bottom || 8) + 5)) }}>
      <button className="btn sm" onClick={() => setOpen(false)}>Close hint</button>
      {flags.map(f => <span className="ai-explanation" key={f.reviewId}><b>{f.stale ? 'Content changed — review again' : f.presetLabel}</b><span>{f.reason}</span>
        {f.suggestion != null && <span>Suggestion: {f.suggestion || '(remove text)'}</span>}
        <button className="btn sm" onClick={() => review.reveal(f)}>Open in editor</button>
        {f.suggestion != null && <button className="btn sm" disabled={f.stale} onClick={() => review.apply(f)}>Apply suggestion</button>}
        <button className="btn sm" onClick={() => review.dismiss(f)}>Dismiss flag</button>
      </span>)}
    </span>, document.body)}
  </span>;
}
