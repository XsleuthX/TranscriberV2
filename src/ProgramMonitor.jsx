import React, { useEffect, useRef, useState } from 'react';
import { programClips, sourceTime } from './timeline.js';

function Layer({ clip, url, time, playing, rate, volume, muted, audio, register, onError, onMetadata }) {
  const ref = useRef(null);
  const latest = useRef();
  latest.current = { time, playing, rate, volume, muted };
  const sync = () => {
    const el = ref.current, state = latest.current;
    if (!el) return;
    el.muted = !audio || state.muted;
    el.volume = Math.max(0, Math.min(1, state.volume * (clip.gain ?? 1)));
    el.playbackRate = state.rate;
    const target = Math.max(0, sourceTime(clip, state.time));
    if (el.readyState && Math.abs(el.currentTime - target) > (state.playing ? 0.15 : 0.005)) el.currentTime = target;
    if (state.playing && el.paused && el.readyState >= 2) {
      el.play().catch(error => { if (error.name !== 'AbortError') onError('Playback was blocked. Press Play again or reconnect the source.'); });
    } else if (!state.playing && !el.paused) el.pause();
  };
  useEffect(sync, [time, playing, rate, volume, muted, clip.sin, clip.pin]);
  useEffect(() => { register(clip.id, ref.current); return () => { register(clip.id, null); }; }, [clip.id]);
  const Tag = audio ? 'audio' : 'video';
  return <Tag ref={el => { ref.current = el; register(clip.id, el); }} src={url} preload="auto" playsInline
    onLoadedMetadata={e => { onMetadata(clip.assetKey, e.currentTarget.duration); sync(); }} onCanPlay={sync}
    onError={() => onError('Source unavailable or unsupported. Reconnect Iconik or relink the local file in Media Pool.')}
    style={audio ? { display: 'none' } : { position: 'absolute', inset: 0, width: '100%', height: '100%',
      objectFit: 'contain', background: '#000', opacity: clip.opacity ?? 1,
      transform: `translate(${clip.x || 0}%, ${clip.y || 0}%) scale(${clip.scale ?? 1})` }} />;
}

export default function ProgramMonitor({ doc, media, time, playing, rate, volume, muted, cc, duration, onTime, onStop, onMetadata }) {
  const elements = useRef(new Map());
  const latest = useRef();
  const [error, setError] = useState('');
  const [buffering, setBuffering] = useState(false);
  const active = programClips(doc, time);
  latest.current = { doc, media, time, rate, duration, onTime, onStop };
  const register = (id, el) => el ? elements.current.set(id, el) : elements.current.delete(id);
  const fail = message => { setError(message); onStop(); };
  useEffect(() => { if (playing) setError(''); }, [playing]);
  useEffect(() => {
    if (!playing) { setBuffering(false); return; }
    let raf, last = performance.now();
    const tick = now => {
      const s = latest.current;
      const visible = programClips(s.doc, s.time);
      const layers = [...visible.video, ...visible.audio];
      const missing = layers.some(c => !s.media[c.assetKey]?.url);
      if (missing) { fail('Timeline source is offline. Relink it or reconnect Iconik in Media Pool.'); return; }
      const waiting = layers.some(c => {
        const el = elements.current.get(c.id);
        return !el || el.readyState < 2 || el.seeking;
      });
      setBuffering(waiting);
      if (!waiting) {
        const next = Math.min(s.duration, s.time + Math.min((now - last) / 1000, 0.1) * s.rate);
        s.onTime(next);
        if (next >= s.duration) { s.onStop(); return; }
      } else {
        // Hold all sources at the project frame while any layer buffers.
        for (const el of elements.current.values()) if (!el.paused) el.pause();
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  const captions = active.text.filter(c => c.kind === 'subtitle').map(c => c.text || c.title).join('\n');
  return <div className="vstage" aria-label="Program monitor" style={{ background: '#000', overflow: 'hidden' }}>
    {active.video.map(c => media[c.assetKey]?.url && <Layer key={c.id} clip={c} url={media[c.assetKey].url}
      {...{ time, playing, rate, volume, muted, register, onMetadata }} onError={fail} />)}
    {active.audio.map(c => media[c.assetKey]?.url && <Layer key={c.id} audio clip={c} url={media[c.assetKey].url}
      {...{ time, playing, rate, volume, muted, register, onMetadata }} onError={fail} />)}
    {active.text.filter(c => c.kind === 'overlay').map(c => <div key={c.id}
      style={{ position: 'absolute', inset: '35% 8% auto', textAlign: 'center', color: 'white', fontSize: 24,
        whiteSpace: 'pre-wrap', textShadow: '0 2px 4px black' }}>{c.text || c.title}</div>)}
    {cc && captions && <div className="vcc"><span style={{ whiteSpace: 'pre-wrap' }}>{captions}</span></div>}
    {(error || buffering) && <div role="status" style={{ position: 'absolute', top: 8, left: 8, right: 8,
      color: 'white', background: '#181818dd', padding: 8, fontSize: 12 }}>{error || 'Buffering sources…'}</div>}
  </div>;
}
