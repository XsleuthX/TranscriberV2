import React, { useLayoutEffect, useRef } from 'react';

// The browser owns descendants while contentEditable is active. React must not
// reconcile the cue spans that native selection/delete/paste can remove.
export default function StoryBodyEditor({ lines, text, onCommit, onPreview, onSelect }) {
  const element = useRef(null), dirty = useRef(false), focused = useRef(false);
  const removed = useRef(new Set()), baseline = useRef([]);
  const model = JSON.stringify(lines ?? text ?? '');
  const render = () => {
    const el = element.current; if (!el) return;
    if (lines) {
      el.replaceChildren(...lines.map(line => {
        const span = document.createElement('span'); span.dataset.storyCue = line.id;
        span.style.display = 'block'; span.title = 'Click to preview this cue'; span.textContent = line.text;
        return span;
      }));
    } else el.textContent = text || '';
  };
  useLayoutEffect(() => { if (!focused.current || !dirty.current) render(); }, [model]);
  useLayoutEffect(() => {
    const el = element.current;
    const before = event => {
      if (/^history/.test(event.inputType)) { removed.current.clear(); return; }
      if (!/^delete/.test(event.inputType)) return;
      const target = event.getTargetRanges?.()[0];
      const selected = window.getSelection();
      let range = selected?.rangeCount ? selected.getRangeAt(0) : null;
      // Chromium can expand the native target range across a line boundary.
      // Prefer the user's noncollapsed selection when identifying deleted cues.
      if (target && (!range || range.collapsed)) { range = document.createRange(); range.setStart(target.startContainer, target.startOffset); range.setEnd(target.endContainer, target.endOffset); }
      if (!range || range.collapsed) return;
      for (const span of el.querySelectorAll('[data-story-cue]')) {
        const contents = document.createRange(); contents.selectNodeContents(span);
        if (range.compareBoundaryPoints(Range.START_TO_START, contents) <= 0 && range.compareBoundaryPoints(Range.END_TO_END, contents) >= 0) removed.current.add(span.dataset.storyCue);
      }
    };
    el.addEventListener('beforeinput', before);
    return () => el.removeEventListener('beforeinput', before);
  }, []);
  return <div ref={element} className="dbody" contentEditable suppressContentEditableWarning
    data-ph="Transcript, VO, graphics or B-roll instruction"
    onClick={event => {
      event.stopPropagation(); onSelect();
      const span = event.target.closest('[data-story-cue]');
      if (span) onPreview(span.dataset.storyCue);
    }}
    onFocus={event => { focused.current = true; dirty.current = false; removed.current.clear(); baseline.current = lines || []; event.currentTarget.dataset.beforeEdit = event.currentTarget.innerText; }}
    onInput={() => { dirty.current = true; }}
    onBlur={event => {
      focused.current = false;
      const el = event.currentTarget, value = el.innerText;
      const changed = dirty.current && value !== el.dataset.beforeEdit;
      let remaining = [...el.querySelectorAll('[data-story-cue]')].map(span => ({ id: span.dataset.storyCue, text: span.innerText })).filter(line => line.text.trim());
      const survivors = baseline.current.filter(line => !removed.current.has(line.id));
      if (removed.current.size && remaining.length === survivors.length) remaining = remaining.map((line, index) => ({ ...line, id: survivors[index].id }));
      dirty.current = false;
      if (changed) onCommit(value, remaining);
      // Restore presentation even when a formatting-only edit is a no-op.
      render();
    }}
    onKeyDown={event => { if (event.key === 'Escape') { dirty.current = false; render(); event.currentTarget.blur(); } }} />;
}
