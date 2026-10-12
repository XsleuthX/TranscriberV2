import React, { useState } from 'react';

export async function iconikRequest(route, body) {
  const response = await fetch(`/api/iconik/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({ error: 'Iconik server unavailable. Start the app with npm run dev or npm run preview.' }));
  if (!response.ok || data.error) throw new Error(data.error?.message || data.error || 'Iconik request failed.');
  return data;
}
export async function iconikSamples(asset, progress) {
  progress?.('Preparing Iconik audio', 10);
  const response = await fetch(asset.iconik.audioUrl);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || data.error || 'Iconik audio extraction failed.');
  }
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength || buffer.byteLength % 4) throw new Error('Incomplete audio received. Reconnect and retry.');
  progress?.('Audio ready · 16 kHz mono', 30);
  return new Float32Array(buffer);
}
export default function IconikImport({ onImport }) {
  const [link, setLink] = useState('');
  const [appId, setAppId] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  return <form style={{ display: 'grid', gap: 12, textAlign: 'left', width: '100%', maxWidth: 560 }} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setStatus('Connecting to Iconik…');
    try {
      await iconikRequest('connect', { appId, token });
      setToken('');
      const asset = await iconikRequest('resolve', { link });
      await onImport(asset);
      setStatus(`Imported ${asset.name}. Playback is ready; audio extraction runs in the background.`);
    } catch (error) { setStatus(error.message); }
    finally { setBusy(false); }
  }}>
    <label>Asset link<input aria-label="Iconik asset link" style={{ width: '100%' }} required value={link}
      onChange={e => setLink(e.target.value)} placeholder="https://app.iconik.io/asset/…" /></label>
    <label>Application ID (optional for bearer tokens)<input aria-label="Iconik application ID" style={{ width: '100%' }} value={appId}
      onChange={e => setAppId(e.target.value)} autoComplete="off" /></label>
    <label>API token<input aria-label="Iconik API token" style={{ width: '100%' }} type="password" value={token}
      onChange={e => setToken(e.target.value)} autoComplete="off" placeholder="Leave blank to reuse the server connection" /></label>
    <p style={{ margin: 0 }}>Use an Iconik API token with permission to read the asset and its proxies. Credentials stay in server memory for this session. You can also configure them on the app server.</p>
    <button className="btn pri" disabled={busy}>{busy ? 'Connecting…' : 'Import / reconnect asset'}</button>
    <div role="status" style={{ whiteSpace: 'pre-wrap' }}>{status}</div>
  </form>;
}
