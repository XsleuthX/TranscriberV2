// Timeline positions are seconds; media plays at its original speed.
export const FRAME = 1 / 25;
export const activeAt = (clip, time) => time >= clip.pin && time < clip.pout;
export const sourceTime = (clip, time) => (clip.sin || 0) + time - clip.pin;
export function resolveTimeline(doc, rows) {
  const cards = new Map(rows.flatMap(r => r.cards).map(c => [c.id, c]));
  return { ...doc, clips: doc.clips.map(c => ({ ...c,
    assetKey: c.assetKey || cards.get(c.storyCardId)?.assetKey || null,
  })) };
}
export function expandedSelection(doc, ids) {
  const groups = new Set(doc.clips.filter(c => ids.has(c.id) && c.groupId).map(c => c.groupId));
  return new Set(doc.clips.filter(c => ids.has(c.id) || groups.has(c.groupId)).map(c => c.id));
}
export function lockedSelection(doc, ids) {
  return doc.clips.some(c => ids.has(c.id) && doc.tracks.find(t => t.id === c.trackId)?.locked);
}
export function hasCollisions(clips, changed) {
  return clips.some((c, i) => clips.slice(i + 1).some(x =>
    (changed.has(c.id) || changed.has(x.id)) && c.trackId === x.trackId &&
    c.pin < x.pout - 0.00001 && x.pin < c.pout - 0.00001));
}
export function moveClips(doc, ids, delta, trackId, primaryId) {
  ids = expandedSelection(doc, ids);
  if (lockedSelection(doc, ids)) return doc;
  const moving = doc.clips.filter(c => ids.has(c.id));
  if (!moving.length) return doc;
  delta = Math.max(delta, -Math.min(...moving.map(c => c.pin)));
  const primary = moving.find(c => c.id === primaryId) || moving[0];
  const target = doc.tracks.find(t => t.id === trackId);
  if (target && (target.locked || target.kind !== primary.kind)) return doc;
  const clips = doc.clips.map(c => !ids.has(c.id) ? c : { ...c,
    pin: c.pin + delta, pout: c.pout + delta,
    trackId: target && c.trackId === primary.trackId ? target.id : c.trackId,
  });
  return hasCollisions(clips, ids) ? doc : { ...doc, clips };
}
export function trimClips(doc, id, edge, delta, media = {}) {
  const ids = expandedSelection(doc, new Set([id]));
  if (lockedSelection(doc, ids)) return doc;
  const primary = doc.clips.find(c => c.id === id);
  if (!primary) return doc;
  const isMedia = c => c.kind === 'video' || c.kind === 'audio';
  const siblings = doc.clips.filter(c => ids.has(c.id) &&
    (isMedia(primary) ? isMedia(c) : c.id === id));
  let low = -Infinity, high = Infinity;
  for (const c of siblings) {
    if (edge === 'l') {
      low = Math.max(low, -c.pin, -(c.sin || 0));
      high = Math.min(high, c.pout - c.pin - FRAME);
    } else {
      low = Math.max(low, FRAME - (c.pout - c.pin));
      // Until metadata is available, never extend past the known source out.
      high = Math.min(high, (media[c.assetKey]?.duration ?? c.sout) - c.sout);
    }
  }
  delta = Math.max(low, Math.min(high, delta));
  const pin = edge === 'l' ? primary.pin + delta : primary.pin;
  const pout = edge === 'r' ? primary.pout + delta : primary.pout;
  const clips = doc.clips.flatMap(c => {
    if (!ids.has(c.id)) return [c];
    if (siblings.some(s => s.id === c.id)) return [{ ...c,
      ...(edge === 'l' ? { pin: c.pin + delta, sin: (c.sin || 0) + delta }
        : { pout: c.pout + delta, sout: c.sout + delta }),
    }];
    // Linked subtitle cues keep their rhythm and are cropped to the media edit.
    const left = Math.max(c.pin, pin), right = Math.min(c.pout, pout);
    return right <= left ? [] : [{ ...c, pin: left, pout: right,
      sin: sourceTime(c, left), sout: sourceTime(c, right) }];
  });
  return hasCollisions(clips, ids) ? doc : { ...doc, clips };
}
export function razorClips(doc, time, selected = new Set()) {
  const ids = selected.size ? expandedSelection(doc, selected) : new Set(doc.clips.map(c => c.id));
  const lockedGroups = new Set(doc.clips.filter(c => c.groupId &&
    doc.tracks.find(t => t.id === c.trackId)?.locked).map(c => c.groupId));
  const cutGroups = new Set(doc.clips.filter(c => ids.has(c.id) && c.groupId &&
    !lockedGroups.has(c.groupId) && time > c.pin + FRAME / 2 && time < c.pout - FRAME / 2).map(c => c.groupId));
  return { ...doc, clips: doc.clips.flatMap(c => {
    if (!ids.has(c.id) || lockedGroups.has(c.groupId) || doc.tracks.find(t => t.id === c.trackId)?.locked) return [c];
    const rightGroup = c.groupId ? `${c.groupId}_cut_${time}` : null;
    if (c.pin >= time) return cutGroups.has(c.groupId) ? [{ ...c, groupId: rightGroup }] : [c];
    if (time <= c.pin + FRAME / 2 || time >= c.pout - FRAME / 2) return [c];
    const mid = sourceTime(c, time);
    return [{ ...c, id: `${c.id}_L_${time}`, pout: time, sout: mid },
      { ...c, id: `${c.id}_R_${time}`, pin: time, sin: mid, groupId: rightGroup }];
  }) };
}
export function deleteClips(doc, selection, ripple = false) {
  const ids = expandedSelection(doc, selection);
  if (lockedSelection(doc, ids)) return doc;
  const gone = doc.clips.filter(c => ids.has(c.id));
  if (!gone.length) return doc;
  let clips = doc.clips.filter(c => !ids.has(c.id));
  if (ripple) {
    // Only close empty sequence intervals. Never cut through surviving footage,
    // shift locked material, double-count overlapping A/V, or desync linked tracks.
    const ranges = gone.map(c => [c.pin, c.pout]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const prev = merged.at(-1);
      if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1]);
      else merged.push([...r]);
    }
    const gaps = merged.filter(([a, b]) => !clips.some(c => c.pin < b && c.pout > a) &&
      !clips.some(c => c.pin >= b && doc.tracks.find(t => t.id === c.trackId)?.locked));
    clips = clips.map(c => {
      const shift = gaps.reduce((s, [a, b]) => s + (c.pin >= b ? b - a : 0), 0);
      return { ...c, pin: c.pin - shift, pout: c.pout - shift };
    });
  }
  return { ...doc, clips };
}
export function programClips(doc, time) {
  const solo = doc.tracks.some(t => t.kind === 'audio' && t.solo);
  const on = doc.clips.filter(c => activeAt(c, time));
  const videoTracks = doc.tracks.filter(t => t.kind === 'video' && t.visible !== false)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return {
    video: videoTracks.flatMap(t => on.filter(c => c.trackId === t.id)),
    audio: on.filter(c => c.kind === 'audio' && doc.tracks.some(t => t.id === c.trackId && !t.muted && (!solo || t.solo))),
    text: on.filter(c => ['subtitle', 'overlay'].includes(c.kind) &&
      doc.tracks.some(t => t.id === c.trackId && t.visible !== false)),
  };
}
