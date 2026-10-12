export function sameOrigin(req, env = {}, allowNavigation = false) {
  const host = req.headers.host || '';
  const origin = env.APP_ORIGIN || '';
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
  if (origin ? host !== new URL(origin).host : !local) return false;
  const site = req.headers['sec-fetch-site'];
  const navigation = allowNavigation && req.method === 'GET' && req.headers['sec-fetch-mode'] === 'navigate';
  return (!site || ['none', 'same-origin'].includes(site) || navigation) && (!req.headers.origin ||
    (origin ? req.headers.origin === origin : [`http://${host}`, `https://${host}`].includes(req.headers.origin)));
}
export const json = (res, status, value) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
};
export async function readBody(req, limit = 1024 * 1024) {
  const parts = []; let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > limit) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    parts.push(part);
  }
  return Buffer.concat(parts);
}
