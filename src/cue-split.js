export function splitCueText(cue, text, caret, start, end, playhead, words, id, fps = 25) {
  caret = Math.max(0, Math.min(text.length, caret));
  const left = text.slice(0, caret), right = text.slice(caret);
  if (!left.trim() || !right.trim() || end - start < 2 / fps) return null;
  const ratio = Math.max(.08, Math.min(.92, caret / text.length));
  let at = playhead > start && playhead < end ? playhead : start + (end - start) * ratio;
  at = Math.max(start + 1 / fps, Math.min(end - 1 / fps, Math.round(at * fps) / fps));
  let we = cue.we, ws = cue.ws;
  if (cue.ws != null && cue.we > cue.ws) {
    we = cue.ws;
    for (let i = cue.ws; i < cue.we; i++) if (words[i]?.e <= at) we = i;
    ws = Math.min(we + 1, cue.we);
  }
  return [{ ...cue, we, textOverride: left, startOverride: start, endOverride: at },
    { id, ws, we: cue.we, textOverride: right, startOverride: at, endOverride: end }];
}
export function caretText(element, range = window.getSelection()?.rangeCount ? window.getSelection().getRangeAt(0) : null) {
  let text = '', caret = null;
  const contains = range && element.contains(range.startContainer);
  const visit = node => {
    if (node.nodeType === 3) {
      if (contains && node === range.startContainer) caret = text.length + range.startOffset;
      text += node.textContent.replace(/\u00a0/g, ' '); return;
    }
    if (node.nodeName === 'BR') { text += '\n'; return; }
    const block = node !== element && /^(DIV|P|LI)$/.test(node.nodeName);
    if (block && text && !text.endsWith('\n')) text += '\n';
    [...node.childNodes].forEach((child, index) => {
      if (contains && node === range.startContainer && range.startOffset === index) caret = text.length;
      visit(child);
    });
    if (contains && node === range.startContainer && range.startOffset === node.childNodes.length) caret = text.length;
    if (block && node.nextSibling && !text.endsWith('\n')) text += '\n';
  };
  visit(element);
  return { text, caret: caret ?? text.length };
}
