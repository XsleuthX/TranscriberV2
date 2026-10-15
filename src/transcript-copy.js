import { timedText } from './text-replace.js';

// Copy from the document, never from a virtualized viewport.
export function transcriptText(words, range = null) {
  if (!words.length) return '';
  const a = range ? Math.max(0, Math.min(range.a, range.b)) : 0;
  const b = range ? Math.min(words.length - 1, Math.max(range.a, range.b)) : words.length - 1;
  const parts=[]; let previous='';
  for(let i=a;i<=b;i++) {
    const current=String(words[i].t??'');
    if(!current)continue;
    if(previous)parts.push(timedText([{t:previous.slice(-2)},{t:current.slice(0,2)}]).text.length>previous.slice(-2).length+current.slice(0,2).length?' ':'');
    parts.push(current);previous=current;
  }
  return parts.join('');
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const previous = document.activeElement, field = document.createElement('textarea');
  field.value = text; field.style.cssText = 'position:fixed;left:-10000px;top:0';
  document.body.append(field); field.select();
  try { if (!document.execCommand('copy')) throw new Error('Clipboard unavailable. Use Download transcript TXT.'); }
  finally { field.remove(); previous?.focus?.({preventScroll:true}); }
}
