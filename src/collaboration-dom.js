import { cleanActivity, textFingerprint } from './collaboration-activity.js';

const element = node => node?.nodeType === 1 ? node : node?.parentElement;
export const fieldText = field => /^(INPUT|TEXTAREA)$/.test(field.tagName) ? field.value : field.textContent || '';
export function elementActivity(target, fallback) {
  const root = element(target)?.closest('[data-collab-kind]');
  if (!root) return null;
  const surface = root.closest('[data-collab-workspace]'); if (!surface) return null;
  const field = element(target)?.closest('[data-collab-field]');
  const ownAsset = root.closest('[data-collab-asset]');
  const ownTrack = root.closest('[data-collab-track]');
  const card = root.closest('[data-card-id]');
  const result = { workspace: surface.dataset.collabWorkspace, kind: root.dataset.collabKind, id: root.dataset.collabId,
    assetKey: ownAsset?.dataset.collabAsset || '', track: ownTrack?.dataset.collabTrack || undefined,
    rowId: root.closest('[data-story-row]')?.dataset.storyRow, cardId: card?.dataset.cardId,
    field: field?.dataset.collabField, editing: !!field && (field.isContentEditable || /^(INPUT|TEXTAREA)$/.test(field.tagName)),
    timeStart: Number(root.dataset.collabStart || fallback.timeStart || 0), playhead:fallback.playhead };
  for (const [key, data] of [['wordStart','collabWordStart'],['wordEnd','collabWordEnd'],['timeEnd','collabEnd']])
    if (root.dataset[data] != null) result[key] = Number(root.dataset[data]);
  return result;
}

export function captureActivity(fallback, clicked) {
  const active = document.activeElement;
  if (active?.closest('.team-comments, .team-draft-preview, .collab-panel')) return null;
  const selection = window.getSelection();
  let field, activity;
  if (/^(INPUT|TEXTAREA)$/.test(active?.tagName) && active.closest('.surface [data-collab-kind]')) {
    field = active; activity = elementActivity(active, fallback);
  } else if (selection?.rangeCount && element(selection.anchorNode)?.closest('.surface')) {
    field = element(selection.anchorNode)?.closest('[data-collab-field]'); activity = elementActivity(field || selection.anchorNode, fallback);
  }
  if (clicked?.closest?.('.surface')) {
    const hit = elementActivity(clicked, fallback);
    if (hit && (!activity || hit.id !== activity.id || hit.kind !== activity.kind)) { activity = hit; field = clicked.closest('[data-collab-field]'); }
  }
  if (!activity) return cleanActivity(fallback);
  if(fallback.kind===activity.kind&&fallback.selectionIds?.includes(activity.id))activity.selectionIds=fallback.selectionIds;
  if(activity.kind==='transcript'&&field&&!field.isContentEditable&&selection?.isCollapsed&&fallback.wordStart!=null&&fallback.assetKey===activity.assetKey)return cleanActivity(fallback);
  if(activity.kind==='clip'){
    const picked=[...document.querySelectorAll('.surface [data-collab-kind="clip"][data-collab-selected="true"]')].map(node=>node.dataset.collabId);
    if(picked.length)activity.selectionIds=picked.slice(0,100);
  }
  if (field && (field === active || selection?.rangeCount)) {
    const text = fieldText(field); let start, end;
    if (/^(INPUT|TEXTAREA)$/.test(field.tagName)) { start = field.selectionStart; end = field.selectionEnd; }
    else if (selection?.rangeCount) {
      const range = selection.getRangeAt(0);
      if (field.contains(range.startContainer) && field.contains(range.endContainer)) {
        const prefix = document.createRange(); prefix.selectNodeContents(field); prefix.setEnd(range.startContainer, range.startOffset);
        start = prefix.toString().length; end = start + range.toString().length;
      } else {
        const roots = [...document.querySelectorAll('.surface [data-collab-kind]')].filter(node => {
          try { return node.dataset.collabKind === activity.kind && range.intersectsNode(node); } catch { return false; }
        });
        activity.selectionIds = roots.map(node => node.dataset.collabId).slice(0,100);
      }
    }
    if (start != null && end != null) Object.assign(activity, { start, end, textHash: textFingerprint(text),
      quote: text.slice(start, Math.min(end, start + 600)), draft: activity.editing ? text.slice(0,2000) : undefined });
  }
  return cleanActivity(activity);
}

export function findActivityElements(activity) {
  if (!activity || activity.kind === 'view' || activity.kind === 'range') return [];
  const ids = new Set([activity.id, ...(activity.selectionIds || [])]);
  return [...document.querySelectorAll('.surface [data-collab-kind]')].filter(node => {
    if (node.dataset.collabKind !== activity.kind || !ids.has(node.dataset.collabId)) return false;
    if(activity.workspace==='story'&&activity.cardId&&node.closest('[data-card-id]')?.dataset.cardId!==activity.cardId)return false;
    const asset = node.closest('[data-collab-asset]')?.dataset.collabAsset || '';
    const track = node.closest('[data-collab-track]')?.dataset.collabTrack;
    return (['multi','card'].includes(activity.kind) || activity.assetKey == null || asset === activity.assetKey) && (activity.kind==='multi'||!activity.track || track === activity.track);
  });
}
export function findField(root, activity) {
  const selector = `[data-collab-field="${CSS.escape(activity.field || 'text')}"]`;
  return root.matches(selector) ? root : root.querySelector(selector);
}
export function clippedRect(node) {
  const rect = node.getBoundingClientRect(); let left = Math.max(0,rect.left), top = Math.max(0,rect.top), right = Math.min(innerWidth,rect.right), bottom = Math.min(innerHeight,rect.bottom);
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, box.left); right = Math.min(right,box.right); }
    if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top,box.top); bottom = Math.min(bottom,box.bottom); }
  }
  return right > left && bottom > top ? { left, top, right, bottom, width: right-left, height: bottom-top } : null;
}
export function textRange(field, start, end) {
  const walker = document.createTreeWalker(field, NodeFilter.SHOW_TEXT); const nodes = []; let node, length = 0;
  while ((node = walker.nextNode())) { nodes.push({ node, start: length, end: length + node.length }); length += node.length; }
  if (start > length || end > length || start < 0 || end < start || !nodes.length) return null;
  const a = nodes.find(n => n.end >= start), b = nodes.find(n => n.end >= end);
  const range = document.createRange(); range.setStart(a.node, start - a.start); range.setEnd(b.node, end - b.start); return range;
}
export function selectionRects(field, start, end) {
  if(!fieldText(field)&&start===0&&end===0){
    const box=field.getBoundingClientRect(),style=getComputedStyle(field),scale=box.width/Math.max(1,field.offsetWidth);
    return {rects:[],caret:{left:box.left+(parseFloat(style.paddingLeft)||0)*scale,top:box.top+(parseFloat(style.paddingTop)||0)*scale,height:(parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.2)*scale}};
  }
  let mirror;
  if (/^(INPUT|TEXTAREA)$/.test(field.tagName)) {
    const box = field.getBoundingClientRect(), style = getComputedStyle(field);
    mirror = document.createElement('div');
    Object.assign(mirror.style, { position:'fixed',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px',visibility:'hidden',overflow:'hidden',whiteSpace:field.tagName==='INPUT'?'pre':'pre-wrap',overflowWrap:'break-word' });
    const scale=box.width/Math.max(1,field.offsetWidth);
    for (const key of ['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','wordSpacing','lineHeight','padding','border','boxSizing','textIndent','textAlign','direction','textTransform','tabSize']) mirror.style[key] = style[key].replace(/(-?[\d.]+)px/g,(_,n)=>(Number(n)*scale)+'px');
    mirror.textContent = field.value || ' '; document.body.append(mirror); mirror.scrollTop = field.scrollTop*scale; mirror.scrollLeft = field.scrollLeft*scale;
  }
  const root = mirror || field, range = textRange(root,start,end); if (!range) { mirror?.remove(); return null; }
  const rects = [...range.getClientRects()].map(r => ({left:r.left,top:r.top,width:r.width,height:r.height}));
  const caret = textRange(root,end,end); let box = caret?.getClientRects()[0];
  if ((!box || !box.height) && end > 0) {
    const previous = textRange(root,end-1,end)?.getClientRects(); const last = previous?.[previous.length-1];
    if (last) box = {left:last.right,top:last.top,width:0,height:last.height};
  }
  const result = { rects, caret: box?.height ? { left:box.left,top:box.top,height:box.height } : null };
  mirror?.remove(); return result;
}
export function clipBox(rect, clip) {
  const left = Math.max(rect.left,clip.left), top = Math.max(rect.top,clip.top), right = Math.min(rect.left+rect.width,clip.right), bottom = Math.min(rect.top+rect.height,clip.bottom);
  return right > left && bottom > top ? {left,top,width:right-left,height:bottom-top} : null;
}
export function timelinePosition(activity) {
  const lane = document.querySelector(`[data-collab-lane="${activity.workspace === 'multi' ? 'sequence' : 'source'}"]`);
  if (!lane || activity.timeStart == null) return null;
  const clip = clippedRect(lane); if (!clip) return null;
  const rect = lane.getBoundingClientRect(), scale = rect.width / lane.offsetWidth, pps = Number(lane.dataset.collabPps) * scale;
  const left = rect.left + activity.timeStart * pps;
  const end = activity.timeEnd == null ? left : rect.left + activity.timeEnd * pps;
  return { left, end, cursor:rect.left+(activity.playhead??activity.timeStart)*pps, clip, top:clip.top,height:clip.height };
}
