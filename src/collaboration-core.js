// JSON-only project data. Playback handles, decoded audio and personal view
// preferences stay on each device; uploaded media travels by durable identity.
export function sharedDocument(doc, settings) {
  const media = Object.fromEntries(Object.entries(doc.media).map(([id, asset]) => {
    const copy = { ...asset };
    for (const key of ['url', 'pcm', 'pcmRate', 'offline', 'audioError']) delete copy[key];
    if (copy.iconik) copy.iconik = { assetId: copy.iconik.assetId, proxyId: copy.iconik.proxyId };
    return [id, copy];
  }));
  return JSON.parse(JSON.stringify({ media, rows: doc.rows, mtl: doc.mtl, rules: doc.rules,
    reviews: doc.reviews || [], vet: doc.vet, settings }));
}

export function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keyed = values => Array.isArray(values) && values.every(v => object(v) && typeof v.id === 'string') && new Set(values.map(v => v.id)).size === values.length;

// Three-way merge at field / identified entity granularity. Word streams and
// unkeyed arrays are atomic because their indices carry timing relationships.
// A deletion versus an edit is a conflict, never a silent resurrection/deletion.
export function mergeDocuments(base, local, remote, prefer = 'local') {
  const conflicts = [];
  function merge(b, l, r, path) {
    if (equal(l, b)) return r;
    if (equal(r, b) || equal(l, r)) return l;
    if (object(b) && object(l) && object(r)) {
      const result = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(b[key], l[key], r[key], [...path, key]);
        if (value !== undefined) result[key] = value;
      }
      return result;
    }
    if (keyed(b) && keyed(l) && keyed(r)) {
      const bm = new Map(b.map(v => [v.id, v])), lm = new Map(l.map(v => [v.id, v])), rm = new Map(r.map(v => [v.id, v]));
      const common = b.filter(v => lm.has(v.id) && rm.has(v.id)).map(v => v.id);
      const order = values => values.map(v => v.id).filter(id => common.includes(id));
      const bo = common, lo = order(l), ro = order(r);
      let source = equal(lo, bo) ? r : l;
      if (!equal(lo, bo) && !equal(ro, bo) && !equal(lo, ro)) {
        conflicts.push([...path, '(order)'].join(' / ')); source = prefer === 'local' ? l : r;
      }
      const ids = [...new Set([...source, ...l, ...r].map(v => v.id))];
      return ids.map(id => merge(bm.get(id), lm.get(id), rm.get(id), [...path, id])).filter(v => v !== undefined);
    }
    conflicts.push(path.join(' / '));
    return prefer === 'local' ? l : r;
  }
  return { document: merge(base, local, remote, []), conflicts };
}

export function projectLink(location, id, key) {
  return `${location.origin}${location.pathname}#${new URLSearchParams({ project: id, key })}`;
}
