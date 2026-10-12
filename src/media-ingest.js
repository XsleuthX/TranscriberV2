// Read bounded slices. Chromium can reject a File's arrayBuffer while the
// FileReader path still succeeds; retry without loading an entire camera file.
export async function readSlice(blob, { reader = fileReader, delay = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const read of [b => b.arrayBuffer(), reader]) {
      try {
        const bytes = await read(blob);
        if (bytes.byteLength !== blob.size) throw new Error('Incomplete media read.');
        return bytes;
      } catch (error) { last = error; }
    }
    if (attempt < 2) await delay(150 * (attempt + 1));
  }
  throw new Error(`The browser could not read the selected media after retrying (${last?.name || 'read error'}). The file may still exist. Reselect it to renew browser access; also check that another program is not replacing or locking it.`);
}
function fileReader(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.onabort = () => reject(new Error('Media read cancelled.'));
    reader.readAsArrayBuffer(blob);
  });
}
export async function readMedia(file, progress) {
  const parts = [], size = 8 * 1024 * 1024;
  for (let offset = 0; offset < file.size; offset += size) {
    parts.push(await readSlice(file.slice(offset, offset + size)));
    progress?.('Reading media', 5 + 10 * Math.min(1, (offset + size) / file.size));
  }
  return new Blob(parts, { type: file.type }).arrayBuffer();
}
export async function serverSamples(file, progress) {
  const request = async (route, options) => {
    const response = await fetch('/api/media/' + route, options);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error?.message || data.error || `Audio extraction failed (HTTP ${response.status}).`);
    }
    return response;
  };
  const { id } = await (await request('start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: file.size }) })).json();
  try {
    const size = 8 * 1024 * 1024;
    for (let offset = 0; offset < file.size; offset += size) {
      const bytes = await readSlice(file.slice(offset, offset + size));
      await request(`chunk?id=${id}&offset=${offset}`, { method: 'POST', body: bytes });
      progress?.('Preparing audio', 5 + 20 * Math.min(1, (offset + size) / file.size));
    }
    await request('finish?id=' + id, { method: 'POST' });
    const until = Date.now() + 30 * 60 * 1000;
    while (Date.now() < until) {
      const status = await (await request('status?id=' + id)).json();
      if (status.state === 'failed') throw new Error(status.error);
      if (status.state === 'ready') {
        const bytes = await (await request('audio?id=' + id)).arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength % 4) throw new Error('Extracted audio was incomplete.');
        return new Float32Array(bytes);
      }
      progress?.(status.state === 'queued' ? 'Waiting to extract audio' : 'Extracting audio', 27);
      await new Promise(r => setTimeout(r, 500));
    }
    throw new Error('Audio extraction timed out. Try again.');
  } finally { await fetch('/api/media/delete?id=' + id, { method: 'DELETE' }).catch(() => {}); }
}
